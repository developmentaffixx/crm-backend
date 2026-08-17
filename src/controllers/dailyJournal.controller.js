const db = require('../config/db');

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/daily-journal — list journal entries (with filters)
// ─────────────────────────────────────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    const { project_id, user_id, date_from, date_to, health_status, page = 1, limit = 20 } = req.query;
    let where = '1=1';
    const params = [];

    if (project_id) { where += ' AND dj.project_id = ?'; params.push(project_id); }
    if (user_id) { where += ' AND dj.submitted_by = ?'; params.push(user_id); }
    if (date_from) { where += ' AND dj.journal_date >= ?'; params.push(date_from); }
    if (date_to) { where += ' AND dj.journal_date <= ?'; params.push(date_to); }
    if (health_status) { where += ' AND dj.health_status = ?'; params.push(health_status); }

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
