const db = require('../config/db');

// ─── GET /api/capital ─────────────────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    const { source, search } = req.query;
    let where = 'c.deleted = 0';
    const params = [];

    if (source) { where += ' AND c.source = ?'; params.push(source); }
    if (search) {
      where += ' AND (c.title LIKE ? OR c.note LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s);
    }

    const [rows] = await db.query(
      `SELECT c.*,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM capital c
       LEFT JOIN users u ON u.id = c.created_by
       WHERE ${where}
       ORDER BY c.capital_date DESC, c.created_at DESC`,
      params
    );

    const summary = {
      total_count: rows.length,
      total_amount: rows.reduce((sum, r) => sum + parseFloat(r.amount || 0), 0),
    };

    return res.json({ capital: rows, summary });
  } catch (err) {
    console.error('Capital list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── GET /api/capital/:id ─────────────────────────────────────────────────────
exports.getOne = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT c.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM capital c
       LEFT JOIN users u ON u.id = c.created_by
       WHERE c.id = ? AND c.deleted = 0`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Capital entry not found' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('Capital getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── POST /api/capital ────────────────────────────────────────────────────────
exports.create = async (req, res) => {
  try {
    const { title, amount, capital_date, source, payment_mode, note } = req.body;

    if (!title || !amount) {
      return res.status(400).json({ message: 'Title and amount are required' });
    }

    const [result] = await db.query(
      `INSERT INTO capital (title, amount, capital_date, source, payment_mode, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        title,
        parseFloat(amount),
        capital_date || new Date().toISOString().split('T')[0],
        source || 'Founder',
        payment_mode || 'Bank',
        note || null,
        req.user.id
      ]
    );

    const [created] = await db.query(
      `SELECT c.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM capital c LEFT JOIN users u ON u.id = c.created_by WHERE c.id = ?`,
      [result.insertId]
    );
    return res.status(201).json(created[0]);
  } catch (err) {
    console.error('Capital create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── PUT /api/capital/:id ─────────────────────────────────────────────────────
exports.update = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM capital WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Capital entry not found' });

    const existing = rows[0];
    const { title, amount, capital_date, source, payment_mode, note } = req.body;

    await db.query(
      `UPDATE capital SET title = ?, amount = ?, capital_date = ?, source = ?, payment_mode = ?, note = ?
       WHERE id = ?`,
      [
        title !== undefined ? title : existing.title,
        amount !== undefined ? parseFloat(amount) : existing.amount,
        capital_date || existing.capital_date,
        source || existing.source,
        payment_mode || existing.payment_mode,
        note !== undefined ? note : existing.note,
        req.params.id
      ]
    );

    const [updated] = await db.query(
      `SELECT c.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM capital c LEFT JOIN users u ON u.id = c.created_by WHERE c.id = ?`,
      [req.params.id]
    );
    return res.json(updated[0]);
  } catch (err) {
    console.error('Capital update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── DELETE /api/capital/:id (soft delete) ────────────────────────────────────
exports.remove = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM capital WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Capital entry not found' });

    await db.query('UPDATE capital SET deleted = 1 WHERE id = ?', [req.params.id]);
    return res.json({ message: 'Capital entry deleted' });
  } catch (err) {
    console.error('Capital delete error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── GET /api/capital/summary/totals — For P&L ───────────────────────────────
exports.totals = async (req, res) => {
  try {
    const [capitalRows] = await db.query(
      `SELECT COALESCE(SUM(amount), 0) AS total_capital FROM capital WHERE deleted = 0`
    );
    const [expenseRows] = await db.query(
      `SELECT COALESCE(SUM(amount), 0) AS total_expenses FROM expenses WHERE deleted = 0`
    );
    const [incomeRows] = await db.query(
      `SELECT COALESCE(SUM(paid_amount), 0) AS total_income FROM invoices WHERE deleted = 0 AND paid_amount > 0`
    );

    const total_capital = parseFloat(capitalRows[0].total_capital);
    const total_expenses = parseFloat(expenseRows[0].total_expenses);
    const total_income = parseFloat(incomeRows[0].total_income);
    const net_balance = (total_capital + total_income) - total_expenses;

    return res.json({ total_capital, total_income, total_expenses, net_balance });
  } catch (err) {
    console.error('Capital totals error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
