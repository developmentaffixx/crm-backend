const db = require('../config/db');

/**
 * GET /api/meetings/today-count
 * Returns count of today's scheduled meetings for the current user (for badge)
 */
exports.todayCount = async (req, res) => {
  try {
    let where = 'm.deleted = 0 AND m.meeting_date = CURDATE() AND m.status = "scheduled"';
    const params = [];

    if (!req.user.is_admin) {
      where += ' AND (m.created_by = ? OR m.id IN (SELECT meeting_id FROM meeting_members WHERE user_id = ?))';
      params.push(req.user.id, req.user.id);
    }

    const [rows] = await db.query(
      `SELECT COUNT(*) AS count FROM meetings m WHERE ${where}`,
      params
    );
    return res.json({ count: rows[0].count });
  } catch (err) {
    console.error('Meetings today count error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/meetings
 * List meetings - users only see meetings they are a member of or created. Admin sees all.
 */
exports.list = async (req, res) => {
  try {
    const { search } = req.query;
    let where = 'm.deleted = 0';
    const params = [];

    // Non-admin: only see meetings where user is creator or a member
    if (!req.user.is_admin) {
      where += ' AND (m.created_by = ? OR m.id IN (SELECT meeting_id FROM meeting_members WHERE user_id = ?))';
      params.push(req.user.id, req.user.id);
    }

    if (search) {
      where += ' AND (m.title LIKE ? OR m.description LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s);
    }

    const [rows] = await db.query(
      `SELECT m.*,
              l.business_name AS client_name,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM meetings m
       LEFT JOIN leads l ON l.id = m.client_id
       LEFT JOIN users u ON u.id = m.created_by
       WHERE ${where}
       ORDER BY m.meeting_date DESC, m.start_time DESC`,
      params
    );

    // Fetch members for all meetings
    if (rows.length > 0) {
      const meetingIds = rows.map(r => r.id);
      const [members] = await db.query(
        `SELECT mm.meeting_id, mm.user_id,
                CONCAT(u.first_name, ' ', u.last_name) AS name
         FROM meeting_members mm
         JOIN users u ON u.id = mm.user_id
         WHERE mm.meeting_id IN (?)`,
        [meetingIds]
      );

      const memberMap = {};
      members.forEach(m => {
        if (!memberMap[m.meeting_id]) memberMap[m.meeting_id] = [];
        memberMap[m.meeting_id].push({ user_id: m.user_id, name: m.name });
      });

      rows.forEach(r => {
        r.members = memberMap[r.id] || [];
      });
    }

    return res.json({ meetings: rows, total: rows.length });
  } catch (err) {
    console.error('Meetings list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/meetings/:id
 * Get single meeting detail (only if user is member/creator, or admin)
 */
exports.getOne = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await db.query(
      `SELECT m.*,
              l.business_name AS client_name,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM meetings m
       LEFT JOIN leads l ON l.id = m.client_id
       LEFT JOIN users u ON u.id = m.created_by
       WHERE m.id = ? AND m.deleted = 0`,
      [id]
    );

    if (!rows.length) return res.status(404).json({ message: 'Meeting not found' });

    const meeting = rows[0];

    // Non-admin: check if user is creator or member
    if (!req.user.is_admin && meeting.created_by !== req.user.id) {
      const [memberCheck] = await db.query(
        'SELECT id FROM meeting_members WHERE meeting_id = ? AND user_id = ?',
        [id, req.user.id]
      );
      if (!memberCheck.length) {
        return res.status(403).json({ message: 'You do not have access to this meeting' });
      }
    }

    // Fetch members
    const [members] = await db.query(
      `SELECT mm.user_id, CONCAT(u.first_name, ' ', u.last_name) AS name
       FROM meeting_members mm
       JOIN users u ON u.id = mm.user_id
       WHERE mm.meeting_id = ?`,
      [id]
    );
    meeting.members = members;

    return res.json(meeting);
  } catch (err) {
    console.error('Meeting getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/meetings
 * Create a new meeting
 */
exports.create = async (req, res) => {
  try {
    const {
      title, description, meeting_type, client_id,
      meeting_date, start_time, end_time,
      location_type, meeting_link, mom, member_ids, status
    } = req.body;

    if (!title || !meeting_date || !start_time || !end_time) {
      return res.status(400).json({ message: 'Title, date, start time, and end time are required' });
    }

    const [result] = await db.query(
      `INSERT INTO meetings (title, description, meeting_type, client_id, meeting_date, start_time, end_time, location_type, meeting_link, status, mom, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title,
        description || null,
        meeting_type || 'office',
        meeting_type === 'client' ? (client_id || null) : null,
        meeting_date,
        start_time,
        end_time,
        location_type || 'office',
        location_type === 'virtual' ? (meeting_link || null) : null,
        status || 'scheduled',
        mom || null,
        req.user.id
      ]
    );

    const meetingId = result.insertId;

    // Insert members (always include creator)
    const memberSet = new Set(member_ids || []);
    memberSet.add(req.user.id);
    const memberValues = [...memberSet].map(uid => [meetingId, uid]);
    await db.query(
      'INSERT INTO meeting_members (meeting_id, user_id) VALUES ?',
      [memberValues]
    );

    // Fetch the created meeting
    const [rows] = await db.query('SELECT * FROM meetings WHERE id = ?', [meetingId]);
    res.emitSocket('meeting:created', rows[0]);
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Meeting create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/meetings/:id
 * Update a meeting (only creator or admin)
 */
exports.update = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title, description, meeting_type, client_id,
      meeting_date, start_time, end_time,
      location_type, meeting_link, mom, member_ids, status
    } = req.body;

    const [existing] = await db.query(
      'SELECT id, created_by FROM meetings WHERE id = ? AND deleted = 0',
      [id]
    );
    if (!existing.length) return res.status(404).json({ message: 'Meeting not found' });

    // Only creator or admin can edit
    if (!req.user.is_admin && existing[0].created_by !== req.user.id) {
      return res.status(403).json({ message: 'Only the meeting creator or admin can edit this meeting' });
    }

    await db.query(
      `UPDATE meetings SET
        title = ?, description = ?, meeting_type = ?, client_id = ?,
        meeting_date = ?, start_time = ?, end_time = ?,
        location_type = ?, meeting_link = ?, status = ?, mom = ?,
        updated_at = NOW()
       WHERE id = ?`,
      [
        title,
        description || null,
        meeting_type || 'office',
        meeting_type === 'client' ? (client_id || null) : null,
        meeting_date,
        start_time,
        end_time,
        location_type || 'office',
        location_type === 'virtual' ? (meeting_link || null) : null,
        status || 'scheduled',
        mom || null,
        id
      ]
    );

    // Update members: delete old, insert new (always include creator)
    await db.query('DELETE FROM meeting_members WHERE meeting_id = ?', [id]);
    const memberSet = new Set(member_ids || []);
    memberSet.add(existing[0].created_by);
    const memberValues = [...memberSet].map(uid => [parseInt(id), uid]);
    await db.query(
      'INSERT INTO meeting_members (meeting_id, user_id) VALUES ?',
      [memberValues]
    );

    const [rows] = await db.query('SELECT * FROM meetings WHERE id = ?', [id]);
    res.emitSocket('meeting:updated', rows[0]);
    return res.json(rows[0]);
  } catch (err) {
    console.error('Meeting update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * DELETE /api/meetings/:id
 * Soft-delete a meeting (only creator or admin)
 */
exports.remove = async (req, res) => {
  try {
    const { id } = req.params;
    const [existing] = await db.query(
      'SELECT id, created_by FROM meetings WHERE id = ? AND deleted = 0',
      [id]
    );
    if (!existing.length) return res.status(404).json({ message: 'Meeting not found' });

    // Only creator or admin can delete
    if (!req.user.is_admin && existing[0].created_by !== req.user.id) {
      return res.status(403).json({ message: 'Only the meeting creator or admin can delete this meeting' });
    }

    await db.query('UPDATE meetings SET deleted = 1, updated_at = NOW() WHERE id = ?', [id]);
    res.emitSocket('meeting:deleted', { id });
    return res.json({ message: 'Meeting deleted' });
  } catch (err) {
    console.error('Meeting delete error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
