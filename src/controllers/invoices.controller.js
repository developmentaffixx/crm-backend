const db = require('../config/db');
const { uploadToCloudinary } = require('../config/cloudinary');
const { sendRawEmail } = require('../services/email.service');

// ─── Helper: Generate invoice number ──────────────────────────────────────────
// Format: INV-YYMM-CLIENTCODE-### (e.g. INV-2504-AFXCL001-001)
// Sequence resets to 001 every month per client
async function generateInvoiceNumber(leadId) {
  const now = new Date();
  const yymm = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}`;

  // Get client code from leads table
  let clientCode = 'CLIENT';
  if (leadId) {
    const [leadRows] = await db.query('SELECT client_code FROM leads WHERE id = ?', [leadId]);
    if (leadRows[0]?.client_code) {
      clientCode = leadRows[0].client_code;
    }
  }

  // Count invoices for this client in the current month (resets monthly per client)
  const [count] = await db.query(
    `SELECT COUNT(*) AS cnt
     FROM invoices
     WHERE lead_id = ?
       AND DATE_FORMAT(created_at, '%y%m') = ?
       AND deleted = 0`,
    [leadId || null, yymm]
  );
  const seq = String((count[0]?.cnt || 0) + 1).padStart(3, '0');

  return `INV-${yymm}-${clientCode}-${seq}`;
}

// ─── GET /api/invoices/preview-number — preview next invoice number ───────────
// Pass ?lead_id=<id> to get the correct client-specific preview
exports.previewNumber = async (req, res) => {
  try {
    const number = await generateInvoiceNumber(req.query.lead_id || null);
    return res.json({ invoice_number: number });
  } catch (err) {
    console.error('Invoice previewNumber error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── GET /api/invoices ────────────────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    const { status, search, lead_id } = req.query;
    let where = 'i.deleted = 0';
    const params = [];

    if (status) { where += ' AND i.status = ?'; params.push(status); }
    if (lead_id) { where += ' AND i.lead_id = ?'; params.push(lead_id); }
    if (search) {
      where += ' AND (i.invoice_number LIKE ? OR l.name LIKE ? OR l.business_name LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    const [rows] = await db.query(
      `SELECT i.*,
              l.name AS lead_name,
              l.business_name AS lead_business,
              l.email AS lead_email,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM invoices i
       LEFT JOIN leads l ON l.id = i.lead_id
       LEFT JOIN users u ON u.id = i.created_by
       WHERE ${where}
       ORDER BY i.created_at DESC`,
      params
    );

    // Summary
    const summary = {
      total: rows.length,
      new_count: rows.filter(r => r.status === 'New').length,
      partial: rows.filter(r => r.status === 'Partial').length,
      paid: rows.filter(r => r.status === 'Paid').length,
      overdue: rows.filter(r => r.status === 'Overdue').length,
      total_amount: rows.reduce((sum, r) => sum + parseFloat(r.total_amount || 0), 0),
      total_paid: rows.reduce((sum, r) => sum + parseFloat(r.paid_amount || 0), 0),
      total_balance: rows.reduce((sum, r) => sum + parseFloat(r.balance_amount || 0), 0),
    };

    return res.json({ invoices: rows, summary });
  } catch (err) {
    console.error('Invoices list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── GET /api/invoices/:id ────────────────────────────────────────────────────
exports.getOne = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT i.*,
              l.name AS lead_name,
              l.business_name AS lead_business,
              l.email AS lead_email,
              l.phone AS lead_phone,
              l.address AS lead_address,
              l.city AS lead_city,
              l.state AS lead_state,
              l.zip_code AS lead_zip,
              l.country AS lead_country,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM invoices i
       LEFT JOIN leads l ON l.id = i.lead_id
       LEFT JOIN users u ON u.id = i.created_by
       WHERE i.id = ? AND i.deleted = 0`,
      [req.params.id]
    );

    if (rows.length === 0) return res.status(404).json({ message: 'Invoice not found' });

    const invoice = rows[0];

    // Fetch items
    const [items] = await db.query(
      `SELECT ii.*, s.name AS service_name
       FROM invoice_items ii
       LEFT JOIN services s ON s.id = ii.service_id
       WHERE ii.invoice_id = ?
       ORDER BY ii.sort_order ASC`,
      [invoice.id]
    );
    invoice.items = items;

    // Fetch payments
    const [payments] = await db.query(
      `SELECT p.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM invoice_payments p
       LEFT JOIN users u ON u.id = p.created_by
       WHERE p.invoice_id = ?
       ORDER BY p.payment_date DESC`,
      [invoice.id]
    );
    invoice.payments = payments;

    return res.json(invoice);
  } catch (err) {
    console.error('Invoice getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── POST /api/invoices ───────────────────────────────────────────────────────
exports.create = async (req, res) => {
  const {
    lead_id, bill_date, due_date, from_address, status,
    discount, bank_name, account_number, ifsc_code, branch,
    note, items
  } = req.body;

  try {
    const invoice_number = await generateInvoiceNumber(lead_id || null);

    // Calculate totals
    let subtotal = 0;
    if (items && items.length > 0) {
      subtotal = items.reduce((sum, item) => sum + (parseFloat(item.quantity || 1) * parseFloat(item.rate || 0)), 0);
    }
    const disc = parseFloat(discount || 0);
    const total_amount = subtotal - disc;
    const balance_amount = total_amount;

    const [result] = await db.query(
      `INSERT INTO invoices (invoice_number, lead_id, status, bill_date, due_date, from_address,
        subtotal, discount, total_amount, paid_amount, balance_amount,
        bank_name, account_number, ifsc_code, branch, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
      [
        invoice_number, lead_id || null, status || 'New',
        bill_date || new Date().toISOString().split('T')[0],
        due_date || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        from_address || null,
        subtotal, disc, total_amount, balance_amount,
        bank_name || null, account_number || null, ifsc_code || null, branch || null,
        note || null, req.user.id
      ]
    );

    const invoiceId = result.insertId;

    // Insert items
    if (items && items.length > 0) {
      const itemValues = items.map((item, i) => [
        invoiceId,
        item.service_id || null,
        item.description || null,
        item.hsn_code || null,
        parseFloat(item.quantity || 1),
        parseFloat(item.rate || 0),
        parseFloat(item.quantity || 1) * parseFloat(item.rate || 0),
        i
      ]);
      await db.query(
        `INSERT INTO invoice_items (invoice_id, service_id, description, hsn_code, quantity, rate, amount, sort_order)
         VALUES ?`,
        [itemValues]
      );
    }

    const [created] = await db.query('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
    res.emitSocket('invoices:created', created[0]);
    return res.status(201).json(created[0]);
  } catch (err) {
    console.error('Invoice create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── PUT /api/invoices/:id ────────────────────────────────────────────────────
exports.update = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM invoices WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Invoice not found' });

    const {
      lead_id, bill_date, due_date, from_address, status,
      discount, bank_name, account_number, ifsc_code, branch,
      note, items
    } = req.body;

    // Recalculate totals if items provided
    let subtotal = rows[0].subtotal;
    if (items !== undefined) {
      subtotal = items.reduce((sum, item) => sum + (parseFloat(item.quantity || 1) * parseFloat(item.rate || 0)), 0);
    }
    const disc = discount !== undefined ? parseFloat(discount) : parseFloat(rows[0].discount);
    const total_amount = subtotal - disc;
    const paid = parseFloat(rows[0].paid_amount);
    const balance_amount = total_amount - paid;

    await db.query(
      `UPDATE invoices SET
        lead_id = ?, bill_date = ?, due_date = ?, from_address = ?, status = ?,
        subtotal = ?, discount = ?, total_amount = ?, balance_amount = ?,
        bank_name = ?, account_number = ?, ifsc_code = ?, branch = ?, note = ?
       WHERE id = ?`,
      [
        lead_id !== undefined ? lead_id : rows[0].lead_id,
        bill_date || rows[0].bill_date,
        due_date || rows[0].due_date,
        from_address !== undefined ? from_address : rows[0].from_address,
        status || rows[0].status,
        subtotal, disc, total_amount, balance_amount,
        bank_name !== undefined ? bank_name : rows[0].bank_name,
        account_number !== undefined ? account_number : rows[0].account_number,
        ifsc_code !== undefined ? ifsc_code : rows[0].ifsc_code,
        branch !== undefined ? branch : rows[0].branch,
        note !== undefined ? note : rows[0].note,
        req.params.id
      ]
    );

    // Replace items if provided
    if (items !== undefined) {
      await db.query('DELETE FROM invoice_items WHERE invoice_id = ?', [req.params.id]);
      if (items.length > 0) {
        const itemValues = items.map((item, i) => [
          req.params.id,
          item.service_id || null,
          item.description || null,
          item.hsn_code || null,
          parseFloat(item.quantity || 1),
          parseFloat(item.rate || 0),
          parseFloat(item.quantity || 1) * parseFloat(item.rate || 0),
          i
        ]);
        await db.query(
          `INSERT INTO invoice_items (invoice_id, service_id, description, hsn_code, quantity, rate, amount, sort_order)
           VALUES ?`,
          [itemValues]
        );
      }
    }

    const [updated] = await db.query('SELECT * FROM invoices WHERE id = ?', [req.params.id]);
    res.emitSocket('invoices:updated', updated[0]);
    return res.json(updated[0]);
  } catch (err) {
    console.error('Invoice update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── DELETE /api/invoices/:id (soft delete) ───────────────────────────────────
exports.remove = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM invoices WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Invoice not found' });

    await db.query('UPDATE invoices SET deleted = 1 WHERE id = ?', [req.params.id]);
    res.emitSocket('invoices:deleted', { id: req.params.id });
    return res.json({ message: 'Invoice deleted' });
  } catch (err) {
    console.error('Invoice delete error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── POST /api/invoices/:id/payments — Record payment ─────────────────────────
exports.recordPayment = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM invoices WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Invoice not found' });

    const invoice = rows[0];
    const { payment_date, payment_method, amount, reference_id } = req.body;

    if (!amount || parseFloat(amount) <= 0) {
      return res.status(400).json({ message: 'Payment amount must be greater than 0' });
    }

    const paymentAmount = parseFloat(amount);
    const newPaid = parseFloat(invoice.paid_amount) + paymentAmount;
    const newBalance = parseFloat(invoice.total_amount) - newPaid;

    // Determine new status
    let newStatus = invoice.status;
    if (newBalance <= 0) {
      newStatus = 'Paid';
    } else if (newPaid > 0) {
      newStatus = 'Partial';
    }

    // Insert payment record
    const [result] = await db.query(
      `INSERT INTO invoice_payments (invoice_id, payment_date, payment_method, amount, reference_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        req.params.id,
        payment_date || new Date().toISOString().split('T')[0],
        payment_method || 'Cash',
        paymentAmount,
        reference_id || null,
        req.user.id
      ]
    );

    // Update invoice totals and status
    await db.query(
      `UPDATE invoices SET paid_amount = ?, balance_amount = ?, status = ? WHERE id = ?`,
      [newPaid, Math.max(0, newBalance), newStatus, req.params.id]
    );

    const [payment] = await db.query(
      `SELECT p.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM invoice_payments p
       LEFT JOIN users u ON u.id = p.created_by
       WHERE p.id = ?`,
      [result.insertId]
    );

    return res.status(201).json(payment[0]);
  } catch (err) {
    console.error('Record payment error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── GET /api/invoices/:id/payments — Payment history ─────────────────────────
exports.getPayments = async (req, res) => {
  try {
    const [payments] = await db.query(
      `SELECT p.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM invoice_payments p
       LEFT JOIN users u ON u.id = p.created_by
       WHERE p.invoice_id = ?
       ORDER BY p.payment_date DESC`,
      [req.params.id]
    );
    return res.json(payments);
  } catch (err) {
    console.error('Payments list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── POST /api/invoices/:id/upload-qr — Upload QR code image ──────────────────
exports.uploadQR = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const { url } = await uploadToCloudinary(req.file.buffer, 'crm/invoice-qr', 'image');
    await db.query('UPDATE invoices SET qr_code_url = ? WHERE id = ?', [url, req.params.id]);

    return res.json({ message: 'QR code uploaded', url });
  } catch (err) {
    console.error('Upload QR error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── POST /api/invoices/:id/send-email ────────────────────────────────────────
exports.sendEmail = async (req, res) => {
  try {
    // Get invoice with client details
    const [rows] = await db.query(
      `SELECT i.*,
              l.name AS lead_name,
              l.business_name AS lead_business,
              l.email AS lead_email,
              l.phone AS lead_phone,
              l.address AS lead_address,
              l.city AS lead_city,
              l.state AS lead_state,
              l.zip_code AS lead_zip,
              l.country AS lead_country
       FROM invoices i
       LEFT JOIN leads l ON l.id = i.lead_id
       WHERE i.id = ? AND i.deleted = 0`,
      [req.params.id]
    );

    if (rows.length === 0) return res.status(404).json({ message: 'Invoice not found' });

    const invoice = rows[0];
    if (!invoice.lead_email) {
      return res.status(400).json({ message: 'Client does not have an email address' });
    }

    // Get invoice items
    const [items] = await db.query(
      `SELECT ii.*, s.name AS service_name
       FROM invoice_items ii
       LEFT JOIN services s ON s.id = ii.service_id
       WHERE ii.invoice_id = ?`,
      [invoice.id]
    );

    // Get company settings
    const [compRows] = await db.query('SELECT * FROM company_settings WHERE id = 1');
    const comp = compRows[0] || {};

    const companyAddr = [comp.address_line1, comp.address_line2, comp.city, comp.state, comp.zip_code].filter(Boolean).join(', ');
    const clientAddr = [invoice.lead_address, invoice.lead_city, invoice.lead_state, invoice.lead_zip, invoice.lead_country].filter(Boolean).join(', ');

    const billDate = invoice.bill_date ? new Date(invoice.bill_date).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
    const dueDate = invoice.due_date ? new Date(invoice.due_date).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

    // Build items HTML
    const itemsHtml = items.map((item, idx) => `
      <tr style="background:${idx % 2 === 0 ? '#fff' : '#f9f9f9'};">
        <td style="border:1px solid #ddd;padding:8px;text-align:center;">${idx + 1}</td>
        <td style="border:1px solid #ddd;padding:8px;">${item.service_name || item.description || '—'}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center;">${item.hsn_code || '—'}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:center;">${Number(item.quantity)}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:right;">₹${Number(item.rate).toLocaleString('en-IN')}</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:right;font-weight:600;">₹${Number(item.amount).toLocaleString('en-IN')}</td>
      </tr>
    `).join('');

    const discountRow = parseFloat(invoice.discount) > 0 ? `
      <tr>
        <td colspan="4" style="border:none;"></td>
        <td style="border:1px solid #ddd;padding:8px;text-align:right;font-weight:600;">Discount</td>
        <td style="border:1px solid #ddd;padding:8px;text-align:right;">- ₹${Number(invoice.discount).toLocaleString('en-IN')}</td>
      </tr>` : '';

    const termsLines = invoice.note
      ? invoice.note.split('\n').map(l => `<p style="margin:2px 0;font-size:11px;color:#555;">${l}</p>`).join('')
      : '';

    // Build email HTML
    const emailHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:'Segoe UI',Arial,sans-serif;margin:0;padding:20px;background:#f5f5f5;">
<div style="max-width:700px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.1);">
  
  <!-- Header -->
  <div style="background:#1a1a2e;color:#fff;padding:24px;text-align:center;">
    <h1 style="margin:0;font-size:20px;letter-spacing:1px;">${comp.company_name || 'Invoice'}</h1>
    ${companyAddr ? `<p style="margin:6px 0 0;font-size:12px;opacity:0.8;">${companyAddr}</p>` : ''}
  </div>

  <!-- Body -->
  <div style="padding:24px;">
    <p style="font-size:14px;color:#333;margin:0 0 8px;">Dear <strong>${invoice.lead_name || 'Client'}</strong>,</p>
    <p style="font-size:13px;color:#555;margin:0 0 20px;">Please find your invoice details below.</p>

    <!-- Invoice Meta -->
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <tr>
        <td style="padding:6px 0;font-size:12px;color:#888;width:120px;">Invoice No.</td>
        <td style="padding:6px 0;font-size:13px;font-weight:700;">${invoice.invoice_number}</td>
        <td style="padding:6px 0;font-size:12px;color:#888;width:100px;">Bill Date</td>
        <td style="padding:6px 0;font-size:13px;">${billDate}</td>
      </tr>
      <tr>
        <td style="padding:6px 0;font-size:12px;color:#888;">Status</td>
        <td style="padding:6px 0;font-size:13px;font-weight:600;color:${invoice.status === 'Paid' ? '#16a34a' : invoice.status === 'Overdue' ? '#dc2626' : '#2563eb'};">${invoice.status}</td>
        <td style="padding:6px 0;font-size:12px;color:#888;">Due Date</td>
        <td style="padding:6px 0;font-size:13px;font-weight:600;color:${invoice.status === 'Overdue' ? '#dc2626' : '#333'};">${dueDate}</td>
      </tr>
    </table>

    <!-- Items Table -->
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
      <thead>
        <tr style="background:#f2f2f2;">
          <th style="border:1px solid #ddd;padding:8px;font-size:11px;text-align:center;width:30px;">Sr.</th>
          <th style="border:1px solid #ddd;padding:8px;font-size:11px;text-align:left;">Service / Item</th>
          <th style="border:1px solid #ddd;padding:8px;font-size:11px;text-align:center;width:70px;">HSN</th>
          <th style="border:1px solid #ddd;padding:8px;font-size:11px;text-align:center;width:40px;">Qty</th>
          <th style="border:1px solid #ddd;padding:8px;font-size:11px;text-align:right;width:80px;">Rate</th>
          <th style="border:1px solid #ddd;padding:8px;font-size:11px;text-align:right;width:90px;">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
        ${discountRow}
        <tr style="background:#f2f2f2;">
          <td colspan="4" style="border:none;"></td>
          <td style="border:1px solid #333;padding:10px 8px;text-align:right;font-weight:700;font-size:13px;">Total</td>
          <td style="border:1px solid #333;padding:10px 8px;text-align:right;font-weight:700;font-size:13px;">₹${Number(invoice.total_amount).toLocaleString('en-IN')}</td>
        </tr>
      </tbody>
    </table>

    ${parseFloat(invoice.balance_amount) > 0 ? `
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:12px 16px;margin-bottom:16px;">
      <p style="margin:0;font-size:13px;color:#dc2626;font-weight:600;">Balance Due: ₹${Number(invoice.balance_amount).toLocaleString('en-IN')}</p>
    </div>` : `
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:12px 16px;margin-bottom:16px;">
      <p style="margin:0;font-size:13px;color:#16a34a;font-weight:600;">Fully Paid — Thank you!</p>
    </div>`}

    <!-- Bank Details -->
    ${(invoice.bank_name || invoice.account_number) ? `
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:12px 16px;margin-bottom:16px;">
      <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Bank Details</p>
      <p style="margin:0;font-size:12px;color:#333;">
        ${invoice.bank_name ? `Bank: <strong>${invoice.bank_name}</strong> &nbsp;|&nbsp; ` : ''}
        ${invoice.account_number ? `A/c: <strong>${invoice.account_number}</strong> &nbsp;|&nbsp; ` : ''}
        ${invoice.ifsc_code ? `IFSC: <strong>${invoice.ifsc_code}</strong> &nbsp;|&nbsp; ` : ''}
        ${invoice.branch ? `Branch: ${invoice.branch}` : ''}
      </p>
    </div>` : ''}

    <!-- Terms -->
    ${termsLines ? `
    <div style="margin-top:16px;padding-top:12px;border-top:1px solid #eee;">
      <p style="margin:0 0 6px;font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Terms & Conditions</p>
      ${termsLines}
    </div>` : ''}
  </div>

  <!-- Footer -->
  <div style="background:#f8fafc;padding:16px 24px;text-align:center;border-top:1px solid #eee;">
    <p style="margin:0;font-size:11px;color:#94a3b8;">Entity belongs to Scale Forge Private Limited</p>
  </div>
</div>
</body>
</html>`;

    // Send the email
    await sendRawEmail({
      to: invoice.lead_email,
      subject: `Invoice ${invoice.invoice_number} from ${comp.company_name || 'CRM'}`,
      html: emailHtml,
    });

    return res.json({ message: 'Invoice emailed successfully' });
  } catch (err) {
    console.error('Send invoice email error:', err);
    return res.status(500).json({ message: err.message || 'Failed to send email' });
  }
};
