const db = require('../config/db');

let tableChecked = false;
async function ensureTable() {
  if (tableChecked) return;
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS other_credits (
        id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        title           VARCHAR(255) NOT NULL,
        amount          DECIMAL(12,2) NOT NULL DEFAULT 0,
        credit_date     DATE NOT NULL,
        category        VARCHAR(100) NOT NULL DEFAULT 'Other',
        payment_mode    ENUM('Cash','UPI','Bank','Card','Cheque') NOT NULL DEFAULT 'Bank',
        reference_no    VARCHAR(100) DEFAULT NULL,
        note            TEXT DEFAULT NULL,
        created_by      INT UNSIGNED NOT NULL,
        deleted         TINYINT(1) NOT NULL DEFAULT 0,
        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_other_credits_created FOREIGN KEY (created_by) REFERENCES users(id)
      ) ENGINE=InnoDB;
    `);
    tableChecked = true;
  } catch (err) {
    tableChecked = true;
  }
}

// ─── GET /api/other-credits ───────────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    await ensureTable();
    const { category, search, from, to, payment_mode } = req.query;
    let where = 'oc.deleted = 0';
    const params = [];

    if (category && category !== 'all') {
      where += ' AND oc.category = ?';
      params.push(category);
    }
    if (from) {
      where += ' AND oc.credit_date >= ?';
      params.push(from);
    }
    if (to) {
      where += ' AND oc.credit_date <= ?';
      params.push(to);
    }
    if (payment_mode && payment_mode !== 'all') {
      where += ' AND oc.payment_mode = ?';
      params.push(payment_mode);
    }
    if (search) {
      where += ' AND (oc.title LIKE ? OR oc.note LIKE ? OR oc.category LIKE ? OR oc.reference_no LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    const [rows] = await db.query(
      `SELECT oc.*,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM other_credits oc
       LEFT JOIN users u ON u.id = oc.created_by
       WHERE ${where}
       ORDER BY oc.credit_date DESC, oc.created_at DESC`,
      params
    );

    const summary = {
      total_count: rows.length,
      total_amount: rows.reduce((sum, r) => sum + parseFloat(r.amount || 0), 0),
    };

    return res.json({ credits: rows, summary });
  } catch (err) {
    console.error('Other credits list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── GET /api/other-credits/:id ───────────────────────────────────────────────
exports.getOne = async (req, res) => {
  try {
    await ensureTable();
    const [rows] = await db.query(
      `SELECT oc.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM other_credits oc
       LEFT JOIN users u ON u.id = oc.created_by
       WHERE oc.id = ? AND oc.deleted = 0`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Credit entry not found' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('Other credits getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── POST /api/other-credits ──────────────────────────────────────────────────
exports.create = async (req, res) => {
  try {
    await ensureTable();
    const { title, amount, credit_date, category, payment_mode, reference_no, note } = req.body;

    if (!title || !amount) {
      return res.status(400).json({ message: 'Title and amount are required' });
    }

    const [result] = await db.query(
      `INSERT INTO other_credits (title, amount, credit_date, category, payment_mode, reference_no, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title,
        parseFloat(amount),
        credit_date || new Date().toISOString().split('T')[0],
        category || 'Other',
        payment_mode || 'Bank',
        reference_no || null,
        note || null,
        req.user.id
      ]
    );

    const [created] = await db.query(
      `SELECT oc.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM other_credits oc LEFT JOIN users u ON u.id = oc.created_by WHERE oc.id = ?`,
      [result.insertId]
    );
    return res.status(201).json(created[0]);
  } catch (err) {
    console.error('Other credits create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── PUT /api/other-credits/:id ───────────────────────────────────────────────
exports.update = async (req, res) => {
  try {
    await ensureTable();
    const [rows] = await db.query('SELECT * FROM other_credits WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Credit entry not found' });

    const existing = rows[0];
    const { title, amount, credit_date, category, payment_mode, reference_no, note } = req.body;

    await db.query(
      `UPDATE other_credits SET title = ?, amount = ?, credit_date = ?, category = ?, payment_mode = ?, reference_no = ?, note = ?
       WHERE id = ?`,
      [
        title !== undefined ? title : existing.title,
        amount !== undefined ? parseFloat(amount) : existing.amount,
        credit_date || existing.credit_date,
        category || existing.category,
        payment_mode || existing.payment_mode,
        reference_no !== undefined ? reference_no : existing.reference_no,
        note !== undefined ? note : existing.note,
        req.params.id
      ]
    );

    const [updated] = await db.query(
      `SELECT oc.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM other_credits oc LEFT JOIN users u ON u.id = oc.created_by WHERE oc.id = ?`,
      [req.params.id]
    );
    return res.json(updated[0]);
  } catch (err) {
    console.error('Other credits update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── DELETE /api/other-credits/:id ────────────────────────────────────────────
exports.remove = async (req, res) => {
  try {
    await ensureTable();
    const [rows] = await db.query('SELECT * FROM other_credits WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Credit entry not found' });

    await db.query('UPDATE other_credits SET deleted = 1 WHERE id = ?', [req.params.id]);
    return res.json({ message: 'Credit entry deleted' });
  } catch (err) {
    console.error('Other credits delete error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
