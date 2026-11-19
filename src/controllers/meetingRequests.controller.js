const db = require('../config/db');
const { emitEvent } = require('../config/socket');
const { listFounders } = require('../helpers/founders');

const toIntOrNull = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
};
const text = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());
const isYMD = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
  && !isNaN(new Date(`${s}T00:00:00Z`).getTime()) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const normTime = (s) => {
  if (s === undefined || s === null || String(s).trim() === '') return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(String(s).trim());
  return m ? `${m[1]}:${m[2]}:00` : undefined; // undefined = invalid
};
const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

function addMinutes(hhmmss, mins) {
  const [h, m] = hhmmss.split(':').map(Number);
  const total = Math.min(h * 60 + m + mins, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}:00`;
}

function notify(userIds, payload) {
  [...new Set(userIds.filter(Boolean).map(Number))].forEach((uid) => emitEvent('meeting-requests:changed', payload, `user:${uid}`));
}

const REQUEST_SELECT = `
  SELECT r.id, r.request_type, r.requested_by, r.founder_id, r.title, r.purpose,
         r.preferred_date, r.preferred_time, r.duration_minutes, r.status, r.decision_note,
         r.decided_at, r.meeting_id, r.created_at,
         CONCAT(u.first_name, ' ', u.last_name) AS requested_by_name,
         u.department AS requested_by_department,
         CONCAT(f.first_name, ' ', f.last_name) AS founder_name,
         (SELECT t.name FROM team_members tm JOIN teams t ON t.id = tm.team_id AND t.deleted = 0
           WHERE tm.user_id = r.requested_by LIMIT 1) AS team_name
    FROM meeting_requests r
    JOIN users u ON u.id = r.requested_by
    LEFT JOIN users f ON f.id = r.founder_id`;

async function isTeamHead(userId) {
  const [rows] = await db.query(
    `SELECT 1 FROM team_members tm JOIN teams t ON t.id = tm.team_id AND t.deleted = 0
      WHERE tm.user_id = ? AND tm.role = 'head' LIMIT 1`,
    [userId]
  );
  return rows.length > 0;
}

async function isFounderUser(user) {
  if (user.is_admin) return true;
  const founders = await listFounders();
  return founders.some((f) => f.id === user.id);
}

// GET /api/meeting-requests/founders   (who a request can be addressed to)
exports.founders = async (req, res) => {
  try {
    const rows = await listFounders();
    return res.json(rows.filter((f) => f.id !== req.user.id));
  } catch (err) {
    console.error('Meeting requests founders error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// POST /api/meeting-requests
// Body: { title?, purpose, preferred_date, preferred_time?, duration_minutes?, founder_id? }
exports.create = async (req, res) => {
  try {
    const b = req.body || {};
    const founders = (await listFounders()).filter((f) => f.id !== req.user.id);
    if (!founders.length) return res.status(400).json({ message: 'No Founder is set up to receive meeting requests' });

    let founderId = toIntOrNull(b.founder_id);
    if (founderId) {
      if (!founders.some((f) => f.id === founderId)) return res.status(400).json({ message: 'Choose a valid Founder' });
    } else if (founders.length === 1) {
      founderId = founders[0].id;
    } else {
      return res.status(400).json({ message: 'Choose who you want to meet' });
    }

    const purpose = text(b.purpose);
    if (!purpose) return res.status(400).json({ message: 'Please enter the purpose of the meeting' });

    if (!isYMD(b.preferred_date)) return res.status(400).json({ message: 'Choose a preferred date' });
    if (b.preferred_date < todayIST()) return res.status(400).json({ message: 'The preferred date cannot be in the past' });

    const time = normTime(b.preferred_time);
    if (time === undefined) return res.status(400).json({ message: 'Preferred time must be a valid time (HH:MM)' });

    const duration = b.duration_minutes === undefined || b.duration_minutes === '' ? 30 : parseInt(b.duration_minutes, 10);
    if (!Number.isInteger(duration) || duration < 5 || duration > 480) {
      return res.status(400).json({ message: 'Duration must be between 5 and 480 minutes' });
    }

    const head = await isTeamHead(req.user.id);
    const type = head ? 'department' : 'one_to_one';

    let title = text(b.title);
    if (type === 'department' && !title) return res.status(400).json({ message: 'Please enter a meeting title' });
    if (!title) {
      const [me] = await db.query('SELECT first_name, last_name FROM users WHERE id = ?', [req.user.id]);
      title = `1:1 – ${me[0] ? `${me[0].first_name} ${me[0].last_name}`.trim() : 'Employee'}`;
    }
    if (title.length > 255) return res.status(400).json({ message: 'Title is too long (max 255 characters)' });

    const [result] = await db.query(
      `INSERT INTO meeting_requests (request_type, requested_by, founder_id, title, purpose, preferred_date, preferred_time, duration_minutes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [type, req.user.id, founderId, title, purpose, b.preferred_date, time, duration]
    );
    const [rows] = await db.query(`${REQUEST_SELECT} WHERE r.id = ?`, [result.insertId]);
    notify([founderId, req.user.id], { id: result.insertId, status: 'pending' });
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Meeting request create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// GET /api/meeting-requests/mine   (requests I made)
exports.mine = async (req, res) => {
  try {
    const [rows] = await db.query(
      `${REQUEST_SELECT} WHERE r.requested_by = ? ORDER BY r.created_at DESC LIMIT 50`,
      [req.user.id]
    );
    return res.json(rows);
  } catch (err) {
    console.error('Meeting requests mine error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// GET /api/meeting-requests/inbox?status=pending   (requests addressed to me, Founder only)
exports.inbox = async (req, res) => {
  try {
    if (!(await isFounderUser(req.user))) return res.status(403).json({ message: 'Only the Founder can view meeting requests' });
    const status = ['pending', 'approved', 'rejected', 'cancelled'].includes(req.query.status) ? req.query.status : 'pending';
    const [rows] = await db.query(
      `${REQUEST_SELECT} WHERE r.founder_id = ? AND r.status = ?
       ORDER BY r.preferred_date ASC, r.preferred_time ASC, r.id ASC LIMIT 100`,
      [req.user.id, status]
    );
    return res.json(rows);
  } catch (err) {
    console.error('Meeting requests inbox error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// PATCH /api/meeting-requests/:id/decision
// Body: { action: 'approve' | 'reject', note?, meeting_date?, start_time?, duration_minutes? }
exports.decide = async (req, res) => {
  const conn = await db.getConnection();
  try {
    const id = toIntOrNull(req.params.id);
    const action = req.body?.action;
    if (!id || !['approve', 'reject'].includes(action)) return res.status(400).json({ message: 'action must be approve or reject' });

    const [found] = await conn.query('SELECT * FROM meeting_requests WHERE id = ?', [id]);
    const r = found[0];
    if (!r) return res.status(404).json({ message: 'Request not found' });
    if (r.founder_id !== req.user.id && !req.user.is_admin) return res.status(403).json({ message: 'This request is not addressed to you' });

    const note = text(req.body?.note);

    if (action === 'reject') {
      const [upd] = await conn.query(
        `UPDATE meeting_requests SET status = 'rejected', decision_note = ?, decided_by = ?, decided_at = NOW()
          WHERE id = ? AND status = 'pending'`,
        [note, req.user.id, id]
      );
      if (!upd.affectedRows) return res.status(409).json({ message: 'This request has already been decided' });
      notify([r.requested_by, r.founder_id], { id, status: 'rejected' });
      const [rows] = await db.query(`${REQUEST_SELECT} WHERE r.id = ?`, [id]);
      return res.json(rows[0]);
    }

    // Approve: schedule it (founder may adjust the date / time / length)
    const date = req.body?.meeting_date ? String(req.body.meeting_date).slice(0, 10) : String(r.preferred_date instanceof Date
      ? r.preferred_date.toLocaleDateString('en-CA') : r.preferred_date).slice(0, 10);
    if (!isYMD(date)) return res.status(400).json({ message: 'Choose a valid date' });
    if (date < todayIST()) return res.status(400).json({ message: 'The meeting date cannot be in the past' });

    const startRaw = req.body?.start_time !== undefined && req.body.start_time !== '' ? req.body.start_time : r.preferred_time;
    const start = normTime(startRaw);
    if (!start) return res.status(400).json({ message: 'Choose a start time to schedule this meeting' });

    const duration = req.body?.duration_minutes ? parseInt(req.body.duration_minutes, 10) : r.duration_minutes;
    if (!Number.isInteger(duration) || duration < 5 || duration > 480) {
      return res.status(400).json({ message: 'Duration must be between 5 and 480 minutes' });
    }
    const end = addMinutes(start, duration);

    await conn.beginTransaction();
    // Claim the request first so a double click cannot create two meetings
    const [claim] = await conn.query(
      `UPDATE meeting_requests SET status = 'approved', decision_note = ?, decided_by = ?, decided_at = NOW(),
              preferred_date = ?, preferred_time = ?, duration_minutes = ?
        WHERE id = ? AND status = 'pending'`,
      [note, req.user.id, date, start, duration, id]
    );
    if (!claim.affectedRows) {
      await conn.rollback();
      return res.status(409).json({ message: 'This request has already been decided' });
    }

    // Created by the requester so they can submit the MOM; the Founder is a member
    const [meeting] = await conn.query(
      `INSERT INTO meetings (title, description, meeting_type, meeting_date, start_time, end_time, location_type, status, created_by)
       VALUES (?, ?, 'office', ?, ?, ?, 'office', 'scheduled', ?)`,
      [r.title, r.purpose, date, start, end, r.requested_by]
    );
    await conn.query(
      'INSERT IGNORE INTO meeting_members (meeting_id, user_id) VALUES ?',
      [[[meeting.insertId, r.requested_by], [meeting.insertId, r.founder_id]]]
    );
    await conn.query('UPDATE meeting_requests SET meeting_id = ? WHERE id = ?', [meeting.insertId, id]);
    await conn.commit();

    notify([r.requested_by, r.founder_id], { id, status: 'approved', meeting_id: meeting.insertId });
    res.emitSocket?.('meeting:created', { id: meeting.insertId });
    const [rows] = await db.query(`${REQUEST_SELECT} WHERE r.id = ?`, [id]);
    return res.json(rows[0]);
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* no open transaction */ }
    console.error('Meeting request decide error:', err);
    return res.status(500).json({ message: 'Server error' });
  } finally {
    conn.release();
  }
};

// PATCH /api/meeting-requests/:id/cancel   (requester withdraws a pending request)
exports.cancel = async (req, res) => {
  try {
    const id = toIntOrNull(req.params.id);
    const [found] = await db.query('SELECT requested_by, founder_id FROM meeting_requests WHERE id = ?', [id]);
    const r = found[0];
    if (!r) return res.status(404).json({ message: 'Request not found' });
    if (r.requested_by !== req.user.id) return res.status(403).json({ message: 'Only the requester can cancel this request' });
    const [upd] = await db.query(
      "UPDATE meeting_requests SET status = 'cancelled' WHERE id = ? AND status = 'pending'",
      [id]
    );
    if (!upd.affectedRows) return res.status(409).json({ message: 'Only pending requests can be cancelled' });
    notify([r.founder_id, r.requested_by], { id, status: 'cancelled' });
    return res.json({ ok: true });
  } catch (err) {
    console.error('Meeting request cancel error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
