const db = require('../config/db');
const path = require('path');
const fs = require('fs');

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
      category, vendor_name, amount, payment_mode
    } = req.body;

    if (!title || !vendor_name) {
      return res.status(400).json({ message: 'Title and vendor name are required' });
    }

    // Handle file upload
    let bill_copy = null;
    if (req.file) {
      const filename = `expense-bill-${Date.now()}${path.extname(req.file.originalname)}`;
      const uploadDir = path.join(__dirname, '../../uploads');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      const filepath = path.join(uploadDir, filename);
      fs.writeFileSync(filepath, req.file.buffer);
      bill_copy = `/uploads/${filename}`;
    }

    const [result] = await db.query(
      `INSERT INTO expenses (title, expense_date, expense_type, client_id, project_id, category, vendor_name, amount, payment_mode, bill_copy, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title,
        expense_date || new Date().toISOString().split('T')[0],
        expense_type || 'company',
        client_id || null,
        project_id || null,
        category || 'Miscellaneous expense',
        vendor_name,
        parseFloat(amount || 0),
        payment_mode || 'Cash',
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
      category, vendor_name, amount, payment_mode
    } = req.body;

    // Handle file upload
    let bill_copy = existing.bill_copy;
    if (req.file) {
      const filename = `expense-bill-${Date.now()}${path.extname(req.file.originalname)}`;
      const uploadDir = path.join(__dirname, '../../uploads');
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      const filepath = path.join(uploadDir, filename);
      fs.writeFileSync(filepath, req.file.buffer);
      bill_copy = `/uploads/${filename}`;
    }

    await db.query(
      `UPDATE expenses SET
        title = ?, expense_date = ?, expense_type = ?, client_id = ?, project_id = ?,
        category = ?, vendor_name = ?, amount = ?, payment_mode = ?, bill_copy = ?
       WHERE id = ?`,
      [
        title !== undefined ? title : existing.title,
        expense_date || existing.expense_date,
        expense_type || existing.expense_type,
        expense_type === 'client' ? (client_id || existing.client_id) : null,
        expense_type === 'client' ? (project_id || existing.project_id) : null,
        category || existing.category,
        vendor_name !== undefined ? vendor_name : existing.vendor_name,
        amount !== undefined ? parseFloat(amount) : existing.amount,
        payment_mode || existing.payment_mode,
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
