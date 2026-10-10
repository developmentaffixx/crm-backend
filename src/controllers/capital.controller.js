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
    const { month } = req.query; // 'YYYY-MM' or 'all'
    const isAll = !month || month === 'all';

    let startOfMonth = '';
    let endOfMonth = '';
    if (!isAll) {
      const [y, m] = month.split('-').map(Number);
      const lastDay = new Date(y, m, 0).getDate();
      startOfMonth = `${month}-01`;
      endOfMonth = `${month}-${String(lastDay).padStart(2, '0')}`;
    }

    // Capital
    const capitalSql = isAll
      ? `SELECT COALESCE(SUM(amount), 0) AS total_capital FROM capital WHERE deleted = 0`
      : `SELECT COALESCE(SUM(amount), 0) AS total_capital FROM capital WHERE deleted = 0 AND capital_date >= ? AND capital_date <= ?`;
    const [capitalRows] = await db.query(capitalSql, isAll ? [] : [startOfMonth, endOfMonth]);

    // Expenses
    const expenseSql = isAll
      ? `SELECT COALESCE(SUM(amount), 0) AS total_expenses FROM expenses WHERE deleted = 0`
      : `SELECT COALESCE(SUM(amount), 0) AS total_expenses FROM expenses WHERE deleted = 0 AND expense_date >= ? AND expense_date <= ?`;
    const [expenseRows] = await db.query(expenseSql, isAll ? [] : [startOfMonth, endOfMonth]);

    // Income (from invoice_payments or invoices fallback)
    let total_income = 0;
    if (isAll) {
      const [incomeRows] = await db.query(
        `SELECT COALESCE(SUM(paid_amount), 0) AS total_income FROM invoices WHERE deleted = 0 AND paid_amount > 0`
      );
      total_income = parseFloat(incomeRows[0].total_income || 0);
    } else {
      try {
        const [incomeRows] = await db.query(
          `SELECT COALESCE(SUM(amount), 0) AS total_income FROM invoice_payments WHERE deleted = 0 AND payment_date >= ? AND payment_date <= ?`,
          [startOfMonth, endOfMonth]
        );
        total_income = parseFloat(incomeRows[0].total_income || 0);
      } catch (_) {
        const [incomeRows] = await db.query(
          `SELECT COALESCE(SUM(paid_amount), 0) AS total_income FROM invoices WHERE deleted = 0 AND bill_date >= ? AND bill_date <= ?`,
          [startOfMonth, endOfMonth]
        );
        total_income = parseFloat(incomeRows[0].total_income || 0);
      }
    }

    // Withdrawals (informational)
    const withdrawalSql = isAll
      ? `SELECT COALESCE(SUM(amount), 0) AS total_withdrawals FROM withdrawals WHERE deleted = 0`
      : `SELECT COALESCE(SUM(amount), 0) AS total_withdrawals FROM withdrawals WHERE deleted = 0 AND withdrawal_date >= ? AND withdrawal_date <= ?`;
    const [withdrawalRows] = await db.query(withdrawalSql, isAll ? [] : [startOfMonth, endOfMonth]);

    // Loans
    let total_loans = 0;
    try {
      const loanSql = isAll
        ? `SELECT COALESCE(SUM(amount), 0) AS total_loans FROM loans WHERE deleted = 0`
        : `SELECT COALESCE(SUM(amount), 0) AS total_loans FROM loans WHERE deleted = 0 AND loan_date >= ? AND loan_date <= ?`;
      const [loanRows] = await db.query(loanSql, isAll ? [] : [startOfMonth, endOfMonth]);
      total_loans = parseFloat(loanRows[0].total_loans || 0);
    } catch (_) {}

    // Other Credits
    let total_other_credits = 0;
    try {
      const credSql = isAll
        ? `SELECT COALESCE(SUM(amount), 0) AS total_credits FROM other_credits WHERE deleted = 0`
        : `SELECT COALESCE(SUM(amount), 0) AS total_credits FROM other_credits WHERE deleted = 0 AND credit_date >= ? AND credit_date <= ?`;
      const [creditRows] = await db.query(credSql, isAll ? [] : [startOfMonth, endOfMonth]);
      total_other_credits = parseFloat(creditRows[0].total_credits || 0);
    } catch (_) {}

    // Withdrawal Returns
    let total_withdrawal_returns = 0;
    try {
      const retSql = isAll
        ? `SELECT COALESCE(SUM(amount), 0) AS total_returns FROM withdrawal_returns WHERE deleted = 0`
        : `SELECT COALESCE(SUM(amount), 0) AS total_returns FROM withdrawal_returns WHERE deleted = 0 AND return_date >= ? AND return_date <= ?`;
      const [returnsRows] = await db.query(retSql, isAll ? [] : [startOfMonth, endOfMonth]);
      total_withdrawal_returns = parseFloat(returnsRows[0].total_returns || 0);
    } catch (_) {}

    const total_capital = parseFloat(capitalRows[0].total_capital);
    const total_expenses = parseFloat(expenseRows[0].total_expenses);
    const total_withdrawals = parseFloat(withdrawalRows[0].total_withdrawals);

    // Month's Net (inflows minus expenses for this specific month)
    const month_net = (total_capital + total_income + total_loans + total_other_credits + total_withdrawal_returns) - total_expenses;

    // Cumulative closing balance up to this month-end (or all-time)
    let net_balance = month_net;
    if (isAll) {
      net_balance = month_net;
    } else {
      const [cumCap] = await db.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM capital WHERE deleted = 0 AND capital_date <= ?`, [endOfMonth]);
      const [cumExp] = await db.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE deleted = 0 AND expense_date <= ?`, [endOfMonth]);
      let cumIncAmt = 0;
      try {
        const [cumInc] = await db.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM invoice_payments WHERE deleted = 0 AND payment_date <= ?`, [endOfMonth]);
        cumIncAmt = parseFloat(cumInc[0].total || 0);
      } catch (_) {
        const [cumInc] = await db.query(`SELECT COALESCE(SUM(paid_amount), 0) AS total FROM invoices WHERE deleted = 0 AND bill_date <= ?`, [endOfMonth]);
        cumIncAmt = parseFloat(cumInc[0].total || 0);
      }
      let cumLoanAmt = 0;
      try {
        const [cumLoan] = await db.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM loans WHERE deleted = 0 AND loan_date <= ?`, [endOfMonth]);
        cumLoanAmt = parseFloat(cumLoan[0].total || 0);
      } catch (_) {}
      let cumCredAmt = 0;
      try {
        const [cumCred] = await db.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM other_credits WHERE deleted = 0 AND credit_date <= ?`, [endOfMonth]);
        cumCredAmt = parseFloat(cumCred[0].total || 0);
      } catch (_) {}
      let cumRetAmt = 0;
      try {
        const [cumRet] = await db.query(`SELECT COALESCE(SUM(amount), 0) AS total FROM withdrawal_returns WHERE deleted = 0 AND return_date <= ?`, [endOfMonth]);
        cumRetAmt = parseFloat(cumRet[0].total || 0);
      } catch (_) {}

      net_balance = (parseFloat(cumCap[0].total) + cumIncAmt + cumLoanAmt + cumCredAmt + cumRetAmt) - parseFloat(cumExp[0].total);
    }

    return res.json({
      selected_month: month || 'all',
      total_capital,
      total_income,
      total_loans,
      total_other_credits,
      total_withdrawal_returns,
      total_expenses,
      total_withdrawals,
      month_net,
      net_balance
    });
  } catch (err) {
    console.error('Capital totals error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

