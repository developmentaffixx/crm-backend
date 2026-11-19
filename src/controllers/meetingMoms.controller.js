const db = require('../config/db');

const SOURCES = ['sales', 'general'];
const PRIORITIES = ['low', 'medium', 'high'];

const toIntOrNull = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
};
const text = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());

/**
 * Is the user involved in this meeting (or an admin)?
 *   sales   : attendee or the person who booked it
 *   general : creator or a member
 * Returns the meeting row, or null when the meeting does not exist / is not accessible.
 */
async function loadAccessibleMeeting(user, source, meetingId) {
  if (source === 'sales') {
    const [rows] = await db.query(
      'SELECT id, created_by, attendee_id FROM sales_meetings WHERE id = ? AND deleted = 0',
      [meetingId]
    );
    const m = rows[0];
    if (!m) return { meeting: null };
    const ok = user.is_admin || m.created_by === user.id || m.attendee_id === user.id;
    return { meeting: ok ? m : null, exists: true };
  }
  const [rows] = await db.query(
    'SELECT id, created_by FROM meetings WHERE id = ? AND deleted = 0',
    [meetingId]
  );
  const m = rows[0];
  if (!m) return { meeting: null };
  let ok = user.is_admin || m.created_by === user.id;
  if (!ok) {
    const [mem] = await db.query(
      'SELECT 1 FROM meeting_members WHERE meeting_id = ? AND user_id = ? LIMIT 1',
      [meetingId, user.id]
    );
    ok = mem.length > 0;
  }
  return { meeting: ok ? m : null, exists: true };
}

/** Express middleware: validates :source / :meetingId and loads access into req.mom */
async function guardMeeting(req, res, next) {
  try {
    const source = req.params.source;
    const meetingId = toIntOrNull(req.params.meetingId);
    if (!SOURCES.includes(source) || !meetingId) return res.status(400).json({ message: 'Invalid meeting' });
    const { meeting, exists } = await loadAccessibleMeeting(req.user, source, meetingId);
    if (!exists) return res.status(404).json({ message: 'Meeting not found' });
    if (!meeting) return res.status(403).json({ message: 'Access denied' });
    req.mom = { source, meetingId };
    return next();
  } catch (err) {
    console.error('MOM guard error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}
exports.guardMeeting = guardMeeting;

async function fetchItems(source, meetingId) {
  const [items] = await db.query(
    `SELECT i.id, i.title, i.assigned_to, i.due_date, i.priority, i.converted_type, i.converted_id,
            CONCAT(u.first_name, ' ', u.last_name) AS assigned_to_name,
            CASE i.converted_type
              WHEN 'task'   THEN (SELECT task_id_code   FROM tasks   WHERE id = i.converted_id)
              WHEN 'ticket' THEN (SELECT ticket_id_code FROM tickets WHERE id = i.converted_id)
            END AS converted_code
       FROM meeting_action_items i
       LEFT JOIN users u ON u.id = i.assigned_to
      WHERE i.source = ? AND i.meeting_id = ? AND i.deleted = 0
      ORDER BY i.id`,
    [source, meetingId]
  );
  return items;
}

// GET /api/meeting-moms/:source/:meetingId
exports.get = async (req, res) => {
  try {
    const { source, meetingId } = req.mom;
    const [rows] = await db.query(
      `SELECT m.*, CONCAT(u.first_name, ' ', u.last_name) AS submitted_by_name
         FROM meeting_moms m LEFT JOIN users u ON u.id = m.submitted_by
        WHERE m.source = ? AND m.meeting_id = ?`,
      [source, meetingId]
    );
    return res.json({ mom: rows[0] || null, action_items: await fetchItems(source, meetingId) });
  } catch (err) {
    console.error('MOM get error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// PUT /api/meeting-moms/:source/:meetingId   (create or update the MOM text)
exports.save = async (req, res) => {
  try {
    const { source, meetingId } = req.mom;
    const b = req.body || {};
    const vals = [text(b.discussion), text(b.client_requirements), text(b.decisions), text(b.next_steps)];
    if (vals.every((v) => v === null)) {
      return res.status(400).json({ message: 'Add at least one note before saving the MOM' });
    }
    await db.query(
      `INSERT INTO meeting_moms (source, meeting_id, discussion, client_requirements, decisions, next_steps, submitted_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE discussion = VALUES(discussion), client_requirements = VALUES(client_requirements),
         decisions = VALUES(decisions), next_steps = VALUES(next_steps), submitted_by = VALUES(submitted_by)`,
      [source, meetingId, ...vals, req.user.id]
    );
    const [rows] = await db.query(
      `SELECT m.*, CONCAT(u.first_name, ' ', u.last_name) AS submitted_by_name
         FROM meeting_moms m LEFT JOIN users u ON u.id = m.submitted_by
        WHERE m.source = ? AND m.meeting_id = ?`,
      [source, meetingId]
    );
    return res.json({ mom: rows[0], action_items: await fetchItems(source, meetingId) });
  } catch (err) {
    console.error('MOM save error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// POST /api/meeting-moms/:source/:meetingId/action-items
exports.addItem = async (req, res) => {
  try {
    const { source, meetingId } = req.mom;
    const b = req.body || {};
    const title = text(b.title);
    if (!title) return res.status(400).json({ message: 'Action item title is required' });
    if (title.length > 255) return res.status(400).json({ message: 'Title is too long (max 255 characters)' });
    const priority = PRIORITIES.includes(b.priority) ? b.priority : 'medium';
    const assignedTo = toIntOrNull(b.assigned_to);
    if (assignedTo) {
      const [u] = await db.query('SELECT id FROM users WHERE id = ? AND deleted = 0 AND is_active = 1', [assignedTo]);
      if (!u.length) return res.status(400).json({ message: 'Assigned user not found' });
    }
    const due = text(b.due_date);
    if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) return res.status(400).json({ message: 'due_date must be YYYY-MM-DD' });

    await db.query(
      `INSERT INTO meeting_action_items (source, meeting_id, title, assigned_to, due_date, priority, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [source, meetingId, title, assignedTo, due, priority, req.user.id]
    );
    return res.status(201).json({ action_items: await fetchItems(source, meetingId) });
  } catch (err) {
    console.error('MOM add item error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// DELETE /api/meeting-moms/:source/:meetingId/action-items/:itemId   (only if not converted)
exports.removeItem = async (req, res) => {
  try {
    const { source, meetingId } = req.mom;
    const itemId = toIntOrNull(req.params.itemId);
    const [rows] = await db.query(
      'SELECT id, converted_id FROM meeting_action_items WHERE id = ? AND source = ? AND meeting_id = ? AND deleted = 0',
      [itemId, source, meetingId]
    );
    if (!rows.length) return res.status(404).json({ message: 'Action item not found' });
    if (rows[0].converted_id) return res.status(409).json({ message: 'This item is already a task/ticket and cannot be removed' });
    await db.query('UPDATE meeting_action_items SET deleted = 1 WHERE id = ?', [itemId]);
    return res.json({ action_items: await fetchItems(source, meetingId) });
  } catch (err) {
    console.error('MOM remove item error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// PATCH /api/meeting-moms/:source/:meetingId/action-items/:itemId/link   { type, id }
// Called after the task / ticket was created through the normal Tasks / Tickets API.
exports.linkItem = async (req, res) => {
  try {
    const { source, meetingId } = req.mom;
    const itemId = toIntOrNull(req.params.itemId);
    const type = req.body?.type;
    const id = toIntOrNull(req.body?.id);
    if (!['task', 'ticket'].includes(type) || !id) return res.status(400).json({ message: 'type (task|ticket) and id are required' });

    const [rows] = await db.query(
      'SELECT id, converted_id FROM meeting_action_items WHERE id = ? AND source = ? AND meeting_id = ? AND deleted = 0',
      [itemId, source, meetingId]
    );
    if (!rows.length) return res.status(404).json({ message: 'Action item not found' });
    if (rows[0].converted_id) return res.status(409).json({ message: 'This item is already converted' });

    const [target] = await db.query(
      type === 'task' ? 'SELECT id FROM tasks WHERE id = ? AND deleted = 0' : 'SELECT id FROM tickets WHERE id = ? AND deleted = 0',
      [id]
    );
    if (!target.length) return res.status(400).json({ message: `${type} not found` });

    await db.query('UPDATE meeting_action_items SET converted_type = ?, converted_id = ? WHERE id = ?', [type, id, itemId]);
    return res.json({ action_items: await fetchItems(source, meetingId) });
  } catch (err) {
    console.error('MOM link item error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
