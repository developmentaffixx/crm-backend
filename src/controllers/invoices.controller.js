const db = require('../config/db');
const path = require('path');
const fs = require('fs');

// ─── Helper: Generate invoice number ──────────────────────────────────────────
async function generateInvoiceNumber() {
  const now = new Date();
  const prefix = `INV-${String(now.getDate()).padStart(2, '0')}${String(now.getMonth() + 1).padStart(2, '0')}`;
  
  // Get company short code
  const [company] = await db.query('SELECT company_name FROM company_settings WHERE id = 1');
  const companyName = company[0]?.company_name || 'CRM';
  const code = companyName.replace(/[^A-Z]/gi, '').substring(0, 5).toUpperCase() || 'CRM';

  // Get next sequence for today
  const [count] = await db.query(
    `SELECT COUNT(*) as cnt FROM invoices WHERE DATE(created_at) = CURDATE()`
  );
  const seq = String((count[0]?.cnt || 0) + 1).padStart(3, '0');

  return `${prefix}-${code}-${seq}`;
}

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
    const invoice_number = await generateInvoiceNumber();

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

    const filename = `invoice-qr-${Date.now()}${path.extname(req.file.originalname)}`;
    const uploadDir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    const filepath = path.join(uploadDir, filename);
    fs.writeFileSync(filepath, req.file.buffer);

    const url = `/uploads/${filename}`;
    await db.query('UPDATE invoices SET qr_code_url = ? WHERE id = ?', [url, req.params.id]);

    return res.json({ message: 'QR code uploaded', url });
  } catch (err) {
    console.error('Upload QR error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
