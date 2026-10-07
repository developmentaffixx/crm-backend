const db = require('../config/db');

let tableChecked = false;
async function ensureTable() {
  if (tableChecked) return;
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS withdrawal_returns (
        id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        title           VARCHAR(255) NOT NULL,
        amount          DECIMAL(12,2) NOT NULL DEFAULT 0,
        return_date     DATE NOT NULL,
        returned_by     ENUM('Founder','Partner','Other') NOT NULL DEFAULT 'Founder',
        payment_mode    ENUM('Cash','UPI','Bank','Card','Cheque') NOT NULL DEFAULT 'Bank',
        note            TEXT DEFAULT NULL,
        created_by      INT UNSIGNED NOT NULL,
        deleted         TINYINT(1) NOT NULL DEFAULT 0,
        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_withdrawal_returns_created FOREIGN KEY (created_by) REFERENCES users(id)
      ) ENGINE=InnoDB;
    `);
    tableChecked = true;
  } catch (err) {
    tableChecked = true;
  }
}

// ─── GET /api/withdrawal-returns ──────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    await ensureTable();
    const { returned_by, search, from, to, payment_mode } = req.query;
    let where = 'wr.deleted = 0';
    const params = [];

    if (returned_by) {
      where += ' AND wr.returned_by = ?';
      params.push(returned_by);
    }
    if (from) {
      where += ' AND wr.return_date >= ?';
      params.push(from);
    }
    if (to) {
      where += ' AND wr.return_date <= ?';
      params.push(to);
    }
    if (payment_mode && payment_mode !== 'all') {
      where += ' AND wr.payment_mode = ?';
      params.push(payment_mode);
    }
    if (search) {
      where += ' AND (wr.title LIKE ? OR wr.note LIKE ? OR wr.returned_by LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    const [rows] = await db.query(
      `SELECT wr.*,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM withdrawal_returns wr
       LEFT JOIN users u ON u.id = wr.created_by
       WHERE ${where}
       ORDER BY wr.return_date DESC, wr.created_at DESC`,
      params
    );

    const summary = {
      total_count: rows.length,
      total_amount: rows.reduce((sum, r) => sum + parseFloat(r.amount || 0), 0),
    };

    return res.json({ withdrawal_returns: rows, summary });
  } catch (err) {
    console.error('Withdrawal returns list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── GET /api/withdrawal-returns/:id ──────────────────────────────────────────
exports.getOne = async (req, res) => {
  try {
    await ensureTable();
    const [rows] = await db.query(
      `SELECT wr.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM withdrawal_returns wr
       LEFT JOIN users u ON u.id = wr.created_by
       WHERE wr.id = ? AND wr.deleted = 0`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Withdrawal return not found' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('Withdrawal return getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── POST /api/withdrawal-returns ─────────────────────────────────────────────
exports.create = async (req, res) => {
  try {
    await ensureTable();
    const { title, amount, return_date, returned_by, payment_mode, note } = req.body;

    if (!title || !amount) {
      return res.status(400).json({ message: 'Title and amount are required' });
    }

    const [result] = await db.query(
      `INSERT INTO withdrawal_returns (title, amount, return_date, returned_by, payment_mode, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        title,
        parseFloat(amount),
        return_date || new Date().toISOString().split('T')[0],
        returned_by || 'Founder',
        payment_mode || 'Bank',
        note || null,
        req.user.id
      ]
    );

    const [created] = await db.query(
      `SELECT wr.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM withdrawal_returns wr LEFT JOIN users u ON u.id = wr.created_by WHERE wr.id = ?`,
      [result.insertId]
    );
    return res.status(201).json(created[0]);
  } catch (err) {
    console.error('Withdrawal return create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── PUT /api/withdrawal-returns/:id ──────────────────────────────────────────
exports.update = async (req, res) => {
  try {
    await ensureTable();
    const [rows] = await db.query('SELECT * FROM withdrawal_returns WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Withdrawal return not found' });

    const existing = rows[0];
    const { title, amount, return_date, returned_by, payment_mode, note } = req.body;

    await db.query(
      `UPDATE withdrawal_returns SET title = ?, amount = ?, return_date = ?, returned_by = ?, payment_mode = ?, note = ?
       WHERE id = ?`,
      [
        title !== undefined ? title : existing.title,
        amount !== undefined ? parseFloat(amount) : existing.amount,
        return_date || existing.return_date,
        returned_by || existing.returned_by,
        payment_mode || existing.payment_mode,
        note !== undefined ? note : existing.note,
        req.params.id
      ]
    );

    const [updated] = await db.query(
      `SELECT wr.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM withdrawal_returns wr LEFT JOIN users u ON u.id = wr.created_by WHERE wr.id = ?`,
      [req.params.id]
    );
    return res.json(updated[0]);
  } catch (err) {
    console.error('Withdrawal return update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── DELETE /api/withdrawal-returns/:id (soft delete) ─────────────────────────
exports.remove = async (req, res) => {
  try {
    await ensureTable();
    const [rows] = await db.query('SELECT * FROM withdrawal_returns WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Withdrawal return not found' });

    await db.query('UPDATE withdrawal_returns SET deleted = 1 WHERE id = ?', [req.params.id]);
    return res.json({ message: 'Withdrawal return deleted' });
  } catch (err) {
    console.error('Withdrawal return delete error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
