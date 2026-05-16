const db = require('../config/db');

/**
 * GET /api/calendar/events?start=YYYY-MM-DD&end=YYYY-MM-DD
 * Get events for a date range
 */
exports.getEvents = async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) {
      return res.status(400).json({ message: 'start and end query params are required' });
    }

    const [rows] = await db.query(
      `SELECT id, title, description, start_time, end_time, all_day, color, category
       FROM calendar_events
       WHERE user_id = ? AND deleted = 0
         AND start_time <= ? AND end_time >= ?
       ORDER BY start_time ASC`,
      [req.user.id, `${end} 23:59:59`, `${start} 00:00:00`]
    );
    return res.json(rows);
  } catch (err) {
    console.error('Get events error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/calendar/events
 * Create a new event
 */
exports.createEvent = async (req, res) => {
  try {
    const { title, description, start_time, end_time, all_day, color, category } = req.body;
    if (!title || !start_time || !end_time) {
      return res.status(400).json({ message: 'Title, start_time, and end_time are required' });
    }

    const [result] = await db.query(
      `INSERT INTO calendar_events (title, description, start_time, end_time, all_day, color, category, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, description || null, start_time, end_time, all_day ? 1 : 0, color || 'blue', category || 'other', req.user.id]
    );

    const [rows] = await db.query('SELECT * FROM calendar_events WHERE id = ?', [result.insertId]);
    res.emitSocket('calendar:created', rows[0]);
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Create event error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/calendar/events/:id
 * Update an event
 */
exports.updateEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, start_time, end_time, all_day, color, category } = req.body;

    const [existing] = await db.query(
      'SELECT id FROM calendar_events WHERE id = ? AND user_id = ? AND deleted = 0',
      [id, req.user.id]
    );
    if (!existing.length) return res.status(404).json({ message: 'Event not found' });

    await db.query(
      `UPDATE calendar_events SET title = ?, description = ?, start_time = ?, end_time = ?,
       all_day = ?, color = ?, category = ?, updated_at = NOW() WHERE id = ?`,
      [title, description || null, start_time, end_time, all_day ? 1 : 0, color || 'blue', category || 'other', id]
    );

    const [rows] = await db.query('SELECT * FROM calendar_events WHERE id = ?', [id]);
    res.emitSocket('calendar:updated', rows[0]);
    return res.json(rows[0]);
  } catch (err) {
    console.error('Update event error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * DELETE /api/calendar/events/:id
 * Soft-delete an event
 */
exports.deleteEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const [existing] = await db.query(
      'SELECT id FROM calendar_events WHERE id = ? AND user_id = ? AND deleted = 0',
      [id, req.user.id]
    );
    if (!existing.length) return res.status(404).json({ message: 'Event not found' });

    await db.query('UPDATE calendar_events SET deleted = 1, updated_at = NOW() WHERE id = ?', [id]);
    res.emitSocket('calendar:deleted', { id });
    return res.json({ message: 'Event deleted' });
  } catch (err) {
    console.error('Delete event error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
