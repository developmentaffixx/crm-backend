const db = require('../config/db');

// ─── Helper: Calculate next run date based on frequency ───────────────────────
function calculateNextRunDate(fromDate, frequency, repeatDay) {
  const date = new Date(fromDate);

  switch (frequency) {
    case 'daily':
      date.setDate(date.getDate() + 1);
      break;

    case 'weekly':
      date.setDate(date.getDate() + 7);
      break;

    case 'monthly': {
      date.setMonth(date.getMonth() + 1);
      // Handle months with fewer days (e.g., repeat_day=31 in Feb → last day)
      if (repeatDay) {
        const maxDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
        date.setDate(Math.min(repeatDay, maxDay));
      }
      break;
    }

    case 'quarterly': {
      date.setMonth(date.getMonth() + 3);
      if (repeatDay) {
        const maxDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
        date.setDate(Math.min(repeatDay, maxDay));
      }
      break;
    }

    case 'yearly':
      date.setFullYear(date.getFullYear() + 1);
      break;

    default:
      date.setMonth(date.getMonth() + 1);
  }

  return date.toISOString().split('T')[0];
}

// ─── GET /api/recurring-expenses ──────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT re.*,
              l.name AS client_name,
              l.business_name AS client_business,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM recurring_expenses re
       LEFT JOIN leads l ON l.id = re.client_id
       LEFT JOIN users u ON u.id = re.created_by
       WHERE re.deleted = 0
       ORDER BY re.status ASC, re.next_run_date ASC`,
    );

    return res.json({ recurring_expenses: rows });
  } catch (err) {
    console.error('Recurring expenses list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── GET /api/recurring-expenses/:id ──────────────────────────────────────────
exports.getOne = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT re.*,
              l.name AS client_name,
              l.business_name AS client_business,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM recurring_expenses re
       LEFT JOIN leads l ON l.id = re.client_id
       LEFT JOIN users u ON u.id = re.created_by
       WHERE re.id = ? AND re.deleted = 0`,
      [req.params.id]
    );

    if (rows.length === 0) return res.status(404).json({ message: 'Recurring expense not found' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('Recurring expense getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── POST /api/recurring-expenses ─────────────────────────────────────────────
exports.create = async (req, res) => {
  try {
    const {
      title, amount, category, other_category, vendor_name, payment_mode,
      expense_type, client_id, project_id,
      frequency, repeat_day, start_date, end_date
    } = req.body;

    if (!title || !vendor_name || !amount || !frequency || !start_date) {
      return res.status(400).json({ message: 'Title, vendor, amount, frequency, and start date are required' });
    }

    // Calculate first next_run_date (same as start_date for the first run)
    const next_run_date = start_date;

    const [result] = await db.query(
      `INSERT INTO recurring_expenses
        (title, amount, category, other_category, vendor_name, payment_mode,
         expense_type, client_id, project_id,
         frequency, repeat_day, start_date, end_date, next_run_date, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
      [
        title,
        parseFloat(amount),
        category || 'Miscellaneous expense',
        other_category || null,
        vendor_name,
        payment_mode || 'Cash',
        expense_type || 'company',
        client_id || null,
        project_id || null,
        frequency,
        repeat_day || null,
        start_date,
        end_date || null,
        next_run_date,
        req.user.id
      ]
    );

    const [created] = await db.query(
      `SELECT re.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM recurring_expenses re
       LEFT JOIN users u ON u.id = re.created_by
       WHERE re.id = ?`,
      [result.insertId]
    );

    return res.status(201).json(created[0]);
  } catch (err) {
    console.error('Recurring expense create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── PUT /api/recurring-expenses/:id ──────────────────────────────────────────
exports.update = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM recurring_expenses WHERE id = ? AND deleted = 0',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Recurring expense not found' });

    const existing = rows[0];
    const {
      title, amount, category, other_category, vendor_name, payment_mode,
      expense_type, client_id, project_id,
      frequency, repeat_day, start_date, end_date
    } = req.body;

    // Recalculate next_run_date if frequency or start_date changed
    let next_run_date = existing.next_run_date;
    const newFrequency = frequency || existing.frequency;
    const newRepeatDay = repeat_day !== undefined ? repeat_day : existing.repeat_day;

    if (frequency && frequency !== existing.frequency) {
      next_run_date = calculateNextRunDate(
        new Date().toISOString().split('T')[0],
        newFrequency,
        newRepeatDay
      );
    }

    await db.query(
      `UPDATE recurring_expenses SET
        title = ?, amount = ?, category = ?, other_category = ?, vendor_name = ?, payment_mode = ?,
        expense_type = ?, client_id = ?, project_id = ?,
        frequency = ?, repeat_day = ?, start_date = ?, end_date = ?, next_run_date = ?
       WHERE id = ?`,
      [
        title !== undefined ? title : existing.title,
        amount !== undefined ? parseFloat(amount) : existing.amount,
        category || existing.category,
        other_category !== undefined ? other_category : existing.other_category,
        vendor_name !== undefined ? vendor_name : existing.vendor_name,
        payment_mode || existing.payment_mode,
        expense_type || existing.expense_type,
        client_id !== undefined ? (client_id || null) : existing.client_id,
        project_id !== undefined ? (project_id || null) : existing.project_id,
        newFrequency,
        newRepeatDay,
        start_date || existing.start_date,
        end_date !== undefined ? (end_date || null) : existing.end_date,
        next_run_date,
        req.params.id
      ]
    );

    const [updated] = await db.query(
      `SELECT re.*, CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM recurring_expenses re
       LEFT JOIN users u ON u.id = re.created_by
       WHERE re.id = ?`,
      [req.params.id]
    );

    return res.json(updated[0]);
  } catch (err) {
    console.error('Recurring expense update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── PATCH /api/recurring-expenses/:id/pause ──────────────────────────────────
exports.pause = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM recurring_expenses WHERE id = ? AND deleted = 0',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Recurring expense not found' });
    if (rows[0].status !== 'active') return res.status(400).json({ message: 'Only active recurring expenses can be paused' });

    await db.query('UPDATE recurring_expenses SET status = ? WHERE id = ?', ['paused', req.params.id]);
    return res.json({ message: 'Recurring expense paused', id: req.params.id });
  } catch (err) {
    console.error('Recurring expense pause error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── PATCH /api/recurring-expenses/:id/resume ─────────────────────────────────
exports.resume = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM recurring_expenses WHERE id = ? AND deleted = 0',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Recurring expense not found' });
    if (rows[0].status !== 'paused') return res.status(400).json({ message: 'Only paused recurring expenses can be resumed' });

    // Recalculate next_run_date from today
    const today = new Date().toISOString().split('T')[0];
    const next_run_date = calculateNextRunDate(today, rows[0].frequency, rows[0].repeat_day);

    await db.query(
      'UPDATE recurring_expenses SET status = ?, next_run_date = ? WHERE id = ?',
      ['active', next_run_date, req.params.id]
    );
    return res.json({ message: 'Recurring expense resumed', id: req.params.id, next_run_date });
  } catch (err) {
    console.error('Recurring expense resume error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── DELETE /api/recurring-expenses/:id (soft delete) ─────────────────────────
exports.remove = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM recurring_expenses WHERE id = ? AND deleted = 0',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Recurring expense not found' });

    await db.query('UPDATE recurring_expenses SET deleted = 1, status = ? WHERE id = ?', ['completed', req.params.id]);
    return res.json({ message: 'Recurring expense deleted' });
  } catch (err) {
    console.error('Recurring expense delete error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Export helper for cron job
exports.calculateNextRunDate = calculateNextRunDate;
