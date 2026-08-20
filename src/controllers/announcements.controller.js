const db = require('../config/db');

/**
 * GET /api/announcements
 * List all announcements (pinned first, then by date)
 * Includes reaction summary and current user's reaction
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

    if (!rows.length) return res.json([]);

    const ids = rows.map(r => r.id);

    // Fetch read counts per announcement (for admin "seen by" indicator)
    let readCountMap = {};
    let totalActiveUsers = 0;
    if (req.user.is_admin) {
      const [userCount] = await db.query(
        `SELECT COUNT(*) AS count FROM users WHERE is_active = 1 AND deleted = 0`
      );
      totalActiveUsers = userCount[0].count;

      const [readCounts] = await db.query(
        `SELECT announcement_id, COUNT(*) AS read_count FROM announcement_reads
         WHERE announcement_id IN (?) GROUP BY announcement_id`,
        [ids]
      );
      for (const r of readCounts) {
        readCountMap[r.announcement_id] = Number(r.read_count);
      }
    }

    // Fetch all reactions for these announcements in one query
    const [reactions] = await db.query(
      `SELECT announcement_id, emoji, COUNT(*) AS count FROM announcement_reactions
       WHERE announcement_id IN (?) GROUP BY announcement_id, emoji`,
      [ids]
    );
    const [myReactions] = await db.query(
      `SELECT announcement_id, emoji FROM announcement_reactions
       WHERE announcement_id IN (?) AND user_id = ?`,
      [ids, req.user.id]
    );

    // Map reactions onto each announcement
    const reactionMap = {};
    for (const r of reactions) {
      if (!reactionMap[r.announcement_id]) reactionMap[r.announcement_id] = [];
      reactionMap[r.announcement_id].push({ emoji: r.emoji, count: Number(r.count) });
    }
    const myReactionMap = {};
    for (const r of myReactions) {
      myReactionMap[r.announcement_id] = r.emoji;
    }

    const enriched = rows.map(a => ({
      ...a,
      reactions: reactionMap[a.id] || [],
      my_reaction: myReactionMap[a.id] || null,
      ...(req.user.is_admin ? {
        read_count: readCountMap[a.id] || 0,
        total_users: totalActiveUsers,
      } : {}),
    }));

    return res.json(enriched);
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

/**
 * POST /api/announcements/:id/react
 * Toggle a reaction on an announcement (one reaction per user).
 * If the user sends the same emoji they already have → removes it (toggle off).
 * If they send a different emoji → updates to the new one.
 */
exports.react = async (req, res) => {
  try {
    const { id } = req.params;
    const { emoji } = req.body;
    if (!emoji) return res.status(400).json({ message: 'emoji is required' });

    // Check existing reaction
    const [existing] = await db.query(
      `SELECT emoji FROM announcement_reactions WHERE announcement_id = ? AND user_id = ?`,
      [id, req.user.id]
    );

    if (existing.length) {
      if (existing[0].emoji === emoji) {
        // Same emoji → remove (toggle off)
        await db.query(
          `DELETE FROM announcement_reactions WHERE announcement_id = ? AND user_id = ?`,
          [id, req.user.id]
        );
        return res.json({ action: 'removed', emoji });
      } else {
        // Different emoji → update
        await db.query(
          `UPDATE announcement_reactions SET emoji = ? WHERE announcement_id = ? AND user_id = ?`,
          [emoji, id, req.user.id]
        );
        return res.json({ action: 'updated', emoji });
      }
    } else {
      // No existing → insert
      await db.query(
        `INSERT INTO announcement_reactions (announcement_id, user_id, emoji) VALUES (?, ?, ?)`,
        [id, req.user.id, emoji]
      );
      return res.json({ action: 'added', emoji });
    }
  } catch (err) {
    console.error('React error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/announcements/:id/read-analytics
 * Admin: see who has read and who hasn't read an announcement
 */
exports.readAnalytics = async (req, res) => {
  try {
    const { id } = req.params;

    // Get all active users
    const [allUsers] = await db.query(
      `SELECT u.id, CONCAT(u.first_name, ' ', u.last_name) AS user_name,
              u.designation, u.avatar_url, u.department
       FROM users u
       WHERE u.is_active = 1 AND u.deleted = 0`
    );

    // Get users who have read this announcement
    const [readUsers] = await db.query(
      `SELECT ar.user_id, ar.read_at
       FROM announcement_reads ar
       WHERE ar.announcement_id = ?`,
      [id]
    );

    const readUserIds = new Set(readUsers.map(r => r.user_id));
    const readAtMap = {};
    for (const r of readUsers) {
      readAtMap[r.user_id] = r.read_at;
    }

    const read = [];
    const unread = [];

    for (const user of allUsers) {
      if (readUserIds.has(user.id)) {
        read.push({ ...user, read_at: readAtMap[user.id] });
      } else {
        unread.push(user);
      }
    }

    return res.json({
      total_users: allUsers.length,
      read_count: read.length,
      unread_count: unread.length,
      read,
      unread,
    });
  } catch (err) {
    console.error('Read analytics error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/announcements/:id/reactions
 * Admin: see all reactions with user details for a specific announcement
 */
exports.getReactions = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query(
      `SELECT ar.emoji, ar.created_at,
              CONCAT(u.first_name, ' ', u.last_name) AS user_name,
              u.designation, u.avatar_url
       FROM announcement_reactions ar
       INNER JOIN users u ON u.id = ar.user_id
       WHERE ar.announcement_id = ?
       ORDER BY ar.created_at ASC`,
      [id]
    );
    return res.json(rows);
  } catch (err) {
    console.error('Get reactions error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
