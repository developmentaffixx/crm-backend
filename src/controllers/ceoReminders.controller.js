const crypto = require('crypto');
const db = require('../config/db');
const { emitEvent } = require('../config/socket');

/**
 * CEO → Team Head reminders.
 *
 * Recipients are the HEADS defined in Settings → Team Management
 * (team_members.role = 'head'). One row is stored per recipient so each
 * head's status/timestamps are tracked independently; reminders sent together
 * share a batch_id.
 *
 * Status flow (head moves forward only):
 *   pending → viewed → acknowledged → in_progress → completed
 * CEO can close (final) or reopen any reminder.
 */

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS & HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const TYPES = ['task', 'ticket', 'deadline', 'meeting', 'discussion', 'follow_up', 'general'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const LINK_TYPES = ['task', 'ticket', 'sales_meeting'];
const OPEN_STATUSES = ['pending', 'viewed', 'acknowledged', 'in_progress'];

// Head-side forward-only progression
const STATUS_ORDER = { pending: 0, viewed: 1, acknowledged: 2, in_progress: 3, completed: 4 };
const STATUS_TS = {
  viewed: 'viewed_at',
  acknowledged: 'acknowledged_at',
  in_progress: 'in_progress_at',
  completed: 'completed_at',
};

const SLOT_LABELS = { morning: 'Morning (9–12 AM)', afternoon: 'Afternoon (12–4 PM)', evening: 'Evening (4–8 PM)' };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

const toInt = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const normTime = (t) => (t && TIME_RE.test(t) ? (t.length === 5 ? `${t}:00` : t) : null);

/** Notify one or more users through their private socket room. */
function notifyUsers(userIds, event, payload) {
  const unique = [...new Set(userIds.filter(Boolean).map(Number))];
  unique.forEach((uid) => emitEvent(event, payload, `user:${uid}`));
}

async function logActivity(reminderId, action, { from = null, to = null, note = null, actedBy = null } = {}) {
  try {
    await db.query(
      `INSERT INTO ceo_reminder_activity (reminder_id, action, from_status, to_status, note, acted_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [reminderId, action, from, to, note || null, actedBy]
    );
  } catch (err) {
    console.error('CEO reminder activity log error:', err.message);
  }
}

/** Current team heads from Team Management. */
async function fetchHeads() {
  const [rows] = await db.query(
    `SELECT t.id AS team_id, t.name AS team_name, u.id AS user_id,
            CONCAT(u.first_name, ' ', u.last_name) AS name,
            u.avatar_url AS avatar, u.designation, u.department
       FROM team_members tm
       JOIN teams t ON t.id = tm.team_id AND t.deleted = 0
       JOIN users u ON u.id = tm.user_id AND u.deleted = 0 AND u.is_active = 1
      WHERE tm.role = 'head'
      ORDER BY t.name, u.first_name`
  );
  return rows;
}

/** Generates REM-YYMM-### (sequence per month). */
async function nextReminderCode() {
  const now = new Date();
  const prefix = `REM-${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}-`;
  const [rows] = await db.query(
    'SELECT reminder_code FROM ceo_reminders WHERE reminder_code LIKE ? ORDER BY id DESC LIMIT 1',
    [`${prefix}%`]
  );
  let seq = 1;
  if (rows.length && rows[0].reminder_code) {
    seq = (parseInt(rows[0].reminder_code.split('-').pop(), 10) || 0) + 1;
  }
  return { prefix, seq };
}

/** Verifies the linked record exists; returns a small snapshot or null. */
async function loadLinkedItem(type, id) {
  if (!type || !id) return null;
  if (type === 'task') {
    const [r] = await db.query('SELECT id, title, deadline AS due_date FROM tasks WHERE id = ? AND deleted = 0', [id]);
    return r[0] || null;
  }
  if (type === 'ticket') {
    const [r] = await db.query('SELECT id, title, due_date FROM tickets WHERE id = ? AND deleted = 0', [id]);
    return r[0] || null;
  }
  if (type === 'sales_meeting') {
    const [r] = await db.query(
      `SELECT sm.id, COALESCE(sm.title, l.business_name, l.name, 'Sales meeting') AS title,
              sm.meeting_date, sm.slot, sm.pre_confirmed
         FROM sales_meetings sm
         LEFT JOIN leads l ON l.id = sm.lead_id
        WHERE sm.id = ? AND sm.deleted = 0`,
      [id]
    );
    return r[0] || null;
  }
  return null;
}

// Base SELECT with recipient, creator and live linked-record details
const BASE_SELECT = `
  SELECT r.*,
         CONCAT(ru.first_name, ' ', ru.last_name) AS recipient_name,
         ru.avatar_url  AS recipient_avatar,
         ru.designation AS recipient_designation,
         CONCAT(cu.first_name, ' ', cu.last_name) AS created_by_name,
         (r.due_at IS NOT NULL AND r.due_at < NOW() AND r.status IN ('pending','viewed','acknowledged','in_progress')) AS is_overdue,

         tk.task_id_code AS lk_task_code, tk.title AS lk_task_title, tk.status AS lk_task_status,
         tk.is_active AS lk_task_active, tk.deadline AS lk_task_due,
         CONCAT(tku.first_name, ' ', tku.last_name) AS lk_task_assignee,

         tc.ticket_id_code AS lk_ticket_code, tc.title AS lk_ticket_title, tc.status AS lk_ticket_status,
         tc.due_date AS lk_ticket_due,
         CONCAT(tcu.first_name, ' ', tcu.last_name) AS lk_ticket_assignee,

         sm.title AS lk_sm_title, sm.meeting_date AS lk_sm_date, sm.slot AS lk_sm_slot, sm.mode AS lk_sm_mode,
         sm.pre_confirmed AS lk_sm_confirmed, sm.outcome AS lk_sm_outcome,
         COALESCE(sml.business_name, sml.name) AS lk_sm_lead,
         CONCAT(smu.first_name, ' ', smu.last_name) AS lk_sm_owner
    FROM ceo_reminders r
    LEFT JOIN users ru  ON ru.id = r.recipient_user_id
    LEFT JOIN users cu  ON cu.id = r.created_by
    LEFT JOIN tasks tk  ON r.linked_type = 'task' AND tk.id = r.linked_id
    LEFT JOIN users tku ON tku.id = tk.assigned_to
    LEFT JOIN tickets tc ON r.linked_type = 'ticket' AND tc.id = r.linked_id
    LEFT JOIN users tcu ON tcu.id = tc.assigned_to
    LEFT JOIN sales_meetings sm ON r.linked_type = 'sales_meeting' AND sm.id = r.linked_id
    LEFT JOIN leads sml ON sml.id = sm.lead_id
    LEFT JOIN users smu ON smu.id = sm.created_by
`;

const TASK_STATE = { 0: 'Pending approval', 2: 'Pending closing', 3: 'Closed', 4: 'Rejected' };

/** Turns a raw joined row into the API shape (strips lk_* columns). */
function shapeRow(row) {
  let linked = null;
  if (row.linked_type === 'task' && row.lk_task_title !== null) {
    const state = TASK_STATE[row.lk_task_active] || (row.lk_task_status || '').replace(/_/g, ' ');
    linked = {
      type: 'task', id: row.linked_id, code: row.lk_task_code, title: row.lk_task_title,
      status: state, due_date: row.lk_task_due, assignee: row.lk_task_assignee,
      url: `/tasks/${row.linked_id}`,
    };
  } else if (row.linked_type === 'ticket' && row.lk_ticket_title !== null) {
    linked = {
      type: 'ticket', id: row.linked_id, code: row.lk_ticket_code, title: row.lk_ticket_title,
      status: (row.lk_ticket_status || '').replace(/_/g, ' '), due_date: row.lk_ticket_due,
      assignee: row.lk_ticket_assignee, url: '/tickets',
    };
  } else if (row.linked_type === 'sales_meeting' && row.lk_sm_date !== null) {
    linked = {
      type: 'sales_meeting', id: row.linked_id,
      title: row.lk_sm_title || (row.lk_sm_lead ? `Meeting with ${row.lk_sm_lead}` : 'Sales meeting'),
      status: row.lk_sm_confirmed ? 'Confirmed' : 'Not confirmed',
      confirmed: !!row.lk_sm_confirmed, outcome: row.lk_sm_outcome,
      meeting_date: row.lk_sm_date, slot: row.lk_sm_slot, slot_label: SLOT_LABELS[row.lk_sm_slot] || row.lk_sm_slot,
      mode: row.lk_sm_mode, lead: row.lk_sm_lead, assignee: row.lk_sm_owner, url: '/revenue/meetings',
    };
  } else if (row.linked_type) {
    linked = { type: row.linked_type, id: row.linked_id, title: 'Linked record no longer exists', missing: true };
  }

  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (!k.startsWith('lk_')) out[k] = v;
  }
  out.is_overdue = !!row.is_overdue;
  out.linked = linked;
  return out;
}

async function fetchReminder(id) {
  const [rows] = await db.query(`${BASE_SELECT} WHERE r.id = ? AND r.deleted = 0`, [id]);
  return rows[0] ? shapeRow(rows[0]) : null;
}

function broadcastChanged(reminder) {
  notifyUsers([reminder.recipient_user_id, reminder.created_by], 'ceo-reminders:changed', { id: reminder.id });
}

// ─────────────────────────────────────────────────────────────────────────────
// CEO SIDE
// ─────────────────────────────────────────────────────────────────────────────

/** GET /api/ceo-reminders/heads — recipients available for reminders */
exports.listHeads = async (req, res) => {
  try {
    return res.json({ heads: await fetchHeads() });
  } catch (err) {
    console.error('CEO reminders heads error:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/ceo-reminders/link-search?type=task|ticket|sales_meeting&q=&confirmed=1
 * Search existing records to link (no new task/ticket/meeting is ever created).
 */
exports.linkSearch = async (req, res) => {
  try {
    const { type } = req.query;
    const q = `%${String(req.query.q || '').trim()}%`;

    if (type === 'task') {
      const [rows] = await db.query(
        `SELECT t.id, t.task_id_code AS code, t.title, t.status, t.is_active, t.deadline AS due_date,
                CONCAT(u.first_name, ' ', u.last_name) AS assignee
           FROM tasks t
           LEFT JOIN users u ON u.id = t.assigned_to
          WHERE t.deleted = 0 AND t.is_active IN (0, 1, 2)
            AND (t.title LIKE ? OR t.task_id_code LIKE ?)
          ORDER BY t.updated_at DESC
          LIMIT 20`,
        [q, q]
      );
      return res.json({ items: rows.map((r) => ({ ...r, status: TASK_STATE[r.is_active] || (r.status || '').replace(/_/g, ' ') })) });
    }

    if (type === 'ticket') {
      const [rows] = await db.query(
        `SELECT t.id, t.ticket_id_code AS code, t.title, t.status, t.priority, t.due_date,
                CONCAT(u.first_name, ' ', u.last_name) AS assignee
           FROM tickets t
           LEFT JOIN users u ON u.id = t.assigned_to
          WHERE t.deleted = 0 AND t.status NOT IN ('resolved', 'closed')
            AND (t.title LIKE ? OR t.ticket_id_code LIKE ?)
          ORDER BY t.updated_at DESC
          LIMIT 20`,
        [q, q]
      );
      return res.json({ items: rows.map((r) => ({ ...r, status: (r.status || '').replace(/_/g, ' ') })) });
    }

    if (type === 'sales_meeting') {
      // Upcoming meetings from Revenue → Meetings. Confirmed only by default.
      const confirmedOnly = req.query.confirmed !== '0';
      const [rows] = await db.query(
        `SELECT sm.id, sm.title, sm.meeting_date, sm.slot, sm.mode, sm.pre_confirmed,
                COALESCE(l.business_name, l.name) AS lead,
                CONCAT(u.first_name, ' ', u.last_name) AS assignee
           FROM sales_meetings sm
           LEFT JOIN leads l ON l.id = sm.lead_id
           LEFT JOIN users u ON u.id = sm.created_by
          WHERE sm.deleted = 0 AND sm.meeting_date >= CURDATE() AND sm.outcome = 'pending'
            ${confirmedOnly ? 'AND sm.pre_confirmed = 1' : ''}
            AND (sm.title LIKE ? OR l.business_name LIKE ? OR l.name LIKE ?)
          ORDER BY sm.meeting_date ASC, FIELD(sm.slot, 'morning', 'afternoon', 'evening')
          LIMIT 30`,
        [q, q, q]
      );
      return res.json({
        items: rows.map((r) => ({
          ...r,
          title: r.title || (r.lead ? `Meeting with ${r.lead}` : 'Sales meeting'),
          slot_label: SLOT_LABELS[r.slot] || r.slot,
          status: r.pre_confirmed ? 'Confirmed' : 'Not confirmed',
        })),
      });
    }

    return res.status(400).json({ message: 'type must be task, ticket or sales_meeting' });
  } catch (err) {
    console.error('CEO reminders link search error:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

/** GET /api/ceo-reminders/summary — per-head (department) counters */
exports.summary = async (req, res) => {
  try {
    const heads = await fetchHeads();
    const [counts] = await db.query(
      `SELECT recipient_user_id,
              MAX(team_name) AS team_name,
              SUM(status IN ('pending','viewed'))                        AS pending,
              SUM(status = 'acknowledged')                               AS acknowledged,
              SUM(status = 'in_progress')                                AS in_progress,
              SUM(status IN ('pending','viewed','acknowledged','in_progress')
                  AND due_at IS NOT NULL AND due_at < NOW())             AS overdue,
              SUM(status = 'completed'
                  AND completed_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')) AS completed_month,
              SUM(status IN ('pending','viewed','acknowledged','in_progress')) AS open_total
         FROM ceo_reminders
        WHERE deleted = 0
        GROUP BY recipient_user_id`
    );
    const byUser = Object.fromEntries(counts.map((c) => [Number(c.recipient_user_id), c]));
    const int = (v) => parseInt(v || 0, 10) || 0;

    const cards = heads.map((h) => {
      const c = byUser[Number(h.user_id)] || {};
      return {
        user_id: h.user_id, name: h.name, avatar: h.avatar, designation: h.designation,
        team_id: h.team_id, team_name: h.team_name, is_current_head: true,
        pending: int(c.pending), acknowledged: int(c.acknowledged), in_progress: int(c.in_progress),
        overdue: int(c.overdue), completed_month: int(c.completed_month), open_total: int(c.open_total),
      };
    });

    // Past recipients who are no longer heads but still have open reminders
    const headIds = new Set(heads.map((h) => Number(h.user_id)));
    const formerIds = counts.filter((c) => !headIds.has(Number(c.recipient_user_id)) && int(c.open_total) > 0)
      .map((c) => Number(c.recipient_user_id));
    if (formerIds.length) {
      const [users] = await db.query(
        `SELECT id, CONCAT(first_name, ' ', last_name) AS name, avatar_url AS avatar, designation
           FROM users WHERE id IN (?)`,
        [formerIds]
      );
      users.forEach((u) => {
        const c = byUser[Number(u.id)];
        cards.push({
          user_id: u.id, name: u.name, avatar: u.avatar, designation: u.designation,
          team_id: null, team_name: c.team_name || 'Former head', is_current_head: false,
          pending: int(c.pending), acknowledged: int(c.acknowledged), in_progress: int(c.in_progress),
          overdue: int(c.overdue), completed_month: int(c.completed_month), open_total: int(c.open_total),
        });
      });
    }

    return res.json({ heads: cards });
  } catch (err) {
    console.error('CEO reminders summary error:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/ceo-reminders
 * Filters: recipient_user_id, team_id, status (or 'open'), type, priority,
 *          overdue=1, from, to (created date), search, page, limit
 */
exports.list = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const offset = (page - 1) * limit;

    let where = 'r.deleted = 0';
    const params = [];

    const recipient = toInt(req.query.recipient_user_id);
    if (recipient) { where += ' AND r.recipient_user_id = ?'; params.push(recipient); }

    const teamId = toInt(req.query.team_id);
    if (teamId) { where += ' AND r.team_id = ?'; params.push(teamId); }

    const { status, type, priority, from, to } = req.query;
    if (status === 'open') {
      where += " AND r.status IN ('pending','viewed','acknowledged','in_progress')";
    } else if (status && ['pending', 'viewed', 'acknowledged', 'in_progress', 'completed', 'closed'].includes(status)) {
      where += ' AND r.status = ?'; params.push(status);
    }
    if (type && TYPES.includes(type)) { where += ' AND r.type = ?'; params.push(type); }
    if (priority && PRIORITIES.includes(priority)) { where += ' AND r.priority = ?'; params.push(priority); }
    if (req.query.overdue === '1') {
      where += " AND r.due_at IS NOT NULL AND r.due_at < NOW() AND r.status IN ('pending','viewed','acknowledged','in_progress')";
    }
    if (from && DATE_RE.test(from)) { where += ' AND DATE(r.created_at) >= ?'; params.push(from); }
    if (to && DATE_RE.test(to)) { where += ' AND DATE(r.created_at) <= ?'; params.push(to); }
    if (req.query.search) {
      const s = `%${String(req.query.search).trim()}%`;
      where += ' AND (r.title LIKE ? OR r.description LIKE ? OR r.reminder_code LIKE ?)';
      params.push(s, s, s);
    }

    const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM ceo_reminders r WHERE ${where}`, params);
    const [rows] = await db.query(
      `${BASE_SELECT}
       WHERE ${where}
       ORDER BY FIELD(r.status, 'pending','viewed','acknowledged','in_progress','completed','closed'),
                (r.due_at IS NULL), r.due_at ASC, r.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return res.json({ reminders: rows.map(shapeRow), total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('CEO reminders list error:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/ceo-reminders
 * Body: { type, title, description, priority, due_date, due_time,
 *         recipient_user_ids[], linked_type, linked_id,
 *         meeting_date, meeting_time, agenda, force }
 * Returns 409 { code:'DUPLICATE', duplicates } if a recipient already has an
 * open reminder for the same linked record (resend with force=true to override).
 */
exports.create = async (req, res) => {
  try {
    const b = req.body || {};
    const type = TYPES.includes(b.type) ? b.type : 'general';
    const title = String(b.title || '').trim();
    const description = b.description ? String(b.description).trim() : null;
    const priority = PRIORITIES.includes(b.priority) ? b.priority : 'medium';
    const agenda = b.agenda ? String(b.agenda).trim() : null;

    if (!title) return res.status(400).json({ message: 'Title is required' });
    if (title.length > 255) return res.status(400).json({ message: 'Title is too long (max 255 characters)' });

    // ── Recipients must be current team heads ────────────────────────────────
    const recipientIds = [...new Set((Array.isArray(b.recipient_user_ids) ? b.recipient_user_ids : []).map(toInt).filter(Boolean))];
    if (!recipientIds.length) return res.status(400).json({ message: 'Select at least one department head' });

    const heads = await fetchHeads();
    const headByUser = new Map(heads.map((h) => [Number(h.user_id), h]));
    const invalid = recipientIds.filter((id) => !headByUser.has(id));
    if (invalid.length) {
      return res.status(400).json({ message: 'Reminders can only be sent to team heads (Settings → Team Management)' });
    }

    // ── Linked record (must already exist) ───────────────────────────────────
    let linkedType = null;
    let linkedId = null;
    let linkedItem = null;
    if (b.linked_type) {
      if (!LINK_TYPES.includes(b.linked_type)) return res.status(400).json({ message: 'Invalid link type' });
      linkedId = toInt(b.linked_id);
      if (!linkedId) return res.status(400).json({ message: 'Select the item to link' });
      linkedItem = await loadLinkedItem(b.linked_type, linkedId);
      if (!linkedItem) return res.status(400).json({ message: 'The linked item was not found' });
      linkedType = b.linked_type;
    }

    // ── Dates ────────────────────────────────────────────────────────────────
    if (b.due_date && !DATE_RE.test(b.due_date)) return res.status(400).json({ message: 'Invalid due date' });
    if (b.due_time && !TIME_RE.test(b.due_time)) return res.status(400).json({ message: 'Invalid due time' });
    if (b.meeting_date && !DATE_RE.test(b.meeting_date)) return res.status(400).json({ message: 'Invalid meeting date' });
    if (b.meeting_time && !TIME_RE.test(b.meeting_time)) return res.status(400).json({ message: 'Invalid meeting time' });

    let meetingDate = null;
    let meetingTime = null;
    if (type === 'meeting' || type === 'discussion') {
      meetingDate = b.meeting_date
        || (linkedType === 'sales_meeting' ? String(linkedItem.meeting_date).slice(0, 10) : null);
      meetingTime = normTime(b.meeting_time);
      if (!meetingDate) return res.status(400).json({ message: 'Meeting date is required' });
    }

    // Due = explicit due date/time, else the meeting date/time
    let dueAt = null;
    if (b.due_date) dueAt = `${b.due_date} ${normTime(b.due_time) || '23:59:00'}`;
    else if (meetingDate) dueAt = `${meetingDate} ${meetingTime || '09:00:00'}`;

    // ── Duplicate guard ──────────────────────────────────────────────────────
    if (linkedType && !b.force) {
      const [dups] = await db.query(
        `SELECT r.id, r.reminder_code, r.status, r.created_at, r.recipient_user_id,
                CONCAT(u.first_name, ' ', u.last_name) AS recipient_name
           FROM ceo_reminders r
           LEFT JOIN users u ON u.id = r.recipient_user_id
          WHERE r.deleted = 0 AND r.linked_type = ? AND r.linked_id = ?
            AND r.recipient_user_id IN (?)
            AND r.status IN ('pending','viewed','acknowledged','in_progress')`,
        [linkedType, linkedId, recipientIds]
      );
      if (dups.length) {
        return res.status(409).json({
          code: 'DUPLICATE',
          message: 'An open reminder for this item already exists for the selected head(s)',
          duplicates: dups,
        });
      }
    }

    // ── Insert one row per recipient ─────────────────────────────────────────
    const batchId = crypto.randomUUID();
    const { prefix, seq } = await nextReminderCode();
    const createdIds = [];

    for (let i = 0; i < recipientIds.length; i++) {
      const uid = recipientIds[i];
      const head = headByUser.get(uid);
      const code = `${prefix}${String(seq + i).padStart(3, '0')}`;
      const [result] = await db.query(
        `INSERT INTO ceo_reminders
           (reminder_code, batch_id, type, title, description, priority, due_at,
            recipient_user_id, team_id, team_name, linked_type, linked_id,
            meeting_date, meeting_time, agenda, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
        [code, batchId, type, title, description, priority, dueAt,
          uid, head.team_id, head.team_name, linkedType, linkedId,
          meetingDate, meetingTime, agenda, req.user.id]
      );
      createdIds.push(result.insertId);
      await logActivity(result.insertId, 'created', { to: 'pending', actedBy: req.user.id });

      notifyUsers([uid], 'ceo-reminders:alert', {
        kind: 'new', id: result.insertId, title, priority,
        message: `New reminder from CEO: ${title}`,
      });
    }

    notifyUsers([req.user.id, ...recipientIds], 'ceo-reminders:changed', { batch_id: batchId });

    const [rows] = await db.query(`${BASE_SELECT} WHERE r.id IN (?) ORDER BY r.id`, [createdIds]);
    return res.status(201).json({ batch_id: batchId, reminders: rows.map(shapeRow) });
  } catch (err) {
    console.error('CEO reminders create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/** GET /api/ceo-reminders/:id — detail + timeline (CEO or the recipient) */
exports.getOne = async (req, res) => {
  try {
    const id = toInt(req.params.id);
    const reminder = id && await fetchReminder(id);
    if (!reminder) return res.status(404).json({ message: 'Reminder not found' });

    const isRecipient = Number(reminder.recipient_user_id) === Number(req.user.id);
    if (!req.isCeoUser && !isRecipient) return res.status(403).json({ message: 'Access denied' });

    const [activity] = await db.query(
      `SELECT a.*, CONCAT(u.first_name, ' ', u.last_name) AS acted_by_name
         FROM ceo_reminder_activity a
         LEFT JOIN users u ON u.id = a.acted_by
        WHERE a.reminder_id = ?
        ORDER BY a.created_at ASC, a.id ASC`,
      [id]
    );
    return res.json({ ...reminder, activity });
  } catch (err) {
    console.error('CEO reminders getOne error:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

/** PUT /api/ceo-reminders/:id — CEO edits details while the reminder is still open */
exports.update = async (req, res) => {
  try {
    const id = toInt(req.params.id);
    const existing = id && await fetchReminder(id);
    if (!existing) return res.status(404).json({ message: 'Reminder not found' });
    if (!OPEN_STATUSES.includes(existing.status)) {
      return res.status(400).json({ message: 'Completed or closed reminders cannot be edited' });
    }

    const b = req.body || {};
    const updates = {};
    if (b.title !== undefined) {
      const t = String(b.title || '').trim();
      if (!t) return res.status(400).json({ message: 'Title is required' });
      updates.title = t.slice(0, 255);
    }
    if (b.description !== undefined) updates.description = b.description ? String(b.description).trim() : null;
    if (b.agenda !== undefined) updates.agenda = b.agenda ? String(b.agenda).trim() : null;
    if (b.priority !== undefined) {
      if (!PRIORITIES.includes(b.priority)) return res.status(400).json({ message: 'Invalid priority' });
      updates.priority = b.priority;
    }
    if (b.meeting_date !== undefined) {
      if (b.meeting_date && !DATE_RE.test(b.meeting_date)) return res.status(400).json({ message: 'Invalid meeting date' });
      updates.meeting_date = b.meeting_date || null;
    }
    if (b.meeting_time !== undefined) {
      if (b.meeting_time && !TIME_RE.test(b.meeting_time)) return res.status(400).json({ message: 'Invalid meeting time' });
      updates.meeting_time = normTime(b.meeting_time);
    }
    if (b.due_date !== undefined) {
      if (b.due_date && !DATE_RE.test(b.due_date)) return res.status(400).json({ message: 'Invalid due date' });
      if (b.due_time && !TIME_RE.test(b.due_time)) return res.status(400).json({ message: 'Invalid due time' });
      updates.due_at = b.due_date ? `${b.due_date} ${normTime(b.due_time) || '23:59:00'}` : null;
      // A new due time should trigger fresh due-soon / overdue alerts
      updates.due_soon_notified_at = null;
      updates.overdue_notified_at = null;
    }

    if (!Object.keys(updates).length) return res.status(400).json({ message: 'Nothing to update' });

    const set = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
    await db.query(`UPDATE ceo_reminders SET ${set} WHERE id = ?`, [...Object.values(updates), id]);
    await logActivity(id, 'edited', { actedBy: req.user.id, note: b.note });

    const updated = await fetchReminder(id);
    notifyUsers([updated.recipient_user_id], 'ceo-reminders:alert', {
      kind: 'updated', id, title: updated.title, priority: updated.priority,
      message: `CEO updated a reminder: ${updated.title}`,
    });
    broadcastChanged(updated);
    return res.json(updated);
  } catch (err) {
    console.error('CEO reminders update error:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

/** POST /api/ceo-reminders/:id/follow-up — nudge the head again */
exports.followUp = async (req, res) => {
  try {
    const id = toInt(req.params.id);
    const existing = id && await fetchReminder(id);
    if (!existing) return res.status(404).json({ message: 'Reminder not found' });
    if (!OPEN_STATUSES.includes(existing.status)) {
      return res.status(400).json({ message: 'Only open reminders can be followed up' });
    }

    const note = req.body?.note ? String(req.body.note).trim() : null;
    await db.query(
      'UPDATE ceo_reminders SET followup_count = followup_count + 1, last_followup_at = NOW() WHERE id = ?',
      [id]
    );
    await logActivity(id, 'follow_up', { from: existing.status, to: existing.status, note, actedBy: req.user.id });

    const updated = await fetchReminder(id);
    notifyUsers([updated.recipient_user_id], 'ceo-reminders:alert', {
      kind: 'followup', id, title: updated.title, priority: updated.priority,
      message: `CEO followed up: ${updated.title}${note ? ` — ${note}` : ''}`,
    });
    broadcastChanged(updated);
    return res.json(updated);
  } catch (err) {
    console.error('CEO reminders follow-up error:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

/** PATCH /api/ceo-reminders/:id/close — CEO closes (final) */
exports.close = async (req, res) => {
  try {
    const id = toInt(req.params.id);
    const existing = id && await fetchReminder(id);
    if (!existing) return res.status(404).json({ message: 'Reminder not found' });
    if (existing.status === 'closed') return res.status(400).json({ message: 'Reminder is already closed' });

    const note = req.body?.note ? String(req.body.note).trim() : null;
    await db.query("UPDATE ceo_reminders SET status = 'closed', closed_at = NOW() WHERE id = ?", [id]);
    await logActivity(id, 'closed', { from: existing.status, to: 'closed', note, actedBy: req.user.id });

    const updated = await fetchReminder(id);
    broadcastChanged(updated);
    return res.json(updated);
  } catch (err) {
    console.error('CEO reminders close error:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

/** PATCH /api/ceo-reminders/:id/reopen — CEO sends a completed/closed reminder back */
exports.reopen = async (req, res) => {
  try {
    const id = toInt(req.params.id);
    const existing = id && await fetchReminder(id);
    if (!existing) return res.status(404).json({ message: 'Reminder not found' });
    if (OPEN_STATUSES.includes(existing.status)) return res.status(400).json({ message: 'Reminder is already open' });

    const toStatus = existing.acknowledged_at ? 'acknowledged' : 'pending';
    const note = req.body?.note ? String(req.body.note).trim() : null;
    await db.query(
      `UPDATE ceo_reminders
          SET status = ?, completed_at = NULL, closed_at = NULL,
              overdue_notified_at = NULL, due_soon_notified_at = NULL
        WHERE id = ?`,
      [toStatus, id]
    );
    await logActivity(id, 'reopened', { from: existing.status, to: toStatus, note, actedBy: req.user.id });

    const updated = await fetchReminder(id);
    notifyUsers([updated.recipient_user_id], 'ceo-reminders:alert', {
      kind: 'reopened', id, title: updated.title, priority: updated.priority,
      message: `CEO reopened a reminder: ${updated.title}${note ? ` — ${note}` : ''}`,
    });
    broadcastChanged(updated);
    return res.json(updated);
  } catch (err) {
    console.error('CEO reminders reopen error:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

/** DELETE /api/ceo-reminders/:id — soft delete */
exports.remove = async (req, res) => {
  try {
    const id = toInt(req.params.id);
    const existing = id && await fetchReminder(id);
    if (!existing) return res.status(404).json({ message: 'Reminder not found' });

    await db.query('UPDATE ceo_reminders SET deleted = 1 WHERE id = ?', [id]);
    await logActivity(id, 'deleted', { from: existing.status, actedBy: req.user.id });
    broadcastChanged(existing);
    return res.json({ message: 'Reminder deleted' });
  } catch (err) {
    console.error('CEO reminders delete error:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// HEAD SIDE (recipient only)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/ceo-reminders/my?scope=open|all
 * The current user's reminders. Marks newly fetched ones as delivered.
 */
exports.myReminders = async (req, res) => {
  try {
    const uid = req.user.id;
    const scope = req.query.scope === 'all' ? 'all' : 'open';

    let where = 'r.deleted = 0 AND r.recipient_user_id = ?';
    if (scope === 'open') {
      where += " AND r.status IN ('pending','viewed','acknowledged','in_progress')";
    } else {
      // open + anything finished in the last 30 days
      where += " AND (r.status IN ('pending','viewed','acknowledged','in_progress') OR r.updated_at >= DATE_SUB(NOW(), INTERVAL 30 DAY))";
    }

    const [rows] = await db.query(
      `${BASE_SELECT}
       WHERE ${where}
       ORDER BY FIELD(r.status, 'pending','viewed','acknowledged','in_progress','completed','closed'),
                FIELD(r.priority, 'critical','high','medium','low'),
                (r.due_at IS NULL), r.due_at ASC
       LIMIT 100`,
      [uid]
    );

    // Delivery timestamp = first time it reached the head's dashboard
    const undelivered = rows.filter((r) => !r.delivered_at).map((r) => r.id);
    if (undelivered.length) {
      await db.query('UPDATE ceo_reminders SET delivered_at = NOW() WHERE id IN (?) AND delivered_at IS NULL', [undelivered]);
      for (const rid of undelivered) await logActivity(rid, 'delivered', { actedBy: null });
    }

    const reminders = rows.map(shapeRow);
    const open = reminders.filter((r) => OPEN_STATUSES.includes(r.status));
    return res.json({
      reminders,
      counts: {
        open: open.length,
        new: open.filter((r) => r.status === 'pending').length,
        overdue: open.filter((r) => r.is_overdue).length,
        meetings: open.filter((r) => r.type === 'meeting' || r.type === 'discussion').length,
        follow_ups: open.filter((r) => r.type === 'follow_up' || r.followup_count > 0).length,
      },
    });
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') return res.json({ reminders: [], counts: { open: 0, new: 0, overdue: 0, meetings: 0, follow_ups: 0 } });
    console.error('My CEO reminders error:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PATCH /api/ceo-reminders/my/:id/status
 * Body: { status: viewed|acknowledged|in_progress|completed, note }
 * Forward-only; skipped stages get their timestamp too.
 */
exports.updateMyStatus = async (req, res) => {
  try {
    const id = toInt(req.params.id);
    const target = req.body?.status;
    const note = req.body?.note ? String(req.body.note).trim() : null;

    if (!STATUS_TS[target]) return res.status(400).json({ message: 'Invalid status' });

    const existing = id && await fetchReminder(id);
    if (!existing) return res.status(404).json({ message: 'Reminder not found' });
    if (Number(existing.recipient_user_id) !== Number(req.user.id)) {
      return res.status(403).json({ message: 'This reminder is not assigned to you' });
    }
    if (existing.status === 'closed') return res.status(400).json({ message: 'This reminder was closed by the CEO' });

    const cur = STATUS_ORDER[existing.status] ?? 0;
    const next = STATUS_ORDER[target];
    if (next <= cur) {
      // Already at/after this stage — "viewed" is idempotent, others are errors
      if (target === 'viewed') return res.json(existing);
      return res.status(400).json({ message: `Reminder is already ${existing.status.replace('_', ' ')}` });
    }

    // Stamp the target stage and any skipped stages
    const stamps = Object.entries(STATUS_ORDER)
      .filter(([s, o]) => o > 0 && o <= next && o > cur && STATUS_TS[s])
      .map(([s]) => `${STATUS_TS[s]} = COALESCE(${STATUS_TS[s]}, NOW())`);

    await db.query(
      `UPDATE ceo_reminders SET status = ?, delivered_at = COALESCE(delivered_at, NOW()), ${stamps.join(', ')} WHERE id = ?`,
      [target, id]
    );
    await logActivity(id, target, { from: existing.status, to: target, note, actedBy: req.user.id });

    const updated = await fetchReminder(id);

    // Tell the CEO about meaningful progress (not plain "viewed")
    if (target !== 'viewed') {
      const label = { acknowledged: 'acknowledged', in_progress: 'started working on', completed: 'completed' }[target];
      notifyUsers([updated.created_by], 'ceo-reminders:alert', {
        kind: 'status', id, title: updated.title, priority: updated.priority,
        message: `${updated.recipient_name} ${label}: ${updated.title}${note ? ` — ${note}` : ''}`,
      });
    }
    broadcastChanged(updated);
    return res.json(updated);
  } catch (err) {
    console.error('Update my CEO reminder status error:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

/** POST /api/ceo-reminders/my/:id/note — head adds a comment without changing status */
exports.addMyNote = async (req, res) => {
  try {
    const id = toInt(req.params.id);
    const note = req.body?.note ? String(req.body.note).trim() : '';
    if (!note) return res.status(400).json({ message: 'Note is required' });

    const existing = id && await fetchReminder(id);
    if (!existing) return res.status(404).json({ message: 'Reminder not found' });
    if (Number(existing.recipient_user_id) !== Number(req.user.id)) {
      return res.status(403).json({ message: 'This reminder is not assigned to you' });
    }

    await logActivity(id, 'note', { from: existing.status, to: existing.status, note, actedBy: req.user.id });
    notifyUsers([existing.created_by], 'ceo-reminders:alert', {
      kind: 'note', id, title: existing.title, priority: existing.priority,
      message: `${existing.recipient_name} commented on "${existing.title}": ${note}`,
    });
    broadcastChanged(existing);
    return res.json({ message: 'Note added' });
  } catch (err) {
    console.error('Add CEO reminder note error:', err.message);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Exported for the notification feed and cron
exports._helpers = { notifyUsers, logActivity, OPEN_STATUSES };
