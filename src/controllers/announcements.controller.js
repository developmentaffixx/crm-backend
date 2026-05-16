const db = require('../config/db');

/**
 * GET /api/announcements
 * List all announcements (pinned first, then by date)
 */
exports.list = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT a.*, CONCAT(u.first_name, ' ', u.last_name) AS author_name, u.designation AS author_designation,
              (SELECT COUNT(*) FROM announcement_reads ar WHERE ar.announcement_id = a.id AND ar.user_id = ?) AS is_read
       FROM announcements a
       INNER JOIN users u ON u.id = a.created_by
       WHERE a.deleted = 0
       ORDER BY a.is_pinned DESC, a.created_at DESC`,
      [req.user.id]
    );
    return res.json(rows);
  } catch (err) {
    console.error('Announcements list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/announcements/unread-count
 * Get count of unread announcements for badge
 */
exports.unreadCount = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT COUNT(*) as count FROM announcements a
       WHERE a.deleted = 0
         AND a.id NOT IN (SELECT announcement_id FROM announcement_reads WHERE user_id = ?)`,
      [req.user.id]
    );
    return res.json({ count: rows[0].count });
  } catch (err) {
    console.error('Unread count error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/announcements
 * Admin creates an announcement
 */
exports.create = async (req, res) => {
  try {
    const { title, content, priority, is_pinned } = req.body;
    if (!title || !content) {
      return res.status(400).json({ message: 'Title and content are required' });
    }

    const [result] = await db.query(
      `INSERT INTO announcements (title, content, priority, is_pinned, created_by) VALUES (?, ?, ?, ?, ?)`,
      [title, content, priority || 'normal', is_pinned ? 1 : 0, req.user.id]
    );

    res.emitSocket('announcements:created', { message: 'Announcement created', id: result.insertId });
    return res.status(201).json({ message: 'Announcement created', id: result.insertId });
  } catch (err) {
    console.error('Create announcement error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/announcements/:id
 * Admin updates an announcement
 */
exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, priority, is_pinned } = req.body;

    const [existing] = await db.query('SELECT id FROM announcements WHERE id = ? AND deleted = 0', [id]);
    if (!existing.length) return res.status(404).json({ message: 'Not found' });

    await db.query(
      `UPDATE announcements SET title = ?, content = ?, priority = ?, is_pinned = ?, updated_at = NOW() WHERE id = ?`,
      [title, content, priority || 'normal', is_pinned ? 1 : 0, id]
    );

    res.emitSocket('announcements:updated', { message: 'Announcement updated', id });
    return res.json({ message: 'Announcement updated' });
  } catch (err) {
    console.error('Update announcement error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * DELETE /api/announcements/:id
 * Admin deletes an announcement
 */
exports.remove = async (req, res) => {
  try {
    const { id } = req.params;
    await db.query('UPDATE announcements SET deleted = 1, updated_at = NOW() WHERE id = ?', [id]);
    res.emitSocket('announcements:deleted', { id });
    return res.json({ message: 'Announcement deleted' });
  } catch (err) {
    console.error('Delete announcement error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/announcements/:id/read
 * Mark an announcement as read
 */
exports.markRead = async (req, res) => {
  try {
    const { id } = req.params;
    await db.query(
      `INSERT IGNORE INTO announcement_reads (announcement_id, user_id) VALUES (?, ?)`,
      [id, req.user.id]
    );
    return res.json({ message: 'Marked as read' });
  } catch (err) {
    console.error('Mark read error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/announcements/mark-all-read
 * Mark all announcements as read
 */
exports.markAllRead = async (req, res) => {
  try {
    await db.query(
      `INSERT IGNORE INTO announcement_reads (announcement_id, user_id)
       SELECT id, ? FROM announcements WHERE deleted = 0`,
      [req.user.id]
    );
    return res.json({ message: 'All marked as read' });
  } catch (err) {
    console.error('Mark all read error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
