const db = require('../config/db');
const {
  todayIST, toDateStr, parseJson, parseEntry,
  requiredServices, submittedKeys, userStatus, resolveEntryService, LIVE_SERVICE_SQL,
} = require('../helpers/dailyUpdate');

const WORK_CATEGORIES = ['Content', 'Shoot', 'Ads', 'Design - Editing', 'Social Listenings'];
const NO_ISSUES = 'No Issues';

/** Daily Update access level for the request (admin = 2). */
function levelOf(req) {
  if (req.user.is_admin) return 2;
  return Number(req.socialAccessLevel) >= 2 ? 2 : 1;
}

/** Same-day lock: non-admins may edit / delete only their own entry, on the entry's date (IST). */
function rowRights(req, row) {
  if (req.user.is_admin) return { can_edit: true, can_delete: true };
  const own = Number(row.submitted_by) === Number(req.user.id);
  const sameDay = toDateStr(row.journal_date) === todayIST();
  return { can_edit: own && sameDay, can_delete: own && sameDay };
}

/**
 * Clean + validate the submitted body. Returns the column values or throws { status, message }.
 * Health status is always computed here (the client value is ignored).
 */
function normaliseBody(body) {
  // Work Done: { Category: [points] } — keep known categories, trimmed, non-empty
  const rawCats = parseJson(body.work_categories, {}) || {};
  const work = {};
  let pointCount = 0;
  WORK_CATEGORIES.forEach(cat => {
    const pts = Array.isArray(rawCats[cat]) ? rawCats[cat] : [];
    work[cat] = pts.map(p => String(p ?? '').trim()).filter(Boolean).slice(0, 50);
    pointCount += work[cat].length;
  });
  if (pointCount === 0) throw { status: 400, message: 'Add at least one "Work Done Today" point' };

  const comm = body.client_communication === 'yes' ? 'yes' : 'no';
  const commSummary = comm === 'yes' ? (String(body.communication_summary || '').trim() || null) : null;

  let issues = (Array.isArray(body.issues_delays) ? body.issues_delays : [])
    .map(i => String(i ?? '').trim()).filter(Boolean);
  issues = [...new Set(issues)];
  if (issues.some(i => i !== NO_ISSUES)) issues = issues.filter(i => i !== NO_ISSUES);
  const hasIssues = issues.some(i => i !== NO_ISSUES);
  const issuesDetails = hasIssues ? (String(body.issues_details || '').trim() || null) : null;

  const priorities = (Array.isArray(body.tomorrow_priorities) ? body.tomorrow_priorities : [])
    .map(p => String(p ?? '').trim()).filter(Boolean).slice(0, 3);

  const escalation = body.escalation_required === 'yes' ? 'yes' : 'no';
  const escalationDetails = escalation === 'yes' ? (String(body.escalation_details || '').trim() || null) : null;
  if (escalation === 'yes' && !escalationDetails) throw { status: 400, message: 'Please add the escalation details' };

  const health = escalation === 'yes' ? 'critical' : (hasIssues ? 'attention_needed' : 'on_track');

  return {
    work_categories: JSON.stringify(work),
    client_communication: comm,
    communication_summary: commSummary,
    issues_delays: issues.length ? JSON.stringify(issues) : null,
    issues_details: issuesDetails,
    leads_opportunities: String(body.leads_opportunities || '').trim() || null,
    tomorrow_priorities: priorities.length ? JSON.stringify(priorities) : null,
    escalation_required: escalation,
    escalation_details: escalationDetails,
    health_status: health,
  };
}

const ENTRY_SELECT = `
  SELECT dj.*,
         p.title AS project_title,
         l.business_name AS client_name,
         s.name AS service_name,
         CONCAT(u.first_name, ' ', u.last_name) AS submitted_by_name
  FROM smm_daily_journal dj
  LEFT JOIN projects p          ON p.id = dj.project_id
  LEFT JOIN leads l             ON l.id = p.client_id
  LEFT JOIN project_services ps ON ps.id = dj.project_service_id
  LEFT JOIN services s          ON s.id = ps.service_id
  LEFT JOIN users u             ON u.id = dj.submitted_by`;

async function fetchEntry(id) {
  const [rows] = await db.query(`${ENTRY_SELECT} WHERE dj.id = ?`, [id]);
  return rows.length ? parseEntry(rows[0]) : null;
}

function sendError(res, err, label) {
  if (err && err.status) return res.status(err.status).json({ message: err.message });
  console.error(`Daily Update ${label} error:`, err);
  return res.status(500).json({ message: 'Server error' });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/daily-journal — list (Own = my entries, All = everyone's)
// ─────────────────────────────────────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    const {
      project_id, project_service_id, user_id, client_id, date_from, date_to,
      health_status, client_communication, escalation_required,
    } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const level = levelOf(req);

    let where = '1=1';
    const params = [];
    if (level < 2) { where += ' AND dj.submitted_by = ?'; params.push(req.user.id); }
    else if (user_id) { where += ' AND dj.submitted_by = ?'; params.push(user_id); }
    if (project_id) { where += ' AND dj.project_id = ?'; params.push(project_id); }
    if (project_service_id) { where += ' AND dj.project_service_id = ?'; params.push(project_service_id); }
    if (client_id) { where += ' AND p.client_id = ?'; params.push(client_id); }
    if (date_from) { where += ' AND dj.journal_date >= ?'; params.push(date_from); }
    if (date_to) { where += ' AND dj.journal_date <= ?'; params.push(date_to); }
    if (health_status) { where += ' AND dj.health_status = ?'; params.push(health_status); }
    if (client_communication) { where += ' AND dj.client_communication = ?'; params.push(client_communication); }
    if (escalation_required) { where += ' AND dj.escalation_required = ?'; params.push(escalation_required); }

    const [rows] = await db.query(
      `${ENTRY_SELECT}
       WHERE ${where}
       ORDER BY dj.journal_date DESC, dj.submitted_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, (page - 1) * limit]
    );
    const [[countRow]] = await db.query(
      `SELECT COUNT(*) AS total
       FROM smm_daily_journal dj
       LEFT JOIN projects p ON p.id = dj.project_id
       WHERE ${where}`,
      params
    );

    const entries = rows.map(r => ({ ...parseEntry(r), ...rowRights(req, r) }));
    return res.json({ entries, total: Number(countRow.total) || 0, page, limit, access_level: level });
  } catch (err) {
    return sendError(res, err, 'list');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/daily-journal/my-services — Project ▸ Service options for the form
// (members: services they belong to; admin: every active service) + today's flags
// ─────────────────────────────────────────────────────────────────────────────
exports.myServices = async (req, res) => {
  try {
    const date = toDateStr(req.query.date) || todayIST();
    let rows;
    if (req.user.is_admin) {
      [rows] = await db.query(
        `SELECT ps.id AS project_service_id, ps.project_id, p.title AS project_title,
                l.business_name AS client_name, s.name AS service_name
         FROM project_services ps
         JOIN projects p      ON p.id = ps.project_id
         LEFT JOIN services s ON s.id = ps.service_id
         LEFT JOIN leads l    ON l.id = p.client_id
         WHERE p.deleted = 0 AND p.status = 'active' AND ${LIVE_SERVICE_SQL}
         ORDER BY p.title, s.name`
      );
    } else {
      [rows] = await db.query(
        `SELECT ps.id AS project_service_id, ps.project_id, p.title AS project_title,
                l.business_name AS client_name, s.name AS service_name
         FROM project_service_members psm
         JOIN project_services ps ON ps.id = psm.project_service_id
         JOIN projects p          ON p.id = ps.project_id
         LEFT JOIN services s     ON s.id = ps.service_id
         LEFT JOIN leads l        ON l.id = p.client_id
         WHERE psm.user_id = ? AND p.deleted = 0 AND p.status = 'active' AND ${LIVE_SERVICE_SQL}
         ORDER BY p.title, s.name`,
        [req.user.id]
      );
    }
    const done = await submittedKeys(date, [Number(req.user.id)]);
    const services = rows.map(r => ({ ...r, submitted: done.has(`${Number(req.user.id)}:${Number(r.project_service_id)}`) }));
    return res.json({ date, services });
  } catch (err) {
    return sendError(res, err, 'my-services');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/daily-journal/status?date= — stats + my pending; team list for All access
// ─────────────────────────────────────────────────────────────────────────────
exports.status = async (req, res) => {
  try {
    const date = toDateStr(req.query.date) || todayIST();
    const level = levelOf(req);
    const mine = req.user.is_admin
      ? { date, required: [], pending: [], submitted_count: 0 }
      : await userStatus(req.user.id, date);

    // Entry counts for the date (scoped like the list)
    const scope = level < 2 ? 'AND submitted_by = ?' : '';
    const [[counts]] = await db.query(
      `SELECT COUNT(*) AS submitted,
              SUM(health_status = 'critical') AS critical,
              SUM(health_status = 'attention_needed') AS attention,
              SUM(escalation_required = 'yes') AS escalations
       FROM smm_daily_journal WHERE journal_date = ? ${scope}`,
      level < 2 ? [date, req.user.id] : [date]
    );

    const result = {
      date,
      access_level: level,
      my: mine,
      stats: {
        submitted: Number(counts.submitted) || 0,
        critical: Number(counts.critical) || 0,
        attention: Number(counts.attention) || 0,
        escalations: Number(counts.escalations) || 0,
        required: mine.required.length,
        pending: mine.pending.length,
      },
      team: null,
    };

    if (level >= 2) {
      const req2 = await requiredServices(null);
      const done = await submittedKeys(date, null);
      const byUser = new Map();
      req2.forEach(r => {
        const key = Number(r.user_id);
        if (!byUser.has(key)) byUser.set(key, { user_id: key, name: r.user_name, required: 0, submitted: 0, pending: [] });
        const m = byUser.get(key);
        m.required += 1;
        if (done.has(`${key}:${Number(r.project_service_id)}`)) m.submitted += 1;
        else m.pending.push({ project_service_id: r.project_service_id, project_title: r.project_title, service_name: r.service_name });
      });
      const members = [...byUser.values()].sort((a, b) => b.pending.length - a.pending.length || String(a.name).localeCompare(String(b.name)));
      const requiredTotal = members.reduce((s, m) => s + m.required, 0);
      const pendingTotal = members.reduce((s, m) => s + m.pending.length, 0);
      result.team = {
        members,
        required_total: requiredTotal,
        pending_total: pendingTotal,
        members_pending: members.filter(m => m.pending.length > 0).length,
      };
      result.stats.required = requiredTotal;
      result.stats.pending = pendingTotal;
    }

    return res.json(result);
  } catch (err) {
    return sendError(res, err, 'status');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/daily-journal/filter-options — projects / services / clients / members
// that appear in entries the user can see (includes closed projects)
// ─────────────────────────────────────────────────────────────────────────────
exports.filterOptions = async (req, res) => {
  try {
    const level = levelOf(req);
    const scope = level < 2 ? 'WHERE dj.submitted_by = ?' : '';
    const params = level < 2 ? [req.user.id] : [];
    const [rows] = await db.query(
      `SELECT DISTINCT dj.project_id, p.title AS project_title,
              dj.project_service_id, s.name AS service_name,
              p.client_id, l.business_name AS client_name,
              dj.submitted_by, CONCAT(u.first_name, ' ', u.last_name) AS submitted_by_name
       FROM smm_daily_journal dj
       LEFT JOIN projects p          ON p.id = dj.project_id
       LEFT JOIN leads l             ON l.id = p.client_id
       LEFT JOIN project_services ps ON ps.id = dj.project_service_id
       LEFT JOIN services s          ON s.id = ps.service_id
       LEFT JOIN users u             ON u.id = dj.submitted_by
       ${scope}`,
      params
    );
    const uniq = (list, key) => {
      const m = new Map();
      list.forEach(x => { if (x[key] && !m.has(x[key])) m.set(x[key], x); });
      return [...m.values()];
    };
    const byName = (a, b) => String(a.name).localeCompare(String(b.name));
    return res.json({
      projects: uniq(rows, 'project_id').map(r => ({ id: r.project_id, name: r.project_title || `Project #${r.project_id}` })).sort(byName),
      services: uniq(rows, 'project_service_id').map(r => ({ id: r.project_service_id, project_id: r.project_id, name: r.service_name || 'Service' })).sort(byName),
      clients: uniq(rows, 'client_id').map(r => ({ id: r.client_id, name: r.client_name || `Client #${r.client_id}` })).sort(byName),
      members: level >= 2 ? uniq(rows, 'submitted_by').map(r => ({ id: r.submitted_by, name: r.submitted_by_name || `User #${r.submitted_by}` })).sort(byName) : [],
    });
  } catch (err) {
    return sendError(res, err, 'filter-options');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/daily-journal/:id
// ─────────────────────────────────────────────────────────────────────────────
exports.getOne = async (req, res) => {
  try {
    const entry = await fetchEntry(req.params.id);
    if (!entry) return res.status(404).json({ message: 'Entry not found' });
    if (levelOf(req) < 2 && Number(entry.submitted_by) !== Number(req.user.id)) {
      return res.status(403).json({ message: 'Access denied' });
    }
    return res.json({ ...entry, ...rowRights(req, entry) });
  } catch (err) {
    return sendError(res, err, 'getOne');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/daily-journal — one entry per project ▸ service ▸ date ▸ user
// ─────────────────────────────────────────────────────────────────────────────
exports.create = async (req, res) => {
  try {
    const { project_id, project_service_id } = req.body;
    const today = todayIST();
    const journalDate = toDateStr(req.body.journal_date) || today;

    // Non-admins submit for today only (IST)
    if (!req.user.is_admin && journalDate !== today) {
      return res.status(400).json({ message: "Daily Update can only be submitted for today's date" });
    }

    await resolveEntryService(req.user, project_id, project_service_id);
    const v = normaliseBody(req.body);

    const [dup] = await db.query(
      'SELECT id FROM smm_daily_journal WHERE project_service_id = ? AND journal_date = ? AND submitted_by = ? LIMIT 1',
      [project_service_id, journalDate, req.user.id]
    );
    if (dup.length) {
      return res.status(409).json({ message: 'You already submitted a Daily Update for this service today. Edit the existing entry instead.', existing_id: dup[0].id });
    }

    const [result] = await db.query(
      `INSERT INTO smm_daily_journal
        (project_id, project_service_id, journal_date, submitted_by, work_categories,
         client_communication, communication_summary, issues_delays, issues_details,
         leads_opportunities, tomorrow_priorities,
         escalation_required, escalation_details, health_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        project_id, project_service_id, journalDate, req.user.id, v.work_categories,
        v.client_communication, v.communication_summary, v.issues_delays, v.issues_details,
        v.leads_opportunities, v.tomorrow_priorities,
        v.escalation_required, v.escalation_details, v.health_status,
      ]
    );

    const entry = await fetchEntry(result.insertId);
    res.emitSocket('daily-journal:created', { id: result.insertId });
    return res.status(201).json({ ...entry, ...rowRights(req, entry) });
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'You already submitted a Daily Update for this service today. Edit the existing entry instead.' });
    }
    return sendError(res, err, 'create');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/daily-journal/:id — owner on the same day, or admin
// (project / service / date are fixed once submitted)
// ─────────────────────────────────────────────────────────────────────────────
exports.update = async (req, res) => {
  try {
    const [existing] = await db.query('SELECT * FROM smm_daily_journal WHERE id = ?', [req.params.id]);
    if (!existing.length) return res.status(404).json({ message: 'Entry not found' });
    if (!rowRights(req, existing[0]).can_edit) {
      return res.status(403).json({ message: 'You can only edit your own Daily Update on the same day' });
    }

    const v = normaliseBody(req.body);
    await db.query(
      `UPDATE smm_daily_journal SET
        work_categories = ?, client_communication = ?, communication_summary = ?,
        issues_delays = ?, issues_details = ?, leads_opportunities = ?,
        tomorrow_priorities = ?, escalation_required = ?, escalation_details = ?,
        health_status = ?
       WHERE id = ?`,
      [
        v.work_categories, v.client_communication, v.communication_summary,
        v.issues_delays, v.issues_details, v.leads_opportunities,
        v.tomorrow_priorities, v.escalation_required, v.escalation_details,
        v.health_status, req.params.id,
      ]
    );

    const entry = await fetchEntry(req.params.id);
    res.emitSocket('daily-journal:updated', { id: Number(req.params.id) });
    return res.json({ ...entry, ...rowRights(req, entry) });
  } catch (err) {
    return sendError(res, err, 'update');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/daily-journal/:id — owner on the same day, or admin
// ─────────────────────────────────────────────────────────────────────────────
exports.remove = async (req, res) => {
  try {
    const [existing] = await db.query('SELECT * FROM smm_daily_journal WHERE id = ?', [req.params.id]);
    if (!existing.length) return res.status(404).json({ message: 'Entry not found' });
    if (!rowRights(req, existing[0]).can_delete) {
      return res.status(403).json({ message: 'You can only delete your own Daily Update on the same day' });
    }

    await db.query('DELETE FROM smm_daily_journal WHERE id = ?', [req.params.id]);
    res.emitSocket('daily-journal:deleted', { id: Number(req.params.id) });
    return res.json({ message: 'Entry deleted' });
  } catch (err) {
    return sendError(res, err, 'delete');
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/daily-journal/report/productivity
// Daily PRODUCTIVITY report for SM Ops members: per-member, per selected date
// (or date range) — tasks / tickets / shoots worked + daily update summary.
// Admin / SMM lead (socialAccessLevel >= 2) only.
// Query: date_from, date_to (default: today IST)
// ─────────────────────────────────────────────────────────────────────────────
exports.productivityReport = async (req, res) => {
  try {
    if (!req.user.is_admin && (!req.socialAccessLevel || req.socialAccessLevel < 2)) {
      return res.status(403).json({ message: 'Only admin or SMM leads can view the team productivity report' });
    }

    const today = todayIST();
    const dateFrom = toDateStr(req.query.date_from) || today;
    const dateTo = toDateStr(req.query.date_to) || dateFrom;
    if (dateFrom > dateTo) {
      return res.status(400).json({ message: 'The start date must be on or before the end date' });
    }
    const dayList = listDays(dateFrom, dateTo);
    if (dayList.length > REPORT_MAX_DAYS) {
      return res.status(400).json({ message: `Please choose a range of ${REPORT_MAX_DAYS} days or less` });
    }

    // ── Members: SM Ops roles with any submenu access, anyone required to submit a
    // Daily Update, and anyone who submitted one in the range (covers user overrides).
    const memberSet = new Set();
    try {
      const [rows] = await db.query(
        `SELECT DISTINCT u.id
         FROM users u
         JOIN role_submenu_permissions rsp
           ON rsp.role_id = u.role_id AND rsp.module = 'creative_hub' AND rsp.can_access >= 1
         WHERE u.is_active = 1 AND u.deleted = 0 AND u.is_admin = 0`
      );
      rows.forEach(r => memberSet.add(Number(r.id)));
    } catch (e) { /* table may not exist */ }

    if (memberSet.size === 0) {
      try {
        const [rows] = await db.query(
          `SELECT DISTINCT u.id
           FROM users u
           JOIN role_social_permissions rsp ON rsp.role_id = u.role_id
           WHERE u.is_active = 1 AND u.deleted = 0 AND u.is_admin = 0
             AND (rsp.social_overview >= 1 OR rsp.content_calendar >= 1 OR rsp.content_writing >= 1
                  OR rsp.shoot_planning >= 1 OR rsp.ads_planning >= 1 OR rsp.daily_journal >= 1 OR rsp.report_centre >= 1)`
        );
        rows.forEach(r => memberSet.add(Number(r.id)));
      } catch (e) { /* ignore */ }
    }

    const warnings = [];

    // Required Project > Service rows (same rule as the Daily Update page)
    let required = [];
    try {
      required = await requiredServices(null);
      required.forEach(r => memberSet.add(Number(r.user_id)));
    } catch (e) { warnings.push('Could not load required daily updates'); }

    // ═══ SECTION A: Daily Update entries in the range ═══
    let journals = [];
    try {
      const [jrows] = await db.query(
        `SELECT dj.id, dj.project_id, dj.project_service_id, dj.journal_date, dj.submitted_by,
                dj.work_categories, dj.client_communication, dj.communication_summary,
                dj.issues_delays, dj.issues_details, dj.leads_opportunities,
                dj.tomorrow_priorities, dj.escalation_required, dj.escalation_details,
                dj.health_status,
                p.title AS project_title, l.business_name AS client_name,
                s.name AS service_name,
                CONCAT(u.first_name, ' ', u.last_name) AS submitted_by_name
         FROM smm_daily_journal dj
         LEFT JOIN projects p          ON p.id = dj.project_id
         LEFT JOIN leads l             ON l.id = p.client_id
         LEFT JOIN project_services ps ON ps.id = dj.project_service_id
         LEFT JOIN services s          ON s.id = ps.service_id
         LEFT JOIN users u             ON u.id = dj.submitted_by
         WHERE dj.journal_date BETWEEN ? AND ?
         ORDER BY dj.journal_date DESC, dj.submitted_at DESC`,
        [dateFrom, dateTo]
      );
      journals = jrows.map(j => ({
        ...j,
        journal_date: toDateStr(j.journal_date) || j.journal_date,
        work_categories: parseJson(j.work_categories, null),
        issues_delays: parseJson(j.issues_delays, []),
        tomorrow_priorities: parseJson(j.tomorrow_priorities, []),
      }));
      journals.forEach(j => memberSet.add(Number(j.submitted_by)));
    } catch (e) {
      console.warn('Daily report journals warning:', e.message);
      warnings.push('Daily Update entries could not be loaded');
    }

    const memberIds = Array.from(memberSet).filter(Boolean);
    if (memberIds.length === 0) {
      return res.json({
        date_from: dateFrom, date_to: dateTo, days: dayList, journals: [], members: [],
        summary: emptyReportSummary(), warnings,
      });
    }

    // ═══ SECTION B: logged time per member / item / day ═══
    // Aggregated in seconds. Tasks and shoots use started_at; tickets use log_date.
    const timeRows = []; // { user_id, kind, id, title, code, status, day, secs }
    const loadTime = async (label, sql, params, mapRow) => {
      try {
        const [rows] = await db.query(sql, params);
        rows.forEach(r => timeRows.push(mapRow(r)));
        return true;
      } catch (e) {
        console.warn(`Daily report ${label} warning:`, e.message);
        return false;
      }
    };

    const okTasks = await loadTime('tasks',
      `SELECT tl.user_id, DATE(tl.started_at) AS day, t.id, t.title, t.task_id_code, t.status,
              SUM(tl.duration) AS secs
       FROM task_time_logs tl
       JOIN tasks t ON t.id = tl.task_id
       WHERE tl.user_id IN (?) AND DATE(tl.started_at) BETWEEN ? AND ?
       GROUP BY tl.user_id, DATE(tl.started_at), t.id, t.title, t.task_id_code, t.status`,
      [memberIds, dateFrom, dateTo],
      r => ({ user_id: Number(r.user_id), kind: 'task', id: r.id, title: r.title, code: r.task_id_code, status: r.status, day: toDateStr(r.day), secs: Number(r.secs) || 0 }));
    if (!okTasks) warnings.push('Task time could not be loaded');

    const ticketSql = (secExpr) =>
      `SELECT tl.user_id, tl.log_date AS day, tk.id, tk.title, tk.status, SUM(${secExpr}) AS secs
       FROM ticket_time_logs tl
       JOIN tickets tk ON tk.id = tl.ticket_id
       WHERE tl.user_id IN (?) AND tl.log_date BETWEEN ? AND ? AND tk.deleted = 0
       GROUP BY tl.user_id, tl.log_date, tk.id, tk.title, tk.status`;
    const mapTicket = r => ({ user_id: Number(r.user_id), kind: 'ticket', id: r.id, title: r.title, status: r.status, day: toDateStr(r.day), secs: Number(r.secs) || 0 });
    let okTickets = await loadTime('tickets', ticketSql('COALESCE(NULLIF(tl.duration, 0), tl.minutes * 60)'), [memberIds, dateFrom, dateTo], mapTicket);
    if (!okTickets) okTickets = await loadTime('tickets (minutes)', ticketSql('tl.minutes * 60'), [memberIds, dateFrom, dateTo], mapTicket);
    if (!okTickets) warnings.push('Ticket time could not be loaded');

    const okShoots = await loadTime('shoots',
      `SELECT sl.user_id, DATE(sl.started_at) AS day, s.id, s.shoot_id_code, s.project_campaign_name, s.status,
              SUM(sl.duration) AS secs
       FROM shoot_time_logs sl
       JOIN shoots s ON s.id = sl.shoot_id
       WHERE sl.user_id IN (?) AND DATE(sl.started_at) BETWEEN ? AND ? AND s.deleted = 0
       GROUP BY sl.user_id, DATE(sl.started_at), s.id, s.shoot_id_code, s.project_campaign_name, s.status`,
      [memberIds, dateFrom, dateTo],
      r => ({ user_id: Number(r.user_id), kind: 'shoot', id: r.id, title: r.project_campaign_name, code: r.shoot_id_code, status: r.status, day: toDateStr(r.day), secs: Number(r.secs) || 0 }));
    if (!okShoots) warnings.push('Shoot time could not be loaded');

    const [users] = await db.query(
      `SELECT id, CONCAT(first_name, ' ', last_name) AS name, department, designation, avatar_url
       FROM users WHERE id IN (?) ORDER BY first_name`,
      [memberIds]
    );

    // ── Working days: today, plus any day that has an update or logged time (so
    // Sundays / holidays with no activity do not show everyone as "pending").
    const activeDays = new Set();
    if (dayList.includes(today)) activeDays.add(today);
    journals.forEach(j => activeDays.add(j.journal_date));
    timeRows.forEach(r => { if (r.day) activeDays.add(r.day); });
    const dueDays = dayList.filter(d => d <= today && activeDays.has(d));

    // ── Pending Daily Updates: required service x due day with no entry
    const submittedKey = new Set(journals.map(j => `${j.journal_date}:${Number(j.submitted_by)}:${Number(j.project_service_id)}`));
    const requiredByUser = new Map();
    required.forEach(r => {
      const k = Number(r.user_id);
      if (!requiredByUser.has(k)) requiredByUser.set(k, []);
      requiredByUser.get(k).push(r);
    });

    const journalsByUser = new Map();
    journals.forEach(j => {
      const k = Number(j.submitted_by);
      journalsByUser.set(k, (journalsByUser.get(k) || 0) + 1);
    });

    const members = [];
    for (const u of users) {
      const uid = Number(u.id);
      const mine = timeRows.filter(r => r.user_id === uid);

      const items = { task: new Map(), ticket: new Map(), shoot: new Map() };
      const perDay = new Map();
      const secs = { task: 0, ticket: 0, shoot: 0 };
      mine.forEach(r => {
        secs[r.kind] += r.secs;
        const m = items[r.kind];
        const cur = m.get(r.id) || { id: r.id, title: r.title, code: r.code, status: r.status, seconds: 0 };
        cur.seconds += r.secs;
        m.set(r.id, cur);
        if (r.day) perDay.set(r.day, (perDay.get(r.day) || 0) + r.secs);
      });
      const sortItems = (m) => Array.from(m.values()).sort((a, b) => b.seconds - a.seconds);
      const tasks = sortItems(items.task);
      const tickets = sortItems(items.ticket);
      const shoots = sortItems(items.shoot);

      const reqRows = requiredByUser.get(uid) || [];
      const pending = [];
      let requiredCount = 0;
      dueDays.forEach(day => {
        reqRows.forEach(r => {
          requiredCount += 1;
          if (!submittedKey.has(`${day}:${uid}:${Number(r.project_service_id)}`)) {
            pending.push({
              date: day,
              project_service_id: r.project_service_id,
              project_id: r.project_id,
              project_title: r.project_title,
              service_name: r.service_name,
            });
          }
        });
      });

      const journalCount = journalsByUser.get(uid) || 0;
      const totalSecs = secs.task + secs.ticket + secs.shoot;
      // Show anyone with activity, an update, or something pending
      if (!totalSecs && !tasks.length && !tickets.length && !shoots.length && !journalCount && !pending.length) continue;

      members.push({
        user_id: uid,
        name: u.name,
        designation: u.designation,
        avatar_url: u.avatar_url,
        journal_submitted: journalCount > 0,
        journal_count: journalCount,
        required_count: requiredCount,
        submitted_count: requiredCount - pending.length,
        pending,
        seconds: { ...secs, total: totalSecs },
        by_day: Array.from(perDay.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, seconds]) => ({ date, seconds })),
        tasks, tickets, shoots,
        task_count: tasks.length,
        ticket_count: tickets.length,
        shoot_count: shoots.length,
      });
    }
    // Most pending first, then most time logged
    members.sort((a, b) => (b.pending.length - a.pending.length) || (b.seconds.total - a.seconds.total) || String(a.name).localeCompare(String(b.name)));

    const sum = (fn) => members.reduce((s, m) => s + fn(m), 0);
    const summary = {
      journal_count: journals.length,
      member_count: members.length,
      required_total: sum(m => m.required_count),
      submitted_total: sum(m => m.submitted_count),
      pending_total: sum(m => m.pending.length),
      members_pending: members.filter(m => m.pending.length > 0).length,
      tasks_total: sum(m => m.task_count),
      tickets_total: sum(m => m.ticket_count),
      shoots_total: sum(m => m.shoot_count),
      seconds_total: sum(m => m.seconds.total),
      seconds_task: sum(m => m.seconds.task),
      seconds_ticket: sum(m => m.seconds.ticket),
      seconds_shoot: sum(m => m.seconds.shoot),
      escalations_total: journals.filter(j => j.escalation_required === 'yes').length,
      critical_count: journals.filter(j => j.health_status === 'critical').length,
      attention_count: journals.filter(j => j.health_status === 'attention_needed').length,
      on_track_count: journals.filter(j => j.health_status === 'on_track').length,
    };

    return res.json({
      date_from: dateFrom, date_to: dateTo, days: dayList, due_days: dueDays,
      journals, members, summary, warnings,
    });
  } catch (err) {
    console.error('Daily report error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

const REPORT_MAX_DAYS = 31;

/** Inclusive list of YYYY-MM-DD strings between two dates. */
function listDays(from, to) {
  const out = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || Number.isNaN(end.getTime())) return out;
  while (d <= end && out.length <= REPORT_MAX_DAYS + 1) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function emptyReportSummary() {
  return {
    journal_count: 0, member_count: 0, required_total: 0, submitted_total: 0, pending_total: 0,
    members_pending: 0, tasks_total: 0, tickets_total: 0, shoots_total: 0,
    seconds_total: 0, seconds_task: 0, seconds_ticket: 0, seconds_shoot: 0,
    escalations_total: 0, critical_count: 0, attention_count: 0, on_track_count: 0,
  };
}
