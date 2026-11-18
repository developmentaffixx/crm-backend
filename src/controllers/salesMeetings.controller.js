const db = require('../config/db');
const { getSubmenuAccess, getUserModulePermission } = require('../middleware/auth');

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const SLOTS         = ['morning', 'afternoon', 'evening'];
const MODES         = ['online', 'offline'];
const MEETING_TYPES = ['discovery', 'demo', 'proposal', 'negotiation', 'follow_up', 'other'];
const OUTCOMES      = ['attended', 'no_show', 'rescheduled', 'converted', 'follow_up'];

// Outcomes where the client actually met us
const ATTENDED_OUTCOMES = ['attended', 'converted', 'follow_up'];

// Targets. They will move to the Sales Targets feature later; kept in one place.
const TARGETS = {
  weekly: 15,             // 3 slots x 5 working days
  monthly: 60,
  attendance: 85,         // % of booked meetings that are attended
  conversion: 20,         // % of attended meetings that convert
  meetings_of_leads: 5,   // % of leads that turn into a meeting
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Today's date (YYYY-MM-DD) in IST, independent of the server timezone. */
function todayIST() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function isValidYMD(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function isWeekend(ymd) {
  const day = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

function addDaysYMD(ymd, days) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const ymd = (v) => (v ? String(v).slice(0, 10) : null);
const toIntOrNull = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
};

// ─────────────────────────────────────────────────────────────────────────────
// ACCESS  (Settings → Roles & Permissions → Sales)
//   view   : "Meetings" submenu level  0 none / 1 own / 2 all
//   book / attend / edit / del / team : on/off switches
// Admins always have everything. A user override wins over the role.
// ─────────────────────────────────────────────────────────────────────────────
async function resolveAccess(user) {
  if (user.is_admin) {
    return { view: 2, book: true, attend: true, edit: true, del: true, team: true };
  }
  const [view, book, attend, edit, del, team] = await Promise.all([
    getSubmenuAccess(user.id, 'revenue', 'meetings'),
    getSubmenuAccess(user.id, 'revenue', 'meeting_book'),
    getSubmenuAccess(user.id, 'revenue', 'meeting_attend'),
    getSubmenuAccess(user.id, 'revenue', 'meeting_edit'),
    getSubmenuAccess(user.id, 'revenue', 'meeting_delete'),
    getSubmenuAccess(user.id, 'revenue', 'team_meetings'),
  ]);
  return {
    view: Number(view) || 0,
    book: book >= 1,
    attend: attend >= 1,
    edit: edit >= 1,
    del: del >= 1,
    team: team >= 1,
  };
}

/** Middleware: loads req.access. Every route needs the Meetings menu (or Team Reports for /report). */
exports.loadAccess = async (req, res, next) => {
  try {
    req.access = await resolveAccess(req.user);
    return next();
  } catch (err) {
    console.error('Sales meetings access error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

function requireView(req, res) {
  if (!req.access || req.access.view < 1) {
    res.status(403).json({ message: 'You do not have access to Meetings' });
    return false;
  }
  return true;
}

/** Own = booked by me OR assigned to me as attendee. "All" level sees everything. */
function inScope(access, user, meeting) {
  if (access.view >= 2) return true;
  return meeting.created_by === user.id || meeting.attendee_id === user.id;
}

/** SQL fragment + params restricting rows to the user's scope. */
function scopeClause(access, user, alias = 'sm') {
  if (access.view >= 2) return { sql: '', params: [] };
  return {
    sql: ` AND (${alias}.created_by = ? OR ${alias}.attendee_id = ?)`,
    params: [user.id, user.id],
  };
}

/** Effective access value of a submenu key for a user alias `u` (user override, then role). */
function effectiveAccessSql(key) {
  return `COALESCE(
    (SELECT usp.can_access FROM user_submenu_permissions usp WHERE usp.user_id = u.id AND usp.module = 'revenue' AND usp.submenu = '${key}' LIMIT 1),
    (SELECT rsp.can_access FROM role_submenu_permissions rsp WHERE rsp.role_id = u.role_id AND rsp.module = 'revenue' AND rsp.submenu = '${key}' LIMIT 1),
    0)`;
}

/** Can this user be chosen as an attendee? (admin, or "Attend" switch on) */
async function canAttend(userId) {
  const [rows] = await db.query(
    'SELECT id, is_admin FROM users WHERE id = ? AND deleted = 0 AND is_active = 1',
    [userId]
  );
  if (!rows.length) return { exists: false, ok: false };
  if (rows[0].is_admin === 1) return { exists: true, ok: true };
  const level = await getSubmenuAccess(userId, 'revenue', 'meeting_attend');
  return { exists: true, ok: level >= 1 };
}

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULE VALIDATION (shared by create / edit / reschedule)
// Returns an error message, or null when OK.
// ─────────────────────────────────────────────────────────────────────────────
async function validateSchedule({ date, slot, attendeeId, excludeId = null, checkPast = true }) {
  if (!isValidYMD(date)) return 'meeting_date must be a valid date (YYYY-MM-DD)';
  if (isWeekend(date)) return 'Meetings can be scheduled Monday to Friday only';
  if (checkPast && date < todayIST()) return 'You cannot schedule a meeting in the past';
  if (!SLOTS.includes(slot)) return 'slot must be morning, afternoon, or evening';

  if (attendeeId) {
    const [clash] = await db.query(
      `SELECT id FROM sales_meetings
       WHERE deleted = 0 AND attendee_id = ? AND meeting_date = ? AND slot = ?
         AND outcome <> 'rescheduled' AND id <> ?
       LIMIT 1`,
      [attendeeId, date, slot, excludeId || 0]
    );
    if (clash.length) return 'The attendee already has a meeting in this slot';
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED SELECT
// ─────────────────────────────────────────────────────────────────────────────
const MEETING_SELECT = `
  SELECT sm.*,
         l.name          AS lead_name,
         l.lead_id       AS lead_code,
         l.business_name AS lead_business,
         l.lead_stage    AS lead_stage,
         CONCAT(u.first_name, ' ', u.last_name) AS created_by_name,
         CONCAT(a.first_name, ' ', a.last_name) AS attendee_name
  FROM sales_meetings sm
  LEFT JOIN leads l ON l.id = sm.lead_id AND l.deleted = 0
  LEFT JOIN users u ON u.id = sm.created_by
  LEFT JOIN users a ON a.id = sm.attendee_id`;

async function fetchMeeting(id) {
  const [rows] = await db.query(`${MEETING_SELECT} WHERE sm.id = ?`, [id]);
  return rows[0] || null;
}

async function findActiveMeeting(id) {
  const [rows] = await db.query('SELECT * FROM sales_meetings WHERE id = ? AND deleted = 0', [id]);
  return rows[0] || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// After a meeting outcome is set, write a corresponding follow-up entry on the
// linked lead so lead history and meeting history stay in sync.
// opts.nextDate: date of the next follow-up (defaults to tomorrow)
// opts.extraNote: appended to the follow-up note
// ─────────────────────────────────────────────────────────────────────────────
async function syncFollowUpFromMeeting(meeting, userId, opts = {}) {
  if (!meeting.lead_id) return null;

  const outcomeMap = {
    attended:    'Meeting Scheduled',
    no_show:     'Callback Requested',
    rescheduled: 'Callback Requested',
    converted:   'Converted',
    follow_up:   'Meeting Scheduled',
  };

  const outcome = outcomeMap[meeting.outcome];
  if (!outcome) return null; // pending: nothing to sync yet

  const noteMap = {
    attended:    `Meeting attended (${meeting.mode}). Post-meeting: ${meeting.post_confirmed_note || '-'}`,
    no_show:     `Client no-show for scheduled ${meeting.mode} meeting on ${ymd(meeting.meeting_date)}.`,
    rescheduled: `Meeting rescheduled from ${ymd(meeting.meeting_date)}. ${opts.extraNote || ''} ${meeting.post_confirmed_note || ''}`.trim(),
    converted:   `Deal converted during ${meeting.mode} meeting on ${ymd(meeting.meeting_date)}. ${meeting.post_confirmed_note || ''}`.trim(),
    follow_up:   `Meeting done. Next meeting required. ${meeting.post_confirmed_note || ''}`.trim(),
  };
  const note = noteMap[meeting.outcome] || `Meeting outcome: ${meeting.outcome}`;

  let follow_up_date = opts.nextDate;
  if (!follow_up_date) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    follow_up_date = tomorrow.toISOString().slice(0, 10);
  }

  const [result] = await db.query(
    `INSERT INTO lead_follow_ups (lead_id, type, outcome, note, follow_up_date, created_by, created_at)
     VALUES (?, 'Meeting', ?, ?, ?, ?, NOW())`,
    [meeting.lead_id, outcome, note, follow_up_date, userId]
  );

  // Record which follow-up this meeting created. Daily Reporting uses this link
  // so an auto-created follow-up is not counted as a second "meeting booked".
  await db.query(
    'UPDATE sales_meetings SET linked_follow_up_id = ? WHERE id = ?',
    [result.insertId, meeting.id]
  );

  // Auto-advance lead stage based on outcome
  const stageMap = {
    attended:    { stage: 'Meeting',   temperature: 'hot',  score: 4 },
    no_show:     { stage: 'Contacted', temperature: 'cold', score: 1 },
    rescheduled: { stage: 'Meeting',   temperature: 'warm', score: 3 },
    converted:   { stage: 'Won',       temperature: 'hot',  score: 5 },
    follow_up:   { stage: 'Proposal',  temperature: 'hot',  score: 4 },
  };

  const advance = stageMap[meeting.outcome];
  if (advance) {
    // Only advance stage (never go backward, except Won/Lost)
    const stageOrder = ['New','Contacted','Replied','Interested','Qualified','Meeting','Proposal','Negotiation','Won','Lost'];
    const [leadRows] = await db.query('SELECT lead_stage, status FROM leads WHERE id = ?', [meeting.lead_id]);
    if (leadRows.length > 0) {
      const currentIdx = stageOrder.indexOf(leadRows[0].lead_stage || 'New');
      const newIdx = stageOrder.indexOf(advance.stage);
      if (advance.stage === 'Won' || advance.stage === 'Lost' || newIdx > currentIdx) {
        if (advance.stage === 'Won') {
          const [existLead] = await db.query('SELECT client_code FROM leads WHERE id = ?', [meeting.lead_id]);
          if (!existLead[0]?.client_code) {
            const [maxRows] = await db.query(
              `SELECT MAX(CAST(SUBSTRING(client_code, 6) AS UNSIGNED)) AS max_seq FROM leads WHERE client_code IS NOT NULL AND client_code LIKE 'AFXCL%'`
            );
            const seq = String((maxRows[0]?.max_seq || 0) + 1).padStart(3, '0');
            const client_code = `AFXCL${seq}`;
            await db.query(
              `UPDATE leads SET lead_stage = ?, status = ?, temperature = ?, lead_score = ?, client_code = ?, converted_at = NOW() WHERE id = ?`,
              [advance.stage, advance.stage, advance.temperature, advance.score, client_code, meeting.lead_id]
            );
          } else {
            await db.query(
              `UPDATE leads SET lead_stage = ?, status = ?, temperature = ?, lead_score = ? WHERE id = ?`,
              [advance.stage, advance.stage, advance.temperature, advance.score, meeting.lead_id]
            );
          }
        } else {
          await db.query(
            `UPDATE leads SET lead_stage = ?, status = ?, temperature = ?, lead_score = ? WHERE id = ?`,
            [advance.stage, advance.stage, advance.temperature, advance.score, meeting.lead_id]
          );
        }
        await db.query(
          'INSERT INTO lead_status_history (lead_id, old_status, new_status, changed_by) VALUES (?, ?, ?, ?)',
          [meeting.lead_id, leadRows[0].lead_stage || 'New', advance.stage, userId]
        );
      }
    }
  }

  return result.insertId;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sales-meetings
// Query: start, end (YYYY-MM-DD), user_id (booked by OR attending; "All" level only), lead_id
// ─────────────────────────────────────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    if (!requireView(req, res)) return;
    const { start, end, user_id, lead_id } = req.query;

    let where = 'sm.deleted = 0';
    const params = [];

    if (start) {
      if (!isValidYMD(start)) return res.status(400).json({ message: 'start must be YYYY-MM-DD' });
      where += ' AND sm.meeting_date >= ?'; params.push(start);
    }
    if (end) {
      if (!isValidYMD(end)) return res.status(400).json({ message: 'end must be YYYY-MM-DD' });
      where += ' AND sm.meeting_date <= ?'; params.push(end);
    }
    if (lead_id) { where += ' AND sm.lead_id = ?'; params.push(parseInt(lead_id, 10)); }

    const scope = scopeClause(req.access, req.user);
    where += scope.sql;
    params.push(...scope.params);

    const uid = toIntOrNull(user_id);
    if (req.access.view >= 2 && uid) {
      where += ' AND (sm.created_by = ? OR sm.attendee_id = ?)';
      params.push(uid, uid);
    }

    const [rows] = await db.query(
      `${MEETING_SELECT}
       WHERE ${where}
       ORDER BY sm.meeting_date ASC, FIELD(sm.slot, 'morning', 'afternoon', 'evening')`,
      params
    );
    return res.json(rows);
  } catch (err) {
    console.error('Sales meetings list error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sales-meetings/attendees
// People who can be chosen as attendee (Attend switch on, or admin).
// ?scope=any  returns everyone who can book OR attend (used by the person filter).
// ─────────────────────────────────────────────────────────────────────────────
exports.attendees = async (req, res) => {
  try {
    if (!requireView(req, res)) return;

    const cond = req.query.scope === 'any'
      ? `(${effectiveAccessSql('meeting_attend')} >= 1 OR ${effectiveAccessSql('meeting_book')} >= 1)`
      : `${effectiveAccessSql('meeting_attend')} >= 1`;

    const [rows] = await db.query(
      `SELECT u.id, CONCAT(u.first_name, ' ', u.last_name) AS name
       FROM users u
       WHERE u.deleted = 0 AND u.is_active = 1 AND (u.is_admin = 1 OR ${cond})
       ORDER BY u.first_name, u.last_name`
    );
    return res.json(rows);
  } catch (err) {
    console.error('Sales meetings attendees error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sales-meetings/stats
// Query: week_start (YYYY-MM-DD, a Monday), month (YYYY-MM), user_id ("All" level only)
//   count      = meetings booked (a meeting that was rescheduled is replaced by the new one)
//   attendance = attended / (attended + no-show), among meetings with a recorded outcome
// ─────────────────────────────────────────────────────────────────────────────
exports.stats = async (req, res) => {
  try {
    if (!requireView(req, res)) return;
    const { week_start, month, user_id } = req.query;

    let userFilter = '';
    const baseParams = [];
    const scope = scopeClause(req.access, req.user);
    userFilter += scope.sql;
    baseParams.push(...scope.params);

    const uid = toIntOrNull(user_id);
    if (req.access.view >= 2 && uid) {
      userFilter += ' AND (sm.created_by = ? OR sm.attendee_id = ?)';
      baseParams.push(uid, uid);
    }

    let weeklyCount = 0;
    if (week_start) {
      if (!isValidYMD(week_start)) return res.status(400).json({ message: 'week_start must be YYYY-MM-DD' });
      const [weekRows] = await db.query(
        `SELECT COUNT(*) AS cnt FROM sales_meetings sm
         WHERE sm.deleted = 0
           AND sm.meeting_date >= ?
           AND sm.meeting_date < DATE_ADD(?, INTERVAL 5 DAY)
           AND sm.outcome <> 'rescheduled'
           ${userFilter}`,
        [week_start, week_start, ...baseParams]
      );
      weeklyCount = weekRows[0]?.cnt || 0;
    }

    let monthlyCount = 0;
    let outcomeBreakdown = [];
    let attendance = { attended: 0, no_show: 0, rate: null, target: TARGETS.attendance };
    if (month) {
      if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ message: 'month must be YYYY-MM' });

      const [obRows] = await db.query(
        `SELECT sm.outcome, COUNT(*) AS cnt FROM sales_meetings sm
         WHERE sm.deleted = 0
           AND DATE_FORMAT(sm.meeting_date, '%Y-%m') = ?
           ${userFilter}
         GROUP BY sm.outcome`,
        [month, ...baseParams]
      );
      outcomeBreakdown = obRows;

      let attended = 0;
      let noShow = 0;
      obRows.forEach(r => {
        const n = Number(r.cnt);
        if (r.outcome !== 'rescheduled') monthlyCount += n;
        if (ATTENDED_OUTCOMES.includes(r.outcome)) attended += n;
        if (r.outcome === 'no_show') noShow += n;
      });
      const held = attended + noShow;
      attendance = {
        attended,
        no_show: noShow,
        rate: held > 0 ? Math.round((attended / held) * 100) : null,
        target: TARGETS.attendance,
      };
    }

    return res.json({
      weekly:  { count: weeklyCount,  target: TARGETS.weekly },
      monthly: { count: monthlyCount, target: TARGETS.monthly },
      attendance,
      outcomeBreakdown,
    });
  } catch (err) {
    console.error('Sales meetings stats error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sales-meetings/report   (Team Meetings, needs the "Team Reports" switch)
// Query: from, to (YYYY-MM-DD). Defaults to the current month (IST).
// ─────────────────────────────────────────────────────────────────────────────
function summarize(rows) {
  const c = { pending: 0, attended: 0, no_show: 0, rescheduled: 0, converted: 0, follow_up: 0 };
  let total = 0;
  rows.forEach(r => {
    const n = Number(r.cnt) || 0;
    c[r.outcome] = (c[r.outcome] || 0) + n;
    total += n;
  });
  const booked = total - c.rescheduled;
  const attendedTotal = c.attended + c.converted + c.follow_up;
  const held = attendedTotal + c.no_show;
  return {
    booked,
    pending: c.pending,
    attended: attendedTotal,
    no_show: c.no_show,
    rescheduled: c.rescheduled,
    converted: c.converted,
    follow_up: c.follow_up,
    attendance_rate: held > 0 ? Math.round((attendedTotal / held) * 100) : null,
    conversion_rate: attendedTotal > 0 ? Math.round((c.converted / attendedTotal) * 100) : null,
  };
}

exports.report = async (req, res) => {
  try {
    if (!req.access.team) return res.status(403).json({ message: 'You do not have access to Team Meetings reports' });

    const today = todayIST();
    let { from, to } = req.query;
    if (!from || !to) {
      from = `${today.slice(0, 7)}-01`;
      const [y, m] = today.split('-').map(Number);
      to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); // last day of month
    }
    if (!isValidYMD(from) || !isValidYMD(to)) return res.status(400).json({ message: 'from and to must be YYYY-MM-DD' });
    if (from > to) return res.status(400).json({ message: 'from must not be after to' });

    const range = [from, to];

    const [overall] = await db.query(
      `SELECT outcome, COUNT(*) AS cnt FROM sales_meetings
       WHERE deleted = 0 AND meeting_date BETWEEN ? AND ?
       GROUP BY outcome`,
      range
    );
    const [byAttendee] = await db.query(
      `SELECT attendee_id AS uid, outcome, COUNT(*) AS cnt FROM sales_meetings
       WHERE deleted = 0 AND meeting_date BETWEEN ? AND ? AND attendee_id IS NOT NULL
       GROUP BY attendee_id, outcome`,
      range
    );
    const [byBooker] = await db.query(
      `SELECT created_by AS uid, COUNT(*) AS cnt FROM sales_meetings
       WHERE deleted = 0 AND meeting_date BETWEEN ? AND ? AND outcome <> 'rescheduled'
       GROUP BY created_by`,
      range
    );
    const [byMode] = await db.query(
      `SELECT mode AS k, outcome, COUNT(*) AS cnt FROM sales_meetings
       WHERE deleted = 0 AND meeting_date BETWEEN ? AND ?
       GROUP BY mode, outcome`,
      range
    );
    const [byType] = await db.query(
      `SELECT meeting_type AS k, outcome, COUNT(*) AS cnt FROM sales_meetings
       WHERE deleted = 0 AND meeting_date BETWEEN ? AND ?
       GROUP BY meeting_type, outcome`,
      range
    );
    const [leadRows] = await db.query(
      'SELECT COUNT(*) AS cnt FROM leads WHERE deleted = 0 AND DATE(created_at) BETWEEN ? AND ?',
      range
    );

    const group = (rows, keyField) => {
      const map = new Map();
      rows.forEach(r => {
        const k = r[keyField];
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(r);
      });
      return map;
    };

    // People
    const attendeeMap = group(byAttendee, 'uid');
    const bookerMap = new Map(byBooker.map(r => [r.uid, Number(r.cnt)]));
    const ids = [...new Set([...attendeeMap.keys(), ...bookerMap.keys()])];
    let names = {};
    if (ids.length) {
      const [users] = await db.query(
        "SELECT id, CONCAT(first_name, ' ', last_name) AS name FROM users WHERE id IN (?)",
        [ids]
      );
      users.forEach(u => { names[u.id] = u.name; });
    }
    const by_person = ids.map(uid => ({
      user_id: uid,
      name: names[uid] || `User #${uid}`,
      booked_by_them: bookerMap.get(uid) || 0,
      as_attendee: summarize(attendeeMap.get(uid) || []),
    })).sort((a, b) => a.name.localeCompare(b.name));

    const labelled = (rows) => [...group(rows, 'k').entries()].map(([k, list]) => ({ key: k, ...summarize(list) }));

    const summary = summarize(overall);
    const leadsInPeriod = Number(leadRows[0]?.cnt) || 0;

    return res.json({
      from,
      to,
      targets: TARGETS,
      summary,
      leads_in_period: leadsInPeriod,
      meetings_pct_of_leads: leadsInPeriod > 0 ? Math.round((summary.booked / leadsInPeriod) * 1000) / 10 : null,
      by_person,
      by_mode: labelled(byMode),
      by_type: labelled(byType),
    });
  } catch (err) {
    console.error('Sales meetings report error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/sales-meetings   (needs the "Book" switch)
// Body: { meeting_date, slot, attendee_id?, lead_id?, mode?, meeting_type?, title?, location_or_link?, notes? }
// ─────────────────────────────────────────────────────────────────────────────
exports.create = async (req, res) => {
  try {
    if (!requireView(req, res)) return;
    if (!req.access.book) return res.status(403).json({ message: 'You do not have permission to book meetings' });

    const { meeting_date, slot, lead_id, mode, title, notes, meeting_type, location_or_link } = req.body;

    const modeVal = mode || 'online';
    if (!MODES.includes(modeVal)) return res.status(400).json({ message: 'mode must be online or offline' });
    const typeVal = meeting_type || 'discovery';
    if (!MEETING_TYPES.includes(typeVal)) return res.status(400).json({ message: 'Invalid meeting_type' });

    // Attendee: default to the booker, but only if the booker can attend
    let attendeeId = toIntOrNull(req.body.attendee_id);
    if (!attendeeId) {
      if (!req.access.attend && !req.user.is_admin) {
        return res.status(400).json({ message: 'Choose who will attend this meeting' });
      }
      attendeeId = req.user.id;
    }
    const att = await canAttend(attendeeId);
    if (!att.exists) return res.status(400).json({ message: 'Attendee not found' });
    if (!att.ok) return res.status(400).json({ message: 'The selected person is not allowed to attend meetings' });

    const leadId = toIntOrNull(lead_id);
    if (leadId) {
      const [leadRows] = await db.query('SELECT id FROM leads WHERE id = ? AND deleted = 0', [leadId]);
      if (!leadRows.length) return res.status(400).json({ message: 'Lead not found' });
    }

    const scheduleError = await validateSchedule({ date: meeting_date, slot, attendeeId });
    if (scheduleError) return res.status(scheduleError.includes('already has') ? 409 : 400).json({ message: scheduleError });

    const [result] = await db.query(
      `INSERT INTO sales_meetings
         (lead_id, created_by, attendee_id, meeting_date, slot, mode, meeting_type, title, location_or_link, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [leadId, req.user.id, attendeeId, meeting_date, slot, modeVal, typeVal, title || null, location_or_link || null, notes || null]
    );

    return res.status(201).json(await fetchMeeting(result.insertId));
  } catch (err) {
    console.error('Sales meeting create error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sales-meetings/:id
// ─────────────────────────────────────────────────────────────────────────────
exports.getOne = async (req, res) => {
  try {
    if (!requireView(req, res)) return;

    const [rows] = await db.query(
      `SELECT sm.*, l.name AS lead_name, l.lead_id AS lead_code, l.business_name AS lead_business,
              l.lead_stage, l.temperature, l.phone AS lead_phone,
              l.assigned_to AS lead_assigned_to, l.created_by AS lead_created_by,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name,
              CONCAT(a.first_name, ' ', a.last_name) AS attendee_name
       FROM sales_meetings sm
       LEFT JOIN leads l ON l.id = sm.lead_id AND l.deleted = 0
       LEFT JOIN users u ON u.id = sm.created_by
       LEFT JOIN users a ON a.id = sm.attendee_id
       WHERE sm.id = ? AND sm.deleted = 0`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Meeting not found' });

    const meeting = rows[0];
    if (!inScope(req.access, req.user, meeting)) return res.status(403).json({ message: 'Access denied' });

    // Lead contact details only for the lead's owner, or people who can see all sales data
    let canSeeContact = !!req.user.is_admin
      || meeting.lead_assigned_to === req.user.id
      || meeting.lead_created_by === req.user.id;
    if (!canSeeContact) {
      const perms = await getUserModulePermission(req.user.id, 'revenue');
      canSeeContact = (perms.can_view || 0) >= 2;
    }
    if (!canSeeContact) meeting.lead_phone = null;
    delete meeting.lead_assigned_to;
    delete meeting.lead_created_by;

    return res.json(meeting);
  } catch (err) {
    console.error('Sales meeting getOne error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/sales-meetings/:id   (needs the "Edit / Reschedule" switch)
// After the outcome is recorded only title, notes and location can change.
// ─────────────────────────────────────────────────────────────────────────────
exports.update = async (req, res) => {
  try {
    if (!requireView(req, res)) return;
    if (!req.access.edit) return res.status(403).json({ message: 'You do not have permission to edit meetings' });

    const meeting = await findActiveMeeting(req.params.id);
    if (!meeting) return res.status(404).json({ message: 'Meeting not found' });
    if (!inScope(req.access, req.user, meeting)) return res.status(403).json({ message: 'Access denied' });

    const b = req.body;
    const updates = {};

    if (b.title !== undefined) updates.title = b.title || null;
    if (b.notes !== undefined) updates.notes = b.notes || null;
    if (b.location_or_link !== undefined) updates.location_or_link = b.location_or_link || null;

    const newDate = b.meeting_date !== undefined ? ymd(b.meeting_date) : ymd(meeting.meeting_date);
    const newSlot = b.slot !== undefined ? b.slot : meeting.slot;
    const newAttendee = b.attendee_id !== undefined ? toIntOrNull(b.attendee_id) : meeting.attendee_id;
    const newLead = b.lead_id !== undefined ? toIntOrNull(b.lead_id) : meeting.lead_id;
    const newMode = b.mode !== undefined ? b.mode : meeting.mode;
    const newType = b.meeting_type !== undefined ? b.meeting_type : meeting.meeting_type;

    const dateChanged = newDate !== ymd(meeting.meeting_date);
    const slotChanged = newSlot !== meeting.slot;
    const attendeeChanged = newAttendee !== meeting.attendee_id;
    const leadChanged = newLead !== meeting.lead_id;
    const modeChanged = newMode !== meeting.mode;
    const typeChanged = newType !== meeting.meeting_type;

    if (dateChanged || slotChanged || attendeeChanged || leadChanged || modeChanged || typeChanged) {
      if (meeting.post_confirmed) {
        return res.status(409).json({ message: 'The outcome is already recorded. Only title, notes and location can be changed' });
      }
      if (!MODES.includes(newMode)) return res.status(400).json({ message: 'mode must be online or offline' });
      if (!MEETING_TYPES.includes(newType)) return res.status(400).json({ message: 'Invalid meeting_type' });

      if (attendeeChanged) {
        if (!newAttendee) return res.status(400).json({ message: 'Choose who will attend this meeting' });
        const att = await canAttend(newAttendee);
        if (!att.exists) return res.status(400).json({ message: 'Attendee not found' });
        if (!att.ok) return res.status(400).json({ message: 'The selected person is not allowed to attend meetings' });
      }
      if (leadChanged && newLead) {
        const [leadRows] = await db.query('SELECT id FROM leads WHERE id = ? AND deleted = 0', [newLead]);
        if (!leadRows.length) return res.status(400).json({ message: 'Lead not found' });
      }
      if (dateChanged || slotChanged || attendeeChanged) {
        const scheduleError = await validateSchedule({
          date: newDate, slot: newSlot, attendeeId: newAttendee,
          excludeId: meeting.id, checkPast: dateChanged,
        });
        if (scheduleError) return res.status(scheduleError.includes('already has') ? 409 : 400).json({ message: scheduleError });
      }

      Object.assign(updates, {
        meeting_date: newDate, slot: newSlot, attendee_id: newAttendee,
        lead_id: newLead, mode: newMode, meeting_type: newType,
      });
      // A changed date/slot/attendee means the earlier confirmation no longer applies
      if (dateChanged || slotChanged || attendeeChanged) {
        updates.pre_confirmed = 0;
        updates.pre_confirmed_at = null;
        updates.pre_confirmed_by = null;
      }
    }

    if (Object.keys(updates).length === 0) return res.status(400).json({ message: 'No changes to save' });

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await db.query(`UPDATE sales_meetings SET ${setClauses} WHERE id = ?`, [...Object.values(updates), meeting.id]);

    return res.json(await fetchMeeting(meeting.id));
  } catch (err) {
    console.error('Sales meeting update error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/sales-meetings/:id/pre-confirm   (Book or Attend switch)
// ─────────────────────────────────────────────────────────────────────────────
exports.preConfirm = async (req, res) => {
  try {
    if (!requireView(req, res)) return;
    if (!req.access.book && !req.access.attend) {
      return res.status(403).json({ message: 'You do not have permission to confirm meetings' });
    }

    const meeting = await findActiveMeeting(req.params.id);
    if (!meeting) return res.status(404).json({ message: 'Meeting not found' });
    if (!inScope(req.access, req.user, meeting)) return res.status(403).json({ message: 'Access denied' });
    if (meeting.post_confirmed) return res.status(409).json({ message: 'The outcome is already recorded' });

    if (!meeting.pre_confirmed) {
      await db.query(
        'UPDATE sales_meetings SET pre_confirmed = 1, pre_confirmed_at = NOW(), pre_confirmed_by = ? WHERE id = ?',
        [req.user.id, meeting.id]
      );
    }
    return res.json(await fetchMeeting(meeting.id));
  } catch (err) {
    console.error('Pre-confirm error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/sales-meetings/:id/post-confirm   (needs the "Attend & Outcome" switch)
// Body: { outcome, post_confirmed_note, new_meeting_date?, new_slot? }
//  - only the attendee (or someone with "All" level) can record the outcome
//  - not before the meeting date, and only once
//  - "rescheduled" creates the new meeting
// ─────────────────────────────────────────────────────────────────────────────
exports.postConfirm = async (req, res) => {
  let conn;
  try {
    if (!requireView(req, res)) return;
    if (!req.access.attend) return res.status(403).json({ message: 'You do not have permission to record meeting outcomes' });

    const meeting = await findActiveMeeting(req.params.id);
    if (!meeting) return res.status(404).json({ message: 'Meeting not found' });

    const attendeeId = meeting.attendee_id || meeting.created_by;
    if (!req.user.is_admin && req.access.view < 2 && attendeeId !== req.user.id) {
      return res.status(403).json({ message: 'Only the attendee can record the outcome of this meeting' });
    }
    if (meeting.post_confirmed) return res.status(409).json({ message: 'The outcome is already recorded' });
    if (ymd(meeting.meeting_date) > todayIST()) {
      return res.status(400).json({ message: 'The outcome can be recorded only on or after the meeting date' });
    }

    const { outcome, post_confirmed_note, new_meeting_date, new_slot } = req.body;
    if (!outcome || !OUTCOMES.includes(outcome)) {
      return res.status(400).json({ message: `outcome must be one of: ${OUTCOMES.join(', ')}` });
    }

    // Rescheduling needs the new date and slot, validated like a fresh booking
    if (outcome === 'rescheduled') {
      if (!new_meeting_date || !new_slot) {
        return res.status(400).json({ message: 'Choose the new date and slot for the rescheduled meeting' });
      }
      if (new_meeting_date === ymd(meeting.meeting_date) && new_slot === meeting.slot) {
        return res.status(400).json({ message: 'Choose a different date or slot' });
      }
      const scheduleError = await validateSchedule({
        date: new_meeting_date, slot: new_slot, attendeeId: attendeeId, excludeId: meeting.id,
      });
      if (scheduleError) return res.status(scheduleError.includes('already has') ? 409 : 400).json({ message: scheduleError });
    }

    let newMeetingId = null;
    conn = await db.getConnection();
    await conn.beginTransaction();

    // Guarded update: if two requests race, only one gets affectedRows = 1
    const [upd] = await conn.query(
      `UPDATE sales_meetings SET
         post_confirmed = 1, post_confirmed_at = NOW(), post_confirmed_note = ?, outcome = ?
       WHERE id = ? AND post_confirmed = 0 AND deleted = 0`,
      [post_confirmed_note || null, outcome, meeting.id]
    );
    if (upd.affectedRows === 0) {
      await conn.rollback();
      return res.status(409).json({ message: 'The outcome is already recorded' });
    }

    if (outcome === 'rescheduled') {
      const [ins] = await conn.query(
        `INSERT INTO sales_meetings
           (lead_id, created_by, attendee_id, meeting_date, slot, mode, meeting_type, title, location_or_link, notes, reschedule_of)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [meeting.lead_id, meeting.created_by, attendeeId, new_meeting_date, new_slot, meeting.mode,
         meeting.meeting_type, meeting.title, meeting.location_or_link, meeting.notes, meeting.id]
      );
      newMeetingId = ins.insertId;
      await conn.query('UPDATE sales_meetings SET followup_meeting_id = ? WHERE id = ?', [newMeetingId, meeting.id]);
    }
    await conn.commit();
    conn.release();
    conn = null;

    // Sync the lead follow-up and stage (after the meeting itself is safely saved)
    let syncFailed = false;
    try {
      const updated = await findActiveMeeting(meeting.id);
      await syncFollowUpFromMeeting(updated, req.user.id, outcome === 'rescheduled'
        ? { nextDate: new_meeting_date, extraNote: `New meeting: ${new_meeting_date} (${new_slot}).` }
        : {});
    } catch (syncErr) {
      syncFailed = true;
      console.error('Meeting follow-up sync failed:', syncErr);
    }

    const final = await fetchMeeting(meeting.id);
    return res.json({ ...final, new_meeting_id: newMeetingId, sync_failed: syncFailed });
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch (e) { /* ignore */ }
      conn.release();
    }
    console.error('Post-confirm error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/sales-meetings/:id (soft delete, needs the "Delete" switch)
// ─────────────────────────────────────────────────────────────────────────────
exports.remove = async (req, res) => {
  try {
    if (!requireView(req, res)) return;
    if (!req.access.del) return res.status(403).json({ message: 'You do not have permission to delete meetings' });

    const meeting = await findActiveMeeting(req.params.id);
    if (!meeting) return res.status(404).json({ message: 'Meeting not found' });
    if (!inScope(req.access, req.user, meeting)) return res.status(403).json({ message: 'Access denied' });

    await db.query('UPDATE sales_meetings SET deleted = 1 WHERE id = ?', [meeting.id]);
    return res.json({ message: 'Meeting deleted' });
  } catch (err) {
    console.error('Sales meeting delete error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
};
