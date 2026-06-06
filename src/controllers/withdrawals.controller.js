const db = require('../config/db');

// ─── GET /api/withdrawals ─────────────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    const { recipient, search } = req.query;
    let where = 'w.deleted = 0';
    const params = [];

    if (recipient) { where += ' AND w.recipient = ?'; params.push(recipient); }
    if (search) {
      where += ' AND (w.title LIKE ? OR w.note LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s);
    }

    const [rows] = await db.query(
      `SELECT w.*,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM withdrawals w
       LEFT JOIN users u ON u.id = w.created_by
       WHERE ${where}
       ORDER BY w.withdrawal_date DESC, w.created_at DESC`,
      params
    );

    const summary = {
      total_count: rows.length,
      total_amount: rows.reduce((sum, r) => sum + parseFloat(r.amount || 0), 0),
    };

    return res.json({ withdrawals: rows, summary });
  } catch (err) {
    console.error('Withdrawals list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── GET /api/withdrawals/:id ─────────────────────────────────────────────────
exports.getOne = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT w.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM withdrawals w
       LEFT JOIN users u ON u.id = w.created_by
       WHERE w.id = ? AND w.deleted = 0`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Withdrawal not found' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('Withdrawal getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── POST /api/withdrawals ────────────────────────────────────────────────────
exports.create = async (req, res) => {
  try {
    const { title, amount, withdrawal_date, recipient, payment_mode, note } = req.body;

    if (!title || !amount) {
      return res.status(400).json({ message: 'Title and amount are required' });
    }

    const [result] = await db.query(
      `INSERT INTO withdrawals (title, amount, withdrawal_date, recipient, payment_mode, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        title,
        parseFloat(amount),
        withdrawal_date || new Date().toISOString().split('T')[0],
        recipient || 'Founder',
        payment_mode || 'Bank',
        note || null,
        req.user.id
      ]
    );

    const [created] = await db.query(
      `SELECT w.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM withdrawals w LEFT JOIN users u ON u.id = w.created_by WHERE w.id = ?`,
      [result.insertId]
    );
    return res.status(201).json(created[0]);
  } catch (err) {
    console.error('Withdrawal create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── PUT /api/withdrawals/:id ─────────────────────────────────────────────────
exports.update = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM withdrawals WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Withdrawal not found' });

    const existing = rows[0];
    const { title, amount, withdrawal_date, recipient, payment_mode, note } = req.body;

    await db.query(
      `UPDATE withdrawals SET title = ?, amount = ?, withdrawal_date = ?, recipient = ?, payment_mode = ?, note = ?
       WHERE id = ?`,
      [
        title !== undefined ? title : existing.title,
        amount !== undefined ? parseFloat(amount) : existing.amount,
        withdrawal_date || existing.withdrawal_date,
        recipient || existing.recipient,
        payment_mode || existing.payment_mode,
        note !== undefined ? note : existing.note,
        req.params.id
      ]
    );

    const [updated] = await db.query(
      `SELECT w.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM withdrawals w LEFT JOIN users u ON u.id = w.created_by WHERE w.id = ?`,
      [req.params.id]
    );
    return res.json(updated[0]);
  } catch (err) {
    console.error('Withdrawal update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── DELETE /api/withdrawals/:id (soft delete) ────────────────────────────────
exports.remove = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM withdrawals WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Withdrawal not found' });

    await db.query('UPDATE withdrawals SET deleted = 1 WHERE id = ?', [req.params.id]);
    return res.json({ message: 'Withdrawal deleted' });
  } catch (err) {
    console.error('Withdrawal delete error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
