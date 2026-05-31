const { validationResult } = require('express-validator');
const db = require('../config/db');

// ─── Helper: fetch daily targets from DB ─────────────────────────────────────
async function getDailyTargetsFromDB() {
  const [rows] = await db.query('SELECT * FROM daily_targets_settings WHERE id = 1');
  if (rows.length === 0) {
    // Fallback defaults
    return {
      leads_sourced: { min: 40, max: 60 },
      total_outreach: { min: 40, max: 60 },
      follow_ups_done: { min: 20, max: 40 },
      calls_done: { min: 5, max: 10 },
      meetings_booked: { min: 3, max: 5 },
    };
  }
  const s = rows[0];
  return {
    leads_sourced: { min: s.leads_sourced_min, max: s.leads_sourced_max },
    total_outreach: { min: s.total_outreach_min, max: s.total_outreach_max },
    follow_ups_done: { min: s.follow_ups_min, max: s.follow_ups_max },
    calls_done: { min: s.calls_min, max: s.calls_max },
    meetings_booked: { min: s.meetings_booked_min, max: s.meetings_booked_max },
  };
}

/**
 * GET /api/daily-reports/targets
 * Returns the daily targets from settings
 */
exports.getTargets = async (req, res) => {
  try {
    const targets = await getDailyTargetsFromDB();
    return res.json(targets);
  } catch (err) {
    console.error('getTargets error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/daily-reports
 * List daily reports with filters: user_id, date_from, date_to, page, limit
 */
exports.list = async (req, res) => {
  try {
    const { user_id, date_from, date_to, page = 1, limit = 20 } = req.query;
    let where = '1=1';
    const params = [];

    // Non-admin can only see their own reports
    if (!req.user.is_admin) {
      where += ' AND dr.user_id = ?';
      params.push(req.user.id);
    } else if (user_id) {
      where += ' AND dr.user_id = ?';
      params.push(user_id);
    }

    if (date_from) { where += ' AND dr.report_date >= ?'; params.push(date_from); }
    if (date_to)   { where += ' AND dr.report_date <= ?'; params.push(date_to); }

    // Count
    const [countResult] = await db.query(
      `SELECT COUNT(*) AS total FROM daily_reports dr WHERE ${where}`, params
    );
    const total = countResult[0].total;

    // Pagination
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const [rows] = await db.query(
      `SELECT dr.*, 
              CONCAT(u.first_name, ' ', u.last_name) AS user_name,
              (dr.instagram_outreach + dr.whatsapp_outreach + dr.email_outreach + dr.linkedin_outreach) AS total_outreach
       FROM daily_reports dr
       LEFT JOIN users u ON u.id = dr.user_id
       WHERE ${where}
       ORDER BY dr.report_date DESC, dr.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    // Calculate performance status for each row
    const DAILY_TARGETS = await getDailyTargetsFromDB();
    const reports = rows.map(row => {
      const totalOutreach = row.total_outreach;
      const scores = [];

      // Calculate percentage for each KPI
      if (DAILY_TARGETS.leads_sourced.max > 0) {
        scores.push(row.leads_sourced / DAILY_TARGETS.leads_sourced.min * 100);
      }
      if (DAILY_TARGETS.total_outreach.max > 0) {
        scores.push(totalOutreach / DAILY_TARGETS.total_outreach.min * 100);
      }
      if (DAILY_TARGETS.follow_ups_done.max > 0) {
        scores.push(row.follow_ups_done / DAILY_TARGETS.follow_ups_done.min * 100);
      }
      if (DAILY_TARGETS.calls_done.max > 0) {
        scores.push(row.calls_done / DAILY_TARGETS.calls_done.min * 100);
      }
      if (DAILY_TARGETS.meetings_booked.max > 0) {
        scores.push(row.meetings_booked / DAILY_TARGETS.meetings_booked.min * 100);
      }

      const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
      let status = 'red';
      if (avgScore >= 80) status = 'green';
      else if (avgScore >= 50) status = 'yellow';

      return { ...row, performance_score: Math.round(avgScore), performance_status: status };
    });

    return res.json({
      reports,
      pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (err) {
    console.error('DailyReports list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/daily-reports/:id
 */
exports.getOne = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT dr.*, CONCAT(u.first_name, ' ', u.last_name) AS user_name,
              (dr.instagram_outreach + dr.whatsapp_outreach + dr.email_outreach + dr.linkedin_outreach) AS total_outreach
       FROM daily_reports dr
       LEFT JOIN users u ON u.id = dr.user_id
       WHERE dr.id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Report not found' });

    // Non-admin can only see their own
    if (!req.user.is_admin && rows[0].user_id !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    return res.json(rows[0]);
  } catch (err) {
    console.error('DailyReports getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/daily-reports
 */
exports.create = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const {
    report_date, industries_focused, leads_sourced, instagram_outreach,
    whatsapp_outreach, email_outreach, linkedin_outreach, calls_done,
    follow_ups_done, replies_received, interested_leads, meetings_booked,
    crm_updated, hot_leads, problems_faced, tomorrow_focus
  } = req.body;

  try {
    const [result] = await db.query(
      `INSERT INTO daily_reports 
        (user_id, report_date, industries_focused, leads_sourced, instagram_outreach,
         whatsapp_outreach, email_outreach, linkedin_outreach, calls_done,
         follow_ups_done, replies_received, interested_leads, meetings_booked,
         crm_updated, hot_leads, problems_faced, tomorrow_focus)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id, report_date || new Date(), industries_focused || null,
        leads_sourced || 0, instagram_outreach || 0, whatsapp_outreach || 0,
        email_outreach || 0, linkedin_outreach || 0, calls_done || 0,
        follow_ups_done || 0, replies_received || 0, interested_leads || 0,
        meetings_booked || 0, crm_updated ? 1 : 0, hot_leads || null,
        problems_faced || null, tomorrow_focus || null
      ]
    );

    return res.status(201).json({ id: result.insertId, message: 'Daily report submitted' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Report already exists for this date. Use update instead.' });
    }
    console.error('DailyReports create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/daily-reports/:id
 */
exports.update = async (req, res) => {
  try {
    const [existing] = await db.query('SELECT * FROM daily_reports WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ message: 'Report not found' });

    // Only owner or admin can update
    if (!req.user.is_admin && existing[0].user_id !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const {
      industries_focused, leads_sourced, instagram_outreach,
      whatsapp_outreach, email_outreach, linkedin_outreach, calls_done,
      follow_ups_done, replies_received, interested_leads, meetings_booked,
      crm_updated, hot_leads, problems_faced, tomorrow_focus
    } = req.body;

    await db.query(
      `UPDATE daily_reports SET
        industries_focused = ?, leads_sourced = ?, instagram_outreach = ?,
        whatsapp_outreach = ?, email_outreach = ?, linkedin_outreach = ?, calls_done = ?,
        follow_ups_done = ?, replies_received = ?, interested_leads = ?, meetings_booked = ?,
        crm_updated = ?, hot_leads = ?, problems_faced = ?, tomorrow_focus = ?
       WHERE id = ?`,
      [
        industries_focused || null, leads_sourced || 0, instagram_outreach || 0,
        whatsapp_outreach || 0, email_outreach || 0, linkedin_outreach || 0, calls_done || 0,
        follow_ups_done || 0, replies_received || 0, interested_leads || 0, meetings_booked || 0,
        crm_updated ? 1 : 0, hot_leads || null, problems_faced || null, tomorrow_focus || null,
        req.params.id
      ]
    );

    return res.json({ message: 'Report updated' });
  } catch (err) {
    console.error('DailyReports update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * DELETE /api/daily-reports/:id
 */
exports.remove = async (req, res) => {
  try {
    const [existing] = await db.query('SELECT * FROM daily_reports WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ message: 'Report not found' });

    if (!req.user.is_admin && existing[0].user_id !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    await db.query('DELETE FROM daily_reports WHERE id = ?', [req.params.id]);
    return res.json({ message: 'Report deleted' });
  } catch (err) {
    console.error('DailyReports remove error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/daily-reports/summary/weekly
 * Returns weekly summary for a user (or all users for admin)
 */
exports.weeklySummary = async (req, res) => {
  try {
    const { user_id } = req.query;
    let where = 'dr.report_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)';
    const params = [];

    if (!req.user.is_admin) {
      where += ' AND dr.user_id = ?';
      params.push(req.user.id);
    } else if (user_id) {
      where += ' AND dr.user_id = ?';
      params.push(user_id);
    }

    const [rows] = await db.query(
      `SELECT 
        dr.user_id,
        CONCAT(u.first_name, ' ', u.last_name) AS user_name,
        COUNT(*) AS days_reported,
        SUM(dr.leads_sourced) AS total_leads_sourced,
        SUM(dr.instagram_outreach + dr.whatsapp_outreach + dr.email_outreach + dr.linkedin_outreach) AS total_outreach,
        SUM(dr.calls_done) AS total_calls,
        SUM(dr.follow_ups_done) AS total_follow_ups,
        SUM(dr.meetings_booked) AS total_meetings,
        SUM(dr.replies_received) AS total_replies,
        SUM(dr.interested_leads) AS total_interested
       FROM daily_reports dr
       LEFT JOIN users u ON u.id = dr.user_id
       WHERE ${where}
       GROUP BY dr.user_id
       ORDER BY total_outreach DESC`,
      params
    );

    return res.json(rows);
  } catch (err) {
    console.error('DailyReports weeklySummary error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
