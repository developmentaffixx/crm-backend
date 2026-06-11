const { validationResult } = require('express-validator');
const db = require('../config/db');

// ─── Helper: fetch daily targets from DB ─────────────────────────────────────
async function getDailyTargetsFromDB() {
  const [rows] = await db.query('SELECT * FROM daily_targets_settings WHERE id = 1');
  if (rows.length === 0) {
    // Fallback defaults
    return {
      target_mode: 'range',
      leads_sourced: { min: 40, max: 50 },
      total_outreach: { min: 30, max: 40 },
      follow_ups_done: { min: 10, max: 15 },
      calls_done: { min: 2, max: 3 },
      meetings_booked: { min: 1, max: 2 },
      monthly_conversion: { min: 3, max: 5 },
      monthly_revenue: { min: 150000, max: 200000 },
    };
  }
  const s = rows[0];
  return {
    target_mode: s.target_mode || 'range',
    leads_sourced: { min: s.leads_sourced_min, max: s.leads_sourced_max },
    total_outreach: { min: s.total_outreach_min, max: s.total_outreach_max },
    follow_ups_done: { min: s.follow_ups_min, max: s.follow_ups_max },
    calls_done: { min: s.calls_min, max: s.calls_max },
    meetings_booked: { min: s.meetings_booked_min, max: s.meetings_booked_max },
    monthly_conversion: { min: s.monthly_conversion_min || 3, max: s.monthly_conversion_max || 5 },
    monthly_revenue: { min: s.monthly_revenue_min || 150000, max: s.monthly_revenue_max || 200000 },
  };
}

/**
 * GET /api/daily-reports/auto-stats
 * Auto-fetches daily activity stats from leads & follow_ups tables
 * Query params: date (YYYY-MM-DD), user_id (optional, admin only)
 */
exports.autoStats = async (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().split('T')[0];
    const userId = (!req.user.is_admin) ? req.user.id : (req.query.user_id || null);

    // Use date range to avoid timezone issues (start of day to end of day)
    const dateStart = `${targetDate} 00:00:00`;
    const dateEnd = `${targetDate} 23:59:59`;

    // Build user filter — admin sees all if no user_id specified
    const userFilter = userId ? 'AND created_by = ?' : '';
    const userParams = userId ? [userId] : [];

    // 1. Leads sourced today
    const [leadsSourced] = await db.query(
      `SELECT COUNT(*) AS count FROM leads 
       WHERE created_at >= ? AND created_at <= ? AND deleted = 0 ${userId ? 'AND created_by = ?' : ''}`,
      [dateStart, dateEnd, ...userParams]
    );

    // 2. Follow-up counts by type
    const [followUpsByType] = await db.query(
      `SELECT 
        COALESCE(SUM(CASE WHEN type IN ('Instagram', 'Instagram DM') THEN 1 ELSE 0 END), 0) AS instagram_outreach,
        COALESCE(SUM(CASE WHEN type IN ('WhatsApp', 'WhatsApp Message') THEN 1 ELSE 0 END), 0) AS whatsapp_outreach,
        COALESCE(SUM(CASE WHEN type IN ('Email', 'Email Sent') THEN 1 ELSE 0 END), 0) AS email_outreach,
        COALESCE(SUM(CASE WHEN type IN ('LinkedIn', 'LinkedIn Message') THEN 1 ELSE 0 END), 0) AS linkedin_outreach,
        COALESCE(SUM(CASE WHEN type IN ('Call', 'Phone Call') THEN 1 ELSE 0 END), 0) AS calls_done,
        COUNT(*) AS total_follow_ups
       FROM lead_follow_ups
       WHERE created_at >= ? AND created_at <= ? ${userId ? 'AND created_by = ?' : ''}`,
      [dateStart, dateEnd, ...userParams]
    );

    // 3. Meetings booked (outcome = 'Meeting Scheduled')
    const [meetingsBooked] = await db.query(
      `SELECT COUNT(*) AS count FROM lead_follow_ups
       WHERE created_at >= ? AND created_at <= ? AND outcome = 'Meeting Scheduled' ${userId ? 'AND created_by = ?' : ''}`,
      [dateStart, dateEnd, ...userParams]
    );

    // 4. Replies received (any outcome that is NOT 'No Response' and NOT NULL)
    const [repliesReceived] = await db.query(
      `SELECT COUNT(*) AS count FROM lead_follow_ups
       WHERE created_at >= ? AND created_at <= ?
       AND outcome IS NOT NULL AND outcome != '' AND outcome != 'No Response' ${userId ? 'AND created_by = ?' : ''}`,
      [dateStart, dateEnd, ...userParams]
    );

    // 5. Interested leads (outcome in positive categories)
    const [interestedLeads] = await db.query(
      `SELECT COUNT(*) AS count FROM lead_follow_ups
       WHERE created_at >= ? AND created_at <= ?
       AND outcome IN ('Interested', 'Warm Lead', 'Hot Lead', 'Proposal Requested', 'Meeting Scheduled') ${userId ? 'AND created_by = ?' : ''}`,
      [dateStart, dateEnd, ...userParams]
    );

    // 6. CRM updated (any activity today = yes)
    const totalActivity = (leadsSourced[0].count || 0) + (followUpsByType[0].total_follow_ups || 0);
    const crmUpdated = totalActivity > 0;

    // 7. Hot leads today (leads with score >= 4 that had activity today)
    const [hotLeads] = await db.query(
      `SELECT DISTINCT l.name, l.business_name, l.lead_id
       FROM leads l
       INNER JOIN lead_follow_ups f ON f.lead_id = l.id
       WHERE f.created_at >= ? AND f.created_at <= ?
       AND l.lead_score >= 4 AND l.deleted = 0 ${userId ? 'AND f.created_by = ?' : ''}
       LIMIT 10`,
      [dateStart, dateEnd, ...userParams]
    );

    // 8. Tomorrow's due follow-ups (auto-suggest)
    const tomorrow = new Date(targetDate);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    const [tomorrowFollowUps] = await db.query(
      `SELECT f.id, f.note, f.follow_up_date, l.name, l.business_name, l.lead_id
       FROM lead_follow_ups f
       JOIN leads l ON l.id = f.lead_id AND l.deleted = 0
       WHERE DATE(f.follow_up_date) = ?
       ${userId ? 'AND (l.assigned_to = ? OR l.created_by = ?)' : ''}
       ORDER BY f.follow_up_date ASC
       LIMIT 10`,
      [tomorrowStr, ...(userId ? [userId, userId] : [])]
    );

    // 9. Monthly stats (conversion & revenue for current month)
    const monthStart = targetDate.substring(0, 7) + '-01'; // YYYY-MM-01
    const [monthlyStats] = await db.query(
      `SELECT 
        COALESCE(SUM(CASE WHEN status = 'Won' THEN 1 ELSE 0 END), 0) AS conversions_this_month,
        COALESCE(SUM(CASE WHEN status = 'Won' THEN expected_revenue ELSE 0 END), 0) AS revenue_closed_this_month
       FROM leads
       WHERE DATE(updated_at) >= ? AND DATE(updated_at) <= LAST_DAY(?)
       AND status = 'Won' AND deleted = 0
       ${userId ? 'AND (assigned_to = ? OR created_by = ?)' : ''}`,
      [monthStart, monthStart, ...(userId ? [userId, userId] : [])]
    );

    // 10. Industries focused (from leads created today)
    const [industriesFocused] = await db.query(
      `SELECT DISTINCT industry FROM leads
       WHERE created_at >= ? AND created_at <= ? AND deleted = 0 AND industry IS NOT NULL AND industry != ''
       ${userId ? 'AND created_by = ?' : ''}`,
      [dateStart, dateEnd, ...userParams]
    );

    const stats = followUpsByType[0];
    const totalOutreach = (stats.instagram_outreach || 0) + (stats.whatsapp_outreach || 0) +
      (stats.email_outreach || 0) + (stats.linkedin_outreach || 0);

    return res.json({
      date: targetDate,
      user_id: userId,
      // Auto-calculated fields
      auto: {
        leads_sourced: leadsSourced[0].count || 0,
        instagram_outreach: stats.instagram_outreach || 0,
        whatsapp_outreach: stats.whatsapp_outreach || 0,
        email_outreach: stats.email_outreach || 0,
        linkedin_outreach: stats.linkedin_outreach || 0,
        total_outreach: totalOutreach,
        calls_done: stats.calls_done || 0,
        follow_ups_done: stats.total_follow_ups || 0,
        meetings_booked: meetingsBooked[0].count || 0,
        replies_received: repliesReceived[0].count || 0,
        interested_leads: interestedLeads[0].count || 0,
        crm_updated: crmUpdated,
        industries_focused: industriesFocused.map(r => r.industry).join(', '),
      },
      // Auto-suggested content
      suggestions: {
        hot_leads: hotLeads.map(l => l.business_name || l.name).join(', '),
        tomorrow_follow_ups: tomorrowFollowUps.map(f => ({
          lead_name: f.business_name || f.name,
          lead_id: f.lead_id,
          note: f.note,
          date: f.follow_up_date,
        })),
      },
      // Monthly targets progress
      monthly: {
        conversions_this_month: monthlyStats[0].conversions_this_month || 0,
        revenue_closed_this_month: parseFloat(monthlyStats[0].revenue_closed_this_month) || 0,
      },
    });
  } catch (err) {
    console.error('Auto stats error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

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
