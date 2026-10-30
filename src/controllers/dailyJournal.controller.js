const db = require('../config/db');
const { getExpectedHoursForRange } = require('./workSchedule.controller');

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/daily-journal — list journal entries (with filters)
// ─────────────────────────────────────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    const { project_id, user_id, client_id, date_from, date_to, health_status, client_communication, escalation_required, page = 1, limit = 20 } = req.query;
    let where = '1=1';
    const params = [];

    if (project_id) { where += ' AND dj.project_id = ?'; params.push(project_id); }
    if (user_id) { where += ' AND dj.submitted_by = ?'; params.push(user_id); }
    if (client_id) { where += ' AND p.client_id = ?'; params.push(client_id); }
    if (date_from) { where += ' AND dj.journal_date >= ?'; params.push(date_from); }
    if (date_to) { where += ' AND dj.journal_date <= ?'; params.push(date_to); }
    if (health_status) { where += ' AND dj.health_status = ?'; params.push(health_status); }
    if (client_communication) { where += ' AND dj.client_communication = ?'; params.push(client_communication); }
    if (escalation_required) { where += ' AND dj.escalation_required = ?'; params.push(escalation_required); }

    // Non-admin: only see their own entries or entries for projects they are members of
    if (!req.user.is_admin) {
      where += ' AND (dj.submitted_by = ? OR pm.user_id IS NOT NULL)';
      params.push(req.user.id);
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const [rows] = await db.query(
      `SELECT dj.*,
              p.title AS project_title,
              l.business_name AS client_name,
              CONCAT(u.first_name, ' ', u.last_name) AS submitted_by_name
       FROM smm_daily_journal dj
       LEFT JOIN projects p ON p.id = dj.project_id
       LEFT JOIN leads l ON l.id = p.client_id
       LEFT JOIN users u ON u.id = dj.submitted_by
       ${!req.user.is_admin ? 'LEFT JOIN project_members pm ON pm.project_id = dj.project_id AND pm.user_id = ' + req.user.id : ''}
       WHERE ${where}
       ORDER BY dj.journal_date DESC, dj.submitted_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    // Get total count
    const [countResult] = await db.query(
      `SELECT COUNT(*) AS total
       FROM smm_daily_journal dj
       LEFT JOIN projects p ON p.id = dj.project_id
       ${!req.user.is_admin ? 'LEFT JOIN project_members pm ON pm.project_id = dj.project_id AND pm.user_id = ' + req.user.id : ''}
       WHERE ${where}`,
      params
    );

    // Parse JSON fields
    rows.forEach(row => {
      if (row.work_categories && typeof row.work_categories === 'string') {
        row.work_categories = JSON.parse(row.work_categories);
      }
      if (row.activities_completed && typeof row.activities_completed === 'string') {
        row.activities_completed = JSON.parse(row.activities_completed);
      }
      if (row.issues_delays && typeof row.issues_delays === 'string') {
        row.issues_delays = JSON.parse(row.issues_delays);
      }
      if (row.tomorrow_priorities && typeof row.tomorrow_priorities === 'string') {
        row.tomorrow_priorities = JSON.parse(row.tomorrow_priorities);
      }
    });

    return res.json({
      entries: rows,
      total: countResult[0].total,
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err) {
    console.error('Daily journal list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/daily-journal/:id — get single entry
// ─────────────────────────────────────────────────────────────────────────────
exports.getOne = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT dj.*,
              p.title AS project_title,
              l.business_name AS client_name,
              CONCAT(u.first_name, ' ', u.last_name) AS submitted_by_name
       FROM smm_daily_journal dj
       LEFT JOIN projects p ON p.id = dj.project_id
       LEFT JOIN leads l ON l.id = p.client_id
       LEFT JOIN users u ON u.id = dj.submitted_by
       WHERE dj.id = ?`,
      [req.params.id]
    );

    if (rows.length === 0) return res.status(404).json({ message: 'Entry not found' });

    const entry = rows[0];
    if (entry.work_categories && typeof entry.work_categories === 'string') {
      entry.work_categories = JSON.parse(entry.work_categories);
    }
    if (entry.activities_completed && typeof entry.activities_completed === 'string') {
      entry.activities_completed = JSON.parse(entry.activities_completed);
    }
    if (entry.issues_delays && typeof entry.issues_delays === 'string') {
      entry.issues_delays = JSON.parse(entry.issues_delays);
    }
    if (entry.tomorrow_priorities && typeof entry.tomorrow_priorities === 'string') {
      entry.tomorrow_priorities = JSON.parse(entry.tomorrow_priorities);
    }

    return res.json(entry);
  } catch (err) {
    console.error('Daily journal getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/daily-journal — create new journal entry
// ─────────────────────────────────────────────────────────────────────────────
exports.create = async (req, res) => {
  try {
    const {
      project_id,
      journal_date,
      work_categories,
      client_communication,
      communication_summary,
      issues_delays,
      issues_details,
      leads_opportunities,
      tomorrow_priorities,
      escalation_required,
      escalation_details,
      health_status,
    } = req.body;

    if (!project_id || !journal_date) {
      return res.status(400).json({ message: 'Project and date are required' });
    }

    // Disallow past dates for daily journal entries (non-admins)
    if (!req.user.is_admin) {
      const [dateCheck] = await db.query('SELECT ? < CURDATE() AS is_past', [journal_date]);
      if (dateCheck[0]?.is_past) {
        return res.status(400).json({ message: 'Cannot submit a Daily Update for past dates.' });
      }
    }

    // Check project exists
    const [project] = await db.query(
      'SELECT id FROM projects WHERE id = ? AND deleted = 0',
      [project_id]
    );
    if (project.length === 0) {
      return res.status(404).json({ message: 'Project not found' });
    }

    const [result] = await db.query(
      `INSERT INTO smm_daily_journal
        (project_id, journal_date, submitted_by, work_categories,
         client_communication, communication_summary, issues_delays, issues_details,
         leads_opportunities, tomorrow_priorities,
         escalation_required, escalation_details, health_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        project_id,
        journal_date,
        req.user.id,
        work_categories ? JSON.stringify(work_categories) : null,
        client_communication || 'no',
        communication_summary || null,
        issues_delays ? JSON.stringify(issues_delays) : null,
        issues_details || null,
        leads_opportunities || null,
        tomorrow_priorities ? JSON.stringify(tomorrow_priorities) : null,
        escalation_required || 'no',
        escalation_details || null,
        health_status || 'on_track',
      ]
    );

    const [entry] = await db.query('SELECT * FROM smm_daily_journal WHERE id = ?', [result.insertId]);
    res.emitSocket('daily-journal:created', entry[0]);
    return res.status(201).json(entry[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'A journal entry already exists for this project, date, and user. Please edit the existing entry.' });
    }
    console.error('Daily journal create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/daily-journal/:id — update journal entry
// ─────────────────────────────────────────────────────────────────────────────
exports.update = async (req, res) => {
  try {
    const [existing] = await db.query('SELECT * FROM smm_daily_journal WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ message: 'Entry not found' });

    // Only the submitter or admin can edit
    if (!req.user.is_admin && existing[0].submitted_by !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const {
      work_categories,
      client_communication,
      communication_summary,
      issues_delays,
      issues_details,
      leads_opportunities,
      tomorrow_priorities,
      escalation_required,
      escalation_details,
      health_status,
    } = req.body;

    await db.query(
      `UPDATE smm_daily_journal SET
        work_categories = ?,
        client_communication = ?,
        communication_summary = ?,
        issues_delays = ?,
        issues_details = ?,
        leads_opportunities = ?,
        tomorrow_priorities = ?,
        escalation_required = ?,
        escalation_details = ?,
        health_status = ?
       WHERE id = ?`,
      [
        work_categories ? JSON.stringify(work_categories) : null,
        client_communication || 'no',
        communication_summary || null,
        issues_delays ? JSON.stringify(issues_delays) : null,
        issues_details || null,
        leads_opportunities || null,
        tomorrow_priorities ? JSON.stringify(tomorrow_priorities) : null,
        escalation_required || 'no',
        escalation_details || null,
        health_status || 'on_track',
        req.params.id,
      ]
    );

    const [updated] = await db.query('SELECT * FROM smm_daily_journal WHERE id = ?', [req.params.id]);
    res.emitSocket('daily-journal:updated', updated[0]);
    return res.json(updated[0]);
  } catch (err) {
    console.error('Daily journal update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/daily-journal/:id — delete journal entry
// ─────────────────────────────────────────────────────────────────────────────
exports.remove = async (req, res) => {
  try {
    const [existing] = await db.query('SELECT * FROM smm_daily_journal WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ message: 'Entry not found' });

    if (!req.user.is_admin && existing[0].submitted_by !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    await db.query('DELETE FROM smm_daily_journal WHERE id = ?', [req.params.id]);
    res.emitSocket('daily-journal:deleted', { id: parseInt(req.params.id) });
    return res.json({ message: 'Entry deleted' });
  } catch (err) {
    console.error('Daily journal delete error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/daily-journal/report/productivity
// Daily PRODUCTIVITY report for SM Ops members: per-member, per selected date
// (or date range) — productive time (task+ticket+meeting+shoot logs), expected
// target hours, whether their daily update was submitted, health, escalations.
// Admin / SMM lead (socialAccessLevel >= 2) only.
// Query: date_from, date_to (default: today), project_id (optional)
// ─────────────────────────────────────────────────────────────────────────────
exports.productivityReport = async (req, res) => {
  try {
    // Only admin or SMM lead (full access) can see the team productivity report
    if (!req.user.is_admin && (!req.socialAccessLevel || req.socialAccessLevel < 2)) {
      return res.status(403).json({ message: 'Only admin or SMM leads can view the team productivity report' });
    }

    const today = new Date().toISOString().split('T')[0];
    const dateFrom = req.query.date_from || today;
    const dateTo = req.query.date_to || dateFrom;

    // ── Resolve SM Ops members: active non-admin users whose role grants any
    // creative_hub submenu access (role_submenu_permissions) OR legacy
    // role_social_permissions. Falls back gracefully if a table is missing.
    let memberIds = [];
    try {
      const [rows] = await db.query(
        `SELECT DISTINCT u.id
         FROM users u
         JOIN role_submenu_permissions rsp
           ON rsp.role_id = u.role_id AND rsp.module = 'creative_hub' AND rsp.can_access >= 1
         WHERE u.is_active = 1 AND u.deleted = 0 AND u.is_admin = 0`
      );
      memberIds = rows.map(r => r.id);
    } catch (e) { /* table may not exist */ }

    if (memberIds.length === 0) {
      try {
        const [rows] = await db.query(
          `SELECT DISTINCT u.id
           FROM users u
           JOIN role_social_permissions rsp ON rsp.role_id = u.role_id
           WHERE u.is_active = 1 AND u.deleted = 0 AND u.is_admin = 0
             AND (rsp.social_overview >= 1 OR rsp.content_calendar >= 1 OR rsp.content_writing >= 1
                  OR rsp.shoot_planning >= 1 OR rsp.ads_planning >= 1 OR rsp.daily_journal >= 1 OR rsp.report_centre >= 1)`
        );
        memberIds = rows.map(r => r.id);
      } catch (e) { /* ignore */ }
    }

    // Also include anyone who submitted a journal in the range (covers user-level overrides)
    try {
      const [extra] = await db.query(
        `SELECT DISTINCT submitted_by AS id FROM smm_daily_journal
         WHERE journal_date BETWEEN ? AND ?`,
        [dateFrom, dateTo]
      );
      const set = new Set(memberIds);
      extra.forEach(r => set.add(r.id));
      memberIds = Array.from(set);
    } catch (e) { /* ignore */ }

    if (memberIds.length === 0) {
      return res.json({ date_from: dateFrom, date_to: dateTo, journals: [], members: [], summary: emptyReportSummary() });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // SECTION A — Daily Update summary (what the update-users submitted)
    // ═══════════════════════════════════════════════════════════════════════
    let journals = [];
    try {
      const [jrows] = await db.query(
        `SELECT dj.id, dj.project_id, dj.journal_date, dj.submitted_by,
                dj.work_categories, dj.client_communication, dj.communication_summary,
                dj.issues_delays, dj.issues_details, dj.leads_opportunities,
                dj.tomorrow_priorities, dj.escalation_required, dj.escalation_details,
                dj.health_status,
                p.title AS project_title, l.business_name AS client_name,
                CONCAT(u.first_name, ' ', u.last_name) AS submitted_by_name
         FROM smm_daily_journal dj
         LEFT JOIN projects p ON p.id = dj.project_id
         LEFT JOIN leads l ON l.id = p.client_id
         LEFT JOIN users u ON u.id = dj.submitted_by
         WHERE dj.journal_date BETWEEN ? AND ?
         ORDER BY dj.journal_date DESC, dj.submitted_at DESC`,
        [dateFrom, dateTo]
      );
      const parseJson = (v) => { if (!v) return null; try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return null; } };
      journals = jrows.map(j => ({
        ...j,
        work_categories: parseJson(j.work_categories),
        issues_delays: parseJson(j.issues_delays),
        tomorrow_priorities: parseJson(j.tomorrow_priorities),
      }));
    } catch (e) { console.warn('Daily report journals warning:', e.message); }

    // ═══════════════════════════════════════════════════════════════════════
    // SECTION B — Team activity: tasks / tickets / shoots each member WORKED ON
    // that date (defined as "logged time on that day").
    // ═══════════════════════════════════════════════════════════════════════

    // Member profiles
    const [users] = await db.query(
      `SELECT id, CONCAT(first_name, ' ', last_name) AS name, department, designation, avatar_url
       FROM users WHERE id IN (?) ORDER BY first_name`,
      [memberIds]
    );

    // Tasks worked (distinct tasks a member logged time on in range)
    const tasksByUser = {};
    try {
      const [rows] = await db.query(
        `SELECT DISTINCT tl.user_id, t.id, t.title, t.task_id_code, t.status
         FROM task_time_logs tl
         JOIN tasks t ON t.id = tl.task_id
         WHERE tl.user_id IN (?) AND DATE(tl.started_at) BETWEEN ? AND ?
         ORDER BY t.id DESC`,
        [memberIds, dateFrom, dateTo]
      );
      rows.forEach(r => { (tasksByUser[r.user_id] = tasksByUser[r.user_id] || []).push({ id: r.id, title: r.title, code: r.task_id_code, status: r.status }); });
    } catch (e) { console.warn('Daily report tasks warning:', e.message); }

    // Tickets worked (ticket_time_logs uses log_date + minutes)
    const ticketsByUser = {};
    try {
      const [rows] = await db.query(
        `SELECT DISTINCT tl.user_id, tk.id, tk.title, tk.status
         FROM ticket_time_logs tl
         JOIN tickets tk ON tk.id = tl.ticket_id
         WHERE tl.user_id IN (?) AND tl.log_date BETWEEN ? AND ? AND tk.deleted = 0
         ORDER BY tk.id DESC`,
        [memberIds, dateFrom, dateTo]
      );
      rows.forEach(r => { (ticketsByUser[r.user_id] = ticketsByUser[r.user_id] || []).push({ id: r.id, title: r.title, status: r.status }); });
    } catch (e) { console.warn('Daily report tickets warning:', e.message); }

    // Shoots worked (shoot_time_logs = punches)
    const shootsByUser = {};
    try {
      const [rows] = await db.query(
        `SELECT DISTINCT sl.user_id, s.id, s.shoot_id_code, s.project_campaign_name, s.status
         FROM shoot_time_logs sl
         JOIN shoots s ON s.id = sl.shoot_id
         WHERE sl.user_id IN (?) AND DATE(sl.started_at) BETWEEN ? AND ? AND s.deleted = 0
         ORDER BY s.id DESC`,
        [memberIds, dateFrom, dateTo]
      );
      rows.forEach(r => { (shootsByUser[r.user_id] = shootsByUser[r.user_id] || []).push({ id: r.id, code: r.shoot_id_code, title: r.project_campaign_name, status: r.status }); });
    } catch (e) { console.warn('Daily report shoots warning:', e.message); }

    // Did each member submit a journal in the range?
    const submittedSet = new Set(journals.map(j => j.submitted_by));

    // Build member rows — only members who have activity OR submitted an update
    const members = [];
    for (const u of users) {
      const tasks = tasksByUser[u.id] || [];
      const tickets = ticketsByUser[u.id] || [];
      const shoots = shootsByUser[u.id] || [];
      const submitted = submittedSet.has(u.id);
      if (tasks.length === 0 && tickets.length === 0 && shoots.length === 0 && !submitted) continue;
      members.push({
        user_id: u.id,
        name: u.name,
        designation: u.designation,
        avatar_url: u.avatar_url,
        journal_submitted: submitted,
        tasks,
        tickets,
        shoots,
        task_count: tasks.length,
        ticket_count: tickets.length,
        shoot_count: shoots.length,
      });
    }
    // Most active first
    members.sort((a, b) => (b.task_count + b.ticket_count + b.shoot_count) - (a.task_count + a.ticket_count + a.shoot_count));

    const summary = {
      journal_count: journals.length,
      member_count: members.length,
      tasks_total: members.reduce((s, m) => s + m.task_count, 0),
      tickets_total: members.reduce((s, m) => s + m.ticket_count, 0),
      shoots_total: members.reduce((s, m) => s + m.shoot_count, 0),
      escalations_total: journals.filter(j => j.escalation_required === 'yes').length,
      critical_count: journals.filter(j => j.health_status === 'critical').length,
    };

    return res.json({ date_from: dateFrom, date_to: dateTo, journals, members, summary });
  } catch (err) {
    console.error('Daily report error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

function emptyReportSummary() {
  return {
    journal_count: 0, member_count: 0, tasks_total: 0, tickets_total: 0,
    shoots_total: 0, escalations_total: 0, critical_count: 0,
  };
}
