const db = require('../config/db');
const { uploadToCloudinary, deleteFromCloudinary, extractPublicId } = require('../config/cloudinary');

// ─── GET /api/expenses ────────────────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    const { expense_type, category, search } = req.query;
    let where = 'e.deleted = 0';
    const params = [];

    if (expense_type) { where += ' AND e.expense_type = ?'; params.push(expense_type); }
    if (category) { where += ' AND e.category = ?'; params.push(category); }
    if (search) {
      where += ' AND (e.title LIKE ? OR e.vendor_name LIKE ? OR l.name LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    const [rows] = await db.query(
      `SELECT e.*,
              l.name AS client_name,
              l.business_name AS client_business,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM expenses e
       LEFT JOIN leads l ON l.id = e.client_id
       LEFT JOIN users u ON u.id = e.created_by
       WHERE ${where}
       ORDER BY e.expense_date DESC, e.created_at DESC`,
      params
    );

    // Summary
    const summary = {
      total_count: rows.length,
      total_amount: rows.reduce((sum, r) => sum + parseFloat(r.amount || 0), 0),
      client_count: rows.filter(r => r.expense_type === 'client').length,
      team_member_count: rows.filter(r => r.expense_type === 'team_member').length,
      company_count: rows.filter(r => r.expense_type === 'company').length,
    };

    return res.json({ expenses: rows, summary });
  } catch (err) {
    console.error('Expenses list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── GET /api/expenses/:id ────────────────────────────────────────────────────
exports.getOne = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT e.*,
              l.name AS client_name,
              l.business_name AS client_business,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM expenses e
       LEFT JOIN leads l ON l.id = e.client_id
       LEFT JOIN users u ON u.id = e.created_by
       WHERE e.id = ? AND e.deleted = 0`,
      [req.params.id]
    );

    if (rows.length === 0) return res.status(404).json({ message: 'Expense not found' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('Expense getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── POST /api/expenses ───────────────────────────────────────────────────────
exports.create = async (req, res) => {
  try {
    const {
      title, expense_date, expense_type, client_id, project_id,
      category, other_category, vendor_name, amount, payment_mode, transaction_id, bank_name, remarks, quantity
    } = req.body;

    if (!title || !vendor_name) {
      return res.status(400).json({ message: 'Title and vendor name are required' });
    }

    // Handle file upload
    let bill_copy = null;
    if (req.file) {
      // Use 'raw' for PDFs/documents so they can be directly downloaded, 'image' for images
      const isImage = /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(req.file.originalname);
      const resourceType = isImage ? 'image' : 'raw';
      const { url } = await uploadToCloudinary(req.file.buffer, 'crm/expenses', resourceType);
      bill_copy = url;
    }

    // Generate expense_id_code: EXP-YYMM-###
    // Prefix uses the expense date for reference, but sequence never resets (global across all months)
    const expDate = expense_date ? new Date(expense_date) : new Date();
    const eyy = String(expDate.getFullYear()).slice(-2);
    const emm = String(expDate.getMonth() + 1).padStart(2, '0');
    const expPrefix = `EXP-${eyy}${emm}`;
    const [lastExp] = await db.query(
      `SELECT expense_id_code FROM expenses WHERE expense_id_code LIKE 'EXP-%' ORDER BY id DESC LIMIT 1`
    );
    let expSeq = 1;
    if (lastExp.length > 0 && lastExp[0].expense_id_code) {
      const parts = lastExp[0].expense_id_code.split('-');
      expSeq = parseInt(parts[parts.length - 1], 10) + 1;
    }
    const expense_id_code = `${expPrefix}-${String(expSeq).padStart(3, '0')}`;

    const [result] = await db.query(
      `INSERT INTO expenses (expense_id_code, title, expense_date, expense_type, client_id, project_id, category, other_category, vendor_name, amount, quantity, payment_mode, transaction_id, bank_name, remarks, bill_copy, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        expense_id_code,
        title,
        expense_date || new Date().toISOString().split('T')[0],
        expense_type || 'company',
        client_id || null,
        project_id || null,
        category || 'Miscellaneous expense',
        other_category || null,
        vendor_name,
        parseFloat(amount || 0),
        quantity ? parseInt(quantity, 10) : null,
        payment_mode || 'Cash',
        transaction_id || null,
        payment_mode === 'Bank' || payment_mode === 'UPI' ? (bank_name || null) : null,
        remarks || null,
        bill_copy,
        req.user.id
      ]
    );

    const [created] = await db.query(
      `SELECT e.*, l.name AS client_name, l.business_name AS client_business,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM expenses e
       LEFT JOIN leads l ON l.id = e.client_id
       LEFT JOIN users u ON u.id = e.created_by
       WHERE e.id = ?`,
      [result.insertId]
    );
    res.emitSocket('expenses:created', created[0]);
    return res.status(201).json(created[0]);
  } catch (err) {
    console.error('Expense create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── PUT /api/expenses/:id ────────────────────────────────────────────────────
exports.update = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM expenses WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Expense not found' });

    const existing = rows[0];
    const {
      title, expense_date, expense_type, client_id, project_id,
      category, other_category, vendor_name, amount, payment_mode, transaction_id, bank_name, remarks, quantity
    } = req.body;

    // Handle file upload — delete old from Cloudinary, upload new
    let bill_copy = existing.bill_copy;
    if (req.file) {
      if (existing.bill_copy) {
        const oldPublicId = extractPublicId(existing.bill_copy);
        // Try deleting from both resource types since old files may be 'image' or 'raw'
        if (oldPublicId) {
          await deleteFromCloudinary(oldPublicId, 'raw');
          await deleteFromCloudinary(oldPublicId, 'image');
        }
      }
      const isImage = /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(req.file.originalname);
      const resourceType = isImage ? 'image' : 'raw';
      const { url } = await uploadToCloudinary(req.file.buffer, 'crm/expenses', resourceType);
      bill_copy = url;
    }

    await db.query(
      `UPDATE expenses SET
        title = ?, expense_date = ?, expense_type = ?, client_id = ?, project_id = ?,
        category = ?, other_category = ?, vendor_name = ?, amount = ?, quantity = ?, payment_mode = ?, transaction_id = ?, bank_name = ?, remarks = ?, bill_copy = ?
       WHERE id = ?`,
      [
        title !== undefined ? title : existing.title,
        expense_date || existing.expense_date,
        expense_type || existing.expense_type,
        expense_type === 'client' ? (client_id || existing.client_id) : null,
        expense_type === 'client' ? (project_id || existing.project_id) : null,
        category || existing.category,
        other_category !== undefined ? (other_category || null) : existing.other_category,
        vendor_name !== undefined ? vendor_name : existing.vendor_name,
        amount !== undefined ? parseFloat(amount) : existing.amount,
        quantity !== undefined ? (quantity ? parseInt(quantity, 10) : null) : existing.quantity,
        payment_mode || existing.payment_mode,
        transaction_id !== undefined ? (transaction_id || null) : existing.transaction_id,
        (payment_mode || existing.payment_mode) === 'Bank' || (payment_mode || existing.payment_mode) === 'UPI'
          ? (bank_name !== undefined ? (bank_name || null) : existing.bank_name)
          : null,
        remarks !== undefined ? (remarks || null) : existing.remarks,
        bill_copy,
        req.params.id
      ]
    );

    const [updated] = await db.query(
      `SELECT e.*, l.name AS client_name, l.business_name AS client_business,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM expenses e
       LEFT JOIN leads l ON l.id = e.client_id
       LEFT JOIN users u ON u.id = e.created_by
       WHERE e.id = ?`,
      [req.params.id]
    );
    res.emitSocket('expenses:updated', updated[0]);
    return res.json(updated[0]);
  } catch (err) {
    console.error('Expense update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── DELETE /api/expenses/:id (soft delete) ───────────────────────────────────
exports.remove = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM expenses WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Expense not found' });

    await db.query('UPDATE expenses SET deleted = 1 WHERE id = ?', [req.params.id]);
    res.emitSocket('expenses:deleted', { id: req.params.id });
    return res.json({ message: 'Expense deleted' });
  } catch (err) {
    console.error('Expense delete error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── GET /api/expenses/:id/download — proxy download bill ─────────────────────
exports.downloadBill = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT bill_copy, title FROM expenses WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Expense not found' });

    const { bill_copy, title } = rows[0];
    if (!bill_copy) return res.status(404).json({ message: 'No bill attached' });

    // Fetch the file from Cloudinary
    const https = require('https');
    const url = new URL(bill_copy);
    
    https.get(url, (fileRes) => {
      if (fileRes.statusCode !== 200) {
        return res.status(502).json({ message: 'Failed to fetch file from storage' });
      }

      // Determine filename and content type
      const ext = bill_copy.split('.').pop().toLowerCase();
      const mimeTypes = {
        pdf: 'application/pdf',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        webp: 'image/webp',
      };
      const contentType = mimeTypes[ext] || 'application/octet-stream';
      const filename = `${title || 'bill'}.${ext}`;

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
      
      fileRes.pipe(res);
    }).on('error', (err) => {
      console.error('Bill download error:', err);
      return res.status(500).json({ message: 'Failed to download file' });
    });
  } catch (err) {
    console.error('Bill download error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
