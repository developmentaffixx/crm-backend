const db = require('../config/db');
const { uploadToCloudinary } = require('../config/cloudinary');
const { sendRawEmail } = require('../services/email.service');

// ─── Helper: Generate invoice number ──────────────────────────────────────────
// Format: INV-YYMM-CLIENTCODE-### (e.g. INV-2504-AFXCL001-001)
// YYMM is derived from bill_date. ### is a global sequential number that resets every FY (April–March)
async function generateInvoiceNumber(leadId, billDate) {
  // Use bill_date for YYMM; fallback to current date
  const dateForYYMM = billDate ? new Date(billDate) : new Date();
  const yymm = `${String(dateForYYMM.getFullYear()).slice(-2)}${String(dateForYYMM.getMonth() + 1).padStart(2, '0')}`;

  // Get client code from leads table
  let clientCode = 'CLIENT';
  if (leadId) {
    const [leadRows] = await db.query('SELECT client_code FROM leads WHERE id = ?', [leadId]);
    if (leadRows[0]?.client_code) {
      clientCode = leadRows[0].client_code;
    }
  }

  // Determine FY based on the bill_date (not today)
  // FY runs April 1 – March 31. If month is Jan-Mar, FY started previous year's April.
  const fyStartYear = dateForYYMM.getMonth() >= 3 ? dateForYYMM.getFullYear() : dateForYYMM.getFullYear() - 1;
  const fyStart = `${fyStartYear}-04-01`;
  const fyEnd = `${fyStartYear + 1}-03-31`;

  // Count ALL invoices in the current financial year (global counter, not per-client)
  const [count] = await db.query(
    `SELECT COUNT(*) AS cnt
     FROM invoices
     WHERE bill_date >= ? AND bill_date <= ?
       AND deleted = 0`,
    [fyStart, fyEnd]
  );
  const seq = String((count[0]?.cnt || 0) + 1).padStart(3, '0');

  return `INV-${yymm}-${clientCode}-${seq}`;
}

// ─── GET /api/invoices/preview-number — preview next invoice number ───────────
// Pass ?lead_id=<id>&bill_date=<YYYY-MM-DD> for correct preview
exports.previewNumber = async (req, res) => {
  try {
    const number = await generateInvoiceNumber(req.query.lead_id || null, req.query.bill_date || null);
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
    upi_id, note, items
  } = req.body;

  try {
    const invoice_number = await generateInvoiceNumber(lead_id || null, bill_date || null);

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
        bank_name, account_number, ifsc_code, branch, upi_id, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        invoice_number, lead_id || null, status || 'New',
        bill_date || new Date().toISOString().split('T')[0],
        due_date || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        from_address || null,
        subtotal, disc, total_amount, balance_amount,
        bank_name || null, account_number || null, ifsc_code || null, branch || null,
        upi_id || null, note || null, req.user.id
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
      upi_id, note, items
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
        bank_name = ?, account_number = ?, ifsc_code = ?, branch = ?, upi_id = ?, note = ?
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
        upi_id !== undefined ? upi_id : rows[0].upi_id,
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
      <tr style="border-bottom:1px solid #e8e2dc;">
        <td style="padding:10px 8px;font-size:12px;color:#4a4340;">
          ${item.service_name || item.description || '—'}
          ${item.service_name && item.description ? `<div style="font-size:10px;color:#9a8e82;margin-top:2px;">${item.description}</div>` : ''}
        </td>
        <td style="padding:10px 8px;text-align:center;font-size:12px;color:#6b5e50;">${item.hsn_code || '—'}</td>
        <td style="padding:10px 8px;text-align:center;font-size:12px;color:#6b5e50;">${Number(item.quantity)}</td>
        <td style="padding:10px 8px;text-align:right;font-size:12px;color:#6b5e50;">₹${Number(item.rate).toLocaleString('en-IN')}</td>
        <td style="padding:10px 8px;text-align:right;font-size:12px;font-weight:600;color:#4a4340;">₹${Number(item.amount).toLocaleString('en-IN')}</td>
      </tr>
    `).join('');

    const discountRow = parseFloat(invoice.discount) > 0 ? `
      <tr style="border-bottom:1px solid #e8e2dc;">
        <td colspan="3" style="padding:8px;"></td>
        <td style="padding:8px;text-align:right;font-size:12px;font-weight:600;color:#6b5e50;">Discount</td>
        <td style="padding:8px;text-align:right;font-size:12px;color:#6b5e50;">- ₹${Number(invoice.discount).toLocaleString('en-IN')}</td>
      </tr>` : '';

    const termsLines = invoice.note
      ? invoice.note.split('\n').map(l => `<p style="margin:2px 0;font-size:11px;color:#9a8e82;">${l}</p>`).join('')
      : '';

    // Build email HTML
    const emailHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:'Times New Roman',Times,serif;margin:0;padding:20px;background:#f5f1eb;">
<div style="max-width:650px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);">

  <!-- Header -->
  <div style="background:#4a4340;color:#fff;padding:28px;text-align:center;">
    <h1 style="margin:0;font-size:20px;font-weight:300;letter-spacing:3px;text-transform:uppercase;">Invoice</h1>
    <p style="margin:8px 0 0;font-size:12px;opacity:0.7;">${comp.company_name || 'Company'}</p>
  </div>

  <!-- Body -->
  <div style="padding:28px;">
    <p style="font-size:14px;color:#4a4340;margin:0 0 8px;">Dear <strong>${invoice.lead_name || 'Client'}</strong>,</p>
    <p style="font-size:13px;color:#6b5e50;margin:0 0 24px;line-height:1.6;">Please find your invoice details below.</p>

    <!-- Invoice Meta -->
    <div style="background:#f5f1eb;border-radius:8px;padding:16px;margin-bottom:20px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:6px 0;font-size:12px;color:#9a8e82;">Invoice No.</td>
          <td style="padding:6px 0;font-size:13px;font-weight:700;color:#4a4340;text-align:right;">${invoice.invoice_number}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;font-size:12px;color:#9a8e82;">Bill Date</td>
          <td style="padding:6px 0;font-size:13px;color:#4a4340;text-align:right;">${billDate}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;font-size:12px;color:#9a8e82;">Due Date</td>
          <td style="padding:6px 0;font-size:13px;font-weight:600;color:${invoice.status === 'Overdue' ? '#dc2626' : '#4a4340'};text-align:right;">${dueDate}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;font-size:12px;color:#9a8e82;">Status</td>
          <td style="padding:6px 0;font-size:13px;font-weight:600;color:${invoice.status === 'Paid' ? '#16a34a' : invoice.status === 'Overdue' ? '#dc2626' : '#6b5e50'};text-align:right;">${invoice.status}</td>
        </tr>
      </table>
    </div>

    <!-- Items Table -->
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
      <thead>
        <tr style="border-bottom:1.5px solid #b8a994;">
          <th style="padding:10px 8px;font-size:11px;text-align:left;color:#4a4340;font-weight:700;">Description</th>
          <th style="padding:10px 8px;font-size:11px;text-align:center;color:#4a4340;font-weight:700;width:60px;">HSN</th>
          <th style="padding:10px 8px;font-size:11px;text-align:center;color:#4a4340;font-weight:700;width:40px;">Qty</th>
          <th style="padding:10px 8px;font-size:11px;text-align:right;color:#4a4340;font-weight:700;width:80px;">Rate</th>
          <th style="padding:10px 8px;font-size:11px;text-align:right;color:#4a4340;font-weight:700;width:90px;">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
        ${discountRow}
      </tbody>
    </table>

    <!-- Total -->
    <div style="display:flex;justify-content:flex-end;margin-bottom:16px;">
      <div style="background:#f7f3ee;border-radius:6px;padding:12px 16px;min-width:200px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:4px 0;font-size:12px;color:#6b5e50;">Sub-total</td>
            <td style="padding:4px 0;font-size:12px;color:#6b5e50;text-align:right;">₹${Number(invoice.subtotal).toLocaleString('en-IN')}</td>
          </tr>
          <tr style="border-top:1px solid #e0d9d0;">
            <td style="padding:8px 0 4px;font-size:14px;font-weight:700;color:#4a4340;">Total</td>
            <td style="padding:8px 0 4px;font-size:14px;font-weight:700;color:#4a4340;text-align:right;">₹${Number(invoice.total_amount).toLocaleString('en-IN')}</td>
          </tr>
        </table>
      </div>
    </div>

    ${parseFloat(invoice.balance_amount) > 0 ? `
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:14px 16px;margin-bottom:16px;">
      <p style="margin:0;font-size:13px;color:#dc2626;font-weight:600;">Balance Due: ₹${Number(invoice.balance_amount).toLocaleString('en-IN')}</p>
    </div>` : `
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px 16px;margin-bottom:16px;">
      <p style="margin:0;font-size:13px;color:#16a34a;font-weight:600;">Fully Paid — Thank you!</p>
    </div>`}

    <!-- Bank Details -->
    ${(invoice.bank_name || invoice.account_number) ? `
    <div style="background:#fafafa;border:1px solid #e8e2dc;border-radius:8px;padding:14px 16px;margin-bottom:16px;">
      <p style="margin:0 0 6px;font-size:11px;font-weight:700;color:#b8a994;text-transform:uppercase;letter-spacing:0.5px;">Bank Details</p>
      <p style="margin:0;font-size:12px;color:#4a4340;line-height:1.8;">
        ${invoice.bank_name ? `Bank: <strong>${invoice.bank_name}</strong><br>` : ''}
        ${invoice.account_number ? `A/c No: <strong>${invoice.account_number}</strong><br>` : ''}
        ${invoice.ifsc_code ? `IFSC: <strong>${invoice.ifsc_code}</strong><br>` : ''}
        ${invoice.branch ? `Branch: ${invoice.branch}` : ''}
      </p>
    </div>` : ''}

    <!-- Terms -->
    ${termsLines ? `
    <div style="margin-top:16px;padding-top:14px;border-top:1px solid #e8e2dc;">
      <p style="margin:0 0 6px;font-size:11px;font-weight:700;color:#b8a994;text-transform:uppercase;letter-spacing:0.5px;">Terms & Conditions</p>
      ${termsLines}
    </div>` : ''}
  </div>

  <!-- Footer -->
  <div style="background:#f5f1eb;padding:16px 28px;text-align:center;border-top:1px solid #e8e2dc;">
    <p style="margin:0;font-size:11px;color:#b8a994;">Entity belongs to Scale Forge Private Limited</p>
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

// ─── POST /api/invoices/:id/send-reminder — Send payment reminder ─────────────
exports.sendReminder = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT i.*,
              l.name AS lead_name,
              l.business_name AS lead_business,
              l.email AS lead_email,
              l.phone AS lead_phone
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

    if (invoice.status === 'Paid') {
      return res.status(400).json({ message: 'Invoice is already fully paid' });
    }

    // Get company settings
    const [compRows] = await db.query('SELECT * FROM company_settings WHERE id = 1');
    const comp = compRows[0] || {};

    const dueDate = invoice.due_date
      ? new Date(invoice.due_date).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })
      : '—';

    const isOverdue = invoice.status === 'Overdue';

    // Build reminder email HTML
    const emailHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:'Times New Roman',Times,serif;margin:0;padding:20px;background:#f5f1eb;">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);">

  <!-- Header -->
  <div style="background:#4a4340;color:#fff;padding:28px;text-align:center;">
    <h1 style="margin:0;font-size:18px;font-weight:400;letter-spacing:2px;">Payment Reminder</h1>
    <p style="margin:8px 0 0;font-size:12px;opacity:0.7;">${comp.company_name || 'CRM'}</p>
  </div>

  <!-- Body -->
  <div style="padding:28px;">
    <p style="font-size:14px;color:#4a4340;margin:0 0 12px;">Dear <strong>${invoice.lead_name || 'Client'}</strong>,</p>
    <p style="font-size:13px;color:#6b5e50;margin:0 0 20px;line-height:1.6;">
      ${isOverdue
        ? 'This is a gentle reminder that the following invoice is <strong style="color:#dc2626;">overdue</strong>. We kindly request you to make the payment at your earliest convenience.'
        : 'This is a friendly reminder regarding your upcoming payment. Please find the details below.'}
    </p>

    <!-- Invoice Summary Card -->
    <div style="background:#f5f1eb;border-radius:8px;padding:20px;margin-bottom:20px;">
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:6px 0;font-size:12px;color:#9a8e82;">Invoice No.</td>
          <td style="padding:6px 0;font-size:13px;font-weight:700;color:#4a4340;text-align:right;">${invoice.invoice_number}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;font-size:12px;color:#9a8e82;">Due Date</td>
          <td style="padding:6px 0;font-size:13px;font-weight:600;color:${isOverdue ? '#dc2626' : '#4a4340'};text-align:right;">${dueDate}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;font-size:12px;color:#9a8e82;">Total Amount</td>
          <td style="padding:6px 0;font-size:13px;color:#4a4340;text-align:right;">₹${Number(invoice.total_amount).toLocaleString('en-IN')}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;font-size:12px;color:#9a8e82;">Amount Paid</td>
          <td style="padding:6px 0;font-size:13px;color:#16a34a;text-align:right;">₹${Number(invoice.paid_amount).toLocaleString('en-IN')}</td>
        </tr>
        <tr style="border-top:1px solid #e0d9d0;">
          <td style="padding:10px 0 6px;font-size:13px;font-weight:700;color:#4a4340;">Balance Due</td>
          <td style="padding:10px 0 6px;font-size:15px;font-weight:700;color:#dc2626;text-align:right;">₹${Number(invoice.balance_amount).toLocaleString('en-IN')}</td>
        </tr>
      </table>
    </div>

    <!-- Bank Details -->
    ${(invoice.bank_name || invoice.account_number) ? `
    <div style="background:#fafafa;border:1px solid #e8e2dc;border-radius:8px;padding:16px;margin-bottom:20px;">
      <p style="margin:0 0 8px;font-size:11px;font-weight:700;color:#b8a994;text-transform:uppercase;letter-spacing:0.5px;">Bank Details for Payment</p>
      <p style="margin:0;font-size:12px;color:#4a4340;line-height:1.8;">
        ${invoice.bank_name ? `Bank: <strong>${invoice.bank_name}</strong><br>` : ''}
        ${invoice.account_number ? `A/c No: <strong>${invoice.account_number}</strong><br>` : ''}
        ${invoice.ifsc_code ? `IFSC: <strong>${invoice.ifsc_code}</strong><br>` : ''}
        ${invoice.branch ? `Branch: ${invoice.branch}` : ''}
      </p>
    </div>` : ''}

    <p style="font-size:12px;color:#9a8e82;margin:16px 0 0;line-height:1.5;">
      If you have already made the payment, please disregard this reminder. For any questions, feel free to reach out to us.
    </p>
  </div>

  <!-- Footer -->
  <div style="background:#f5f1eb;padding:16px 28px;text-align:center;border-top:1px solid #e8e2dc;">
    <p style="margin:0;font-size:11px;color:#b8a994;">Entity belongs to Scale Forge Private Limited</p>
  </div>
</div>
</body>
</html>`;

    // Send the reminder email
    await sendRawEmail({
      to: invoice.lead_email,
      subject: `Payment Reminder: Invoice ${invoice.invoice_number} — ${comp.company_name || 'CRM'}`,
      html: emailHtml,
    });

    return res.json({ message: 'Payment reminder sent successfully' });
  } catch (err) {
    console.error('Send payment reminder error:', err);
    return res.status(500).json({ message: err.message || 'Failed to send reminder' });
  }
};
