const db = require('../config/db');

let schemaChecked = false;
async function ensureSchema() {
  if (schemaChecked) return;
  try {
    await db.query(`ALTER TABLE capital MODIFY COLUMN source VARCHAR(100) NOT NULL DEFAULT 'Founder'`);
    schemaChecked = true;
  } catch (err) {
    schemaChecked = true;
  }
}

// ─── GET /api/capital ─────────────────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    await ensureSchema();
    const { source, not_source, search, from, to, payment_mode } = req.query;
    let where = 'c.deleted = 0';
    const params = [];

    if (source) {
      if (source.includes(',')) {
        const sources = source.split(',').map(s => s.trim()).filter(Boolean);
        where += ` AND c.source IN (${sources.map(() => '?').join(',')})`;
        params.push(...sources);
      } else {
        where += ' AND c.source = ?';
        params.push(source);
      }
    }
    if (not_source) {
      if (not_source.includes(',')) {
        const notSources = not_source.split(',').map(s => s.trim()).filter(Boolean);
        where += ` AND c.source NOT IN (${notSources.map(() => '?').join(',')})`;
        params.push(...notSources);
      } else {
        where += ' AND c.source != ?';
        params.push(not_source);
      }
    }
    if (from) {
      where += ' AND c.capital_date >= ?';
      params.push(from);
    }
    if (to) {
      where += ' AND c.capital_date <= ?';
      params.push(to);
    }
    if (payment_mode && payment_mode !== 'all') {
      where += ' AND c.payment_mode = ?';
      params.push(payment_mode);
    }
    if (search) {
      where += ' AND (c.title LIKE ? OR c.note LIKE ? OR c.source LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
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
    await ensureSchema();
    let { title, amount, capital_date, source, payment_mode, transaction_id, note } = req.body;

    if (!title || !amount) {
      return res.status(400).json({ message: 'Title and amount are required' });
    }

    let insertSource = source || 'Founder';
    let result;
    try {
      [result] = await db.query(
        `INSERT INTO capital (title, amount, capital_date, source, payment_mode, transaction_id, note, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          title,
          parseFloat(amount),
          capital_date || new Date().toISOString().split('T')[0],
          insertSource,
          payment_mode || 'Bank',
          transaction_id || null,
          note || null,
          req.user.id
        ]
      );
    } catch (insertErr) {
      // Fallback if source column is restricted ENUM
      if (insertSource === 'Other Credits') {
        [result] = await db.query(
          `INSERT INTO capital (title, amount, capital_date, source, payment_mode, transaction_id, note, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            title,
            parseFloat(amount),
            capital_date || new Date().toISOString().split('T')[0],
            'Other',
            payment_mode || 'Bank',
            transaction_id || null,
            note ? `[Other Credits] ${note}` : '[Other Credits]',
            req.user.id
          ]
        );
      } else {
        throw insertErr;
      }
    }

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
    await ensureSchema();
    const [rows] = await db.query('SELECT * FROM capital WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Capital entry not found' });

    const existing = rows[0];
    const { title, amount, capital_date, source, payment_mode, transaction_id, note } = req.body;

    let updateSource = source || existing.source;
    try {
      await db.query(
        `UPDATE capital SET title = ?, amount = ?, capital_date = ?, source = ?, payment_mode = ?, transaction_id = ?, note = ?
         WHERE id = ?`,
        [
          title !== undefined ? title : existing.title,
          amount !== undefined ? parseFloat(amount) : existing.amount,
          capital_date || existing.capital_date,
          updateSource,
          payment_mode || existing.payment_mode,
          transaction_id !== undefined ? transaction_id : existing.transaction_id,
          note !== undefined ? note : existing.note,
          req.params.id
        ]
      );
    } catch (updateErr) {
      if (updateSource === 'Other Credits') {
        await db.query(
          `UPDATE capital SET title = ?, amount = ?, capital_date = ?, source = ?, payment_mode = ?, transaction_id = ?, note = ?
           WHERE id = ?`,
          [
            title !== undefined ? title : existing.title,
            amount !== undefined ? parseFloat(amount) : existing.amount,
            capital_date || existing.capital_date,
            'Other',
            payment_mode || existing.payment_mode,
            transaction_id !== undefined ? transaction_id : existing.transaction_id,
            note !== undefined ? note : existing.note,
            req.params.id
          ]
        );
      } else {
        throw updateErr;
      }
    }

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
    const [withdrawalRows] = await db.query(
      `SELECT COALESCE(SUM(amount), 0) AS total_withdrawals FROM withdrawals WHERE deleted = 0`
    );

    let total_loans = 0;
    try {
      const [loanRows] = await db.query(`SELECT COALESCE(SUM(amount), 0) AS total_loans FROM loans WHERE deleted = 0`);
      total_loans = parseFloat(loanRows[0].total_loans || 0);
    } catch (_) {}

    let total_other_credits = 0;
    try {
      const [creditRows] = await db.query(`SELECT COALESCE(SUM(amount), 0) AS total_credits FROM other_credits WHERE deleted = 0`);
      total_other_credits = parseFloat(creditRows[0].total_credits || 0);
    } catch (_) {}

    const total_capital = parseFloat(capitalRows[0].total_capital);
    const total_expenses = parseFloat(expenseRows[0].total_expenses);
    const total_income = parseFloat(incomeRows[0].total_income);
    const total_withdrawals = parseFloat(withdrawalRows[0].total_withdrawals);
    const net_balance = (total_capital + total_income + total_loans + total_other_credits) - (total_expenses + total_withdrawals);

    return res.json({ total_capital, total_income, total_loans, total_other_credits, total_expenses, total_withdrawals, net_balance });
  } catch (err) {
    console.error('Capital totals error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
