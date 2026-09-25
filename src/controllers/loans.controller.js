const db = require('../config/db');

let tableChecked = false;
async function ensureTable() {
  if (tableChecked) return;
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS loans (
        id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        title           VARCHAR(255) NOT NULL,
        amount          DECIMAL(12,2) NOT NULL DEFAULT 0,
        loan_date       DATE NOT NULL,
        lender_type     VARCHAR(100) NOT NULL DEFAULT 'Bank Loan',
        payment_mode    ENUM('Cash','UPI','Bank','Card','Cheque') NOT NULL DEFAULT 'Bank',
        reference_no    VARCHAR(100) DEFAULT NULL,
        note            TEXT DEFAULT NULL,
        created_by      INT UNSIGNED NOT NULL,
        deleted         TINYINT(1) NOT NULL DEFAULT 0,
        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_loans_created FOREIGN KEY (created_by) REFERENCES users(id)
      ) ENGINE=InnoDB;
    `);
    tableChecked = true;
  } catch (err) {
    tableChecked = true;
  }
}

// ─── GET /api/loans ───────────────────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    await ensureTable();
    const { lender_type, search, from, to, payment_mode } = req.query;
    let where = 'l.deleted = 0';
    const params = [];

    if (lender_type && lender_type !== 'all') {
      where += ' AND l.lender_type = ?';
      params.push(lender_type);
    }
    if (from) {
      where += ' AND l.loan_date >= ?';
      params.push(from);
    }
    if (to) {
      where += ' AND l.loan_date <= ?';
      params.push(to);
    }
    if (payment_mode && payment_mode !== 'all') {
      where += ' AND l.payment_mode = ?';
      params.push(payment_mode);
    }
    if (search) {
      where += ' AND (l.title LIKE ? OR l.note LIKE ? OR l.lender_type LIKE ? OR l.reference_no LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s);
    }

    const [rows] = await db.query(
      `SELECT l.*,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM loans l
       LEFT JOIN users u ON u.id = l.created_by
       WHERE ${where}
       ORDER BY l.loan_date DESC, l.created_at DESC`,
      params
    );

    const summary = {
      total_count: rows.length,
      total_amount: rows.reduce((sum, r) => sum + parseFloat(r.amount || 0), 0),
    };

    return res.json({ loans: rows, summary });
  } catch (err) {
    console.error('Loans list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── GET /api/loans/:id ───────────────────────────────────────────────────────
exports.getOne = async (req, res) => {
  try {
    await ensureTable();
    const [rows] = await db.query(
      `SELECT l.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM loans l
       LEFT JOIN users u ON u.id = l.created_by
       WHERE l.id = ? AND l.deleted = 0`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Loan entry not found' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('Loans getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── POST /api/loans ──────────────────────────────────────────────────────────
exports.create = async (req, res) => {
  try {
    await ensureTable();
    const { title, amount, loan_date, lender_type, payment_mode, reference_no, note } = req.body;

    if (!title || !amount) {
      return res.status(400).json({ message: 'Title and amount are required' });
    }

    const [result] = await db.query(
      `INSERT INTO loans (title, amount, loan_date, lender_type, payment_mode, reference_no, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title,
        parseFloat(amount),
        loan_date || new Date().toISOString().split('T')[0],
        lender_type || 'Bank Loan',
        payment_mode || 'Bank',
        reference_no || null,
        note || null,
        req.user.id
      ]
    );

    const [created] = await db.query(
      `SELECT l.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM loans l LEFT JOIN users u ON u.id = l.created_by WHERE l.id = ?`,
      [result.insertId]
    );
    return res.status(201).json(created[0]);
  } catch (err) {
    console.error('Loans create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── PUT /api/loans/:id ───────────────────────────────────────────────────────
exports.update = async (req, res) => {
  try {
    await ensureTable();
    const [rows] = await db.query('SELECT * FROM loans WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Loan entry not found' });

    const existing = rows[0];
    const { title, amount, loan_date, lender_type, payment_mode, reference_no, note } = req.body;

    await db.query(
      `UPDATE loans SET title = ?, amount = ?, loan_date = ?, lender_type = ?, payment_mode = ?, reference_no = ?, note = ?
       WHERE id = ?`,
      [
        title !== undefined ? title : existing.title,
        amount !== undefined ? parseFloat(amount) : existing.amount,
        loan_date || existing.loan_date,
        lender_type || existing.lender_type,
        payment_mode || existing.payment_mode,
        reference_no !== undefined ? reference_no : existing.reference_no,
        note !== undefined ? note : existing.note,
        req.params.id
      ]
    );

    const [updated] = await db.query(
      `SELECT l.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM loans l LEFT JOIN users u ON u.id = l.created_by WHERE l.id = ?`,
      [req.params.id]
    );
    return res.json(updated[0]);
  } catch (err) {
    console.error('Loans update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── DELETE /api/loans/:id ────────────────────────────────────────────────────
exports.remove = async (req, res) => {
  try {
    await ensureTable();
    const [rows] = await db.query('SELECT * FROM loans WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Loan entry not found' });

    await db.query('UPDATE loans SET deleted = 1 WHERE id = ?', [req.params.id]);
    return res.json({ message: 'Loan entry deleted' });
  } catch (err) {
    console.error('Loans delete error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
