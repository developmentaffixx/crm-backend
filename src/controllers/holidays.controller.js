const db = require('../config/db');

// ─── GET /api/holidays ────────────────────────────────────────────────────────
// List holidays with optional filters (year, category, month)
exports.list = async (req, res) => {
  try {
    const { year, category, month } = req.query;

    let sql = 'SELECT * FROM company_holidays WHERE 1=1';
    const params = [];

    if (year) {
      sql += ' AND YEAR(date) = ?';
      params.push(parseInt(year));
    }
    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }
    if (month) {
      sql += ' AND MONTH(date) = ?';
      params.push(parseInt(month));
    }

    sql += ' ORDER BY date ASC';

    const [rows] = await db.query(sql, params);
    return res.json(rows);
  } catch (err) {
    console.error('List holidays error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── GET /api/holidays/upcoming ───────────────────────────────────────────────
// Get next 5 upcoming holidays from today
exports.upcoming = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT * FROM company_holidays 
       WHERE date >= CURDATE() 
       ORDER BY date ASC 
       LIMIT 5`
    );
    return res.json(rows);
  } catch (err) {
    console.error('Upcoming holidays error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── GET /api/holidays/check/:date ────────────────────────────────────────────
// Check if a specific date is a holiday
exports.checkDate = async (req, res) => {
  try {
    const { date } = req.params;
    const [rows] = await db.query(
      'SELECT * FROM company_holidays WHERE date = ?',
      [date]
    );

    if (rows.length > 0) {
      return res.json({ is_holiday: true, holiday: rows[0] });
    }
    return res.json({ is_holiday: false });
  } catch (err) {
    console.error('Check date error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── POST /api/holidays ───────────────────────────────────────────────────────
// Create a new holiday
exports.create = async (req, res) => {
  try {
    const { date, title, holiday_type, half_day_session, category, is_recurring, description } = req.body;

    if (!date || !title) {
      return res.status(400).json({ message: 'Date and title are required' });
    }

    // Check if date already exists
    const [existing] = await db.query('SELECT id FROM company_holidays WHERE date = ?', [date]);
    if (existing.length > 0) {
      return res.status(409).json({ message: 'A holiday already exists on this date' });
    }

    const [result] = await db.query(
      `INSERT INTO company_holidays (date, title, holiday_type, half_day_session, category, is_recurring, description, declared_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        date,
        title,
        holiday_type || 'full_holiday',
        half_day_session || null,
        category || 'company',
        is_recurring ? 1 : 0,
        description || null,
        req.user.id
      ]
    );

    const [holiday] = await db.query('SELECT * FROM company_holidays WHERE id = ?', [result.insertId]);
    res.emitSocket('holidays:created', holiday[0]);
    return res.status(201).json(holiday[0]);
  } catch (err) {
    console.error('Create holiday error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── PUT /api/holidays/:id ────────────────────────────────────────────────────
// Update a holiday
exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const { date, title, holiday_type, half_day_session, category, is_recurring, description } = req.body;

    const [existing] = await db.query('SELECT * FROM company_holidays WHERE id = ?', [id]);
    if (!existing.length) {
      return res.status(404).json({ message: 'Holiday not found' });
    }

    // Check date conflict if date is changing
    if (date && date !== existing[0].date) {
      const [conflict] = await db.query('SELECT id FROM company_holidays WHERE date = ? AND id != ?', [date, id]);
      if (conflict.length > 0) {
        return res.status(409).json({ message: 'Another holiday already exists on this date' });
      }
    }

    const fields = [];
    const params = [];

    if (date !== undefined) { fields.push('date = ?'); params.push(date); }
    if (title !== undefined) { fields.push('title = ?'); params.push(title); }
    if (holiday_type !== undefined) { fields.push('holiday_type = ?'); params.push(holiday_type); }
    if (half_day_session !== undefined) { fields.push('half_day_session = ?'); params.push(half_day_session); }
    if (category !== undefined) { fields.push('category = ?'); params.push(category); }
    if (is_recurring !== undefined) { fields.push('is_recurring = ?'); params.push(is_recurring ? 1 : 0); }
    if (description !== undefined) { fields.push('description = ?'); params.push(description); }

    if (!fields.length) return res.status(400).json({ message: 'No fields to update' });

    params.push(id);
    await db.query(`UPDATE company_holidays SET ${fields.join(', ')} WHERE id = ?`, params);

    const [updated] = await db.query('SELECT * FROM company_holidays WHERE id = ?', [id]);
    return res.json(updated[0]);
  } catch (err) {
    console.error('Update holiday error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── DELETE /api/holidays/:id ─────────────────────────────────────────────────
exports.remove = async (req, res) => {
  try {
    const { id } = req.params;

    const [existing] = await db.query('SELECT * FROM company_holidays WHERE id = ?', [id]);
    if (!existing.length) {
      return res.status(404).json({ message: 'Holiday not found' });
    }

    await db.query('DELETE FROM company_holidays WHERE id = ?', [id]);
    res.emitSocket('holidays:deleted', { id: parseInt(id) });
    return res.json({ message: 'Holiday deleted' });
  } catch (err) {
    console.error('Delete holiday error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── POST /api/holidays/declare-today ─────────────────────────────────────────
// Quick declare today as holiday (for emergencies like rain, strike)
exports.declareToday = async (req, res) => {
  try {
    const { title, holiday_type, half_day_session, category } = req.body;

    if (!title) {
      return res.status(400).json({ message: 'Title is required' });
    }

    const today = new Date().toISOString().split('T')[0];

    // Check if already declared
    const [existing] = await db.query('SELECT id FROM company_holidays WHERE date = ?', [today]);
    if (existing.length > 0) {
      // Update existing
      await db.query(
        `UPDATE company_holidays SET title = ?, holiday_type = ?, half_day_session = ?, category = ?, declared_by = ? WHERE date = ?`,
        [title, holiday_type || 'full_holiday', half_day_session || null, category || 'emergency', req.user.id, today]
      );
    } else {
      await db.query(
        `INSERT INTO company_holidays (date, title, holiday_type, half_day_session, category, is_recurring, declared_by)
         VALUES (?, ?, ?, ?, ?, 0, ?)`,
        [today, title, holiday_type || 'full_holiday', half_day_session || null, category || 'emergency', req.user.id]
      );
    }

    const [holiday] = await db.query('SELECT * FROM company_holidays WHERE date = ?', [today]);
    res.emitSocket('holidays:emergency', holiday[0]);
    return res.status(201).json(holiday[0]);
  } catch (err) {
    console.error('Declare today error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── POST /api/holidays/generate-recurring ────────────────────────────────────
// Generate recurring holidays for a given year
exports.generateRecurring = async (req, res) => {
  try {
    const { year } = req.body;
    const targetYear = year || new Date().getFullYear() + 1;

    // Get all recurring holidays
    const [recurring] = await db.query(
      'SELECT * FROM company_holidays WHERE is_recurring = 1'
    );

    let created = 0;
    for (const holiday of recurring) {
      const originalDate = new Date(holiday.date);
      const newDate = `${targetYear}-${String(originalDate.getMonth() + 1).padStart(2, '0')}-${String(originalDate.getDate()).padStart(2, '0')}`;

      // Check if already exists
      const [existing] = await db.query('SELECT id FROM company_holidays WHERE date = ?', [newDate]);
      if (existing.length === 0) {
        await db.query(
          `INSERT INTO company_holidays (date, title, holiday_type, half_day_session, category, is_recurring, description, declared_by)
           VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
          [newDate, holiday.title, holiday.holiday_type, holiday.half_day_session, holiday.category, holiday.description, req.user.id]
        );
        created++;
      }
    }

    return res.json({ message: `Generated ${created} recurring holidays for ${targetYear}`, count: created });
  } catch (err) {
    console.error('Generate recurring error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

