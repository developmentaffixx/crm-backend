const db = require('../config/db');

/**
 * GET /api/social-overview/projects
 * Aggregates data from content_calendar_plans + posts to show project-level summary
 */
exports.getProjects = async (req, res) => {
  try {
    const userId = req.user.id;
    const isAdmin = req.user.is_admin;
    const { month_year, project_type, search } = req.query;

    let where = 'p.deleted = 0';
    const params = [];

    // Month filter: show plans whose plan_month matches OR that have posts in the selected month
    let monthCondition = '';
    if (month_year) {
      const [yr, mo] = month_year.split('-');
      const monthStart = `${month_year}-01`;
      const monthEnd = new Date(parseInt(yr), parseInt(mo), 0).toISOString().split('T')[0]; // last day of month
      monthCondition = ` AND (
        (YEAR(p.plan_month) = ? AND MONTH(p.plan_month) = ?)
        OR p.id IN (SELECT DISTINCT plan_id FROM content_calendar_posts WHERE posting_date >= ? AND posting_date <= ?)
      )`;
      params.push(parseInt(yr), parseInt(mo), monthStart, monthEnd);
    }
    where += monthCondition;

    if (project_type) {
      where += ' AND pr.project_type = ?';
      params.push(project_type);
    }

    if (search) {
      where += ' AND (COALESCE(pr.title, "") LIKE ? OR COALESCE(l.business_name, "") LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    if (!isAdmin) {
      where += ` AND (p.created_by = ? OR p.project_id IN (SELECT project_id FROM project_members WHERE user_id = ?))`;
      params.push(userId, userId);
    }

    const [rows] = await db.query(
      `SELECT 
         p.id AS plan_id,
         p.project_id,
         p.client_id,
         p.plan_month,
         p.status AS plan_status,
         COALESCE(pr.title, CONCAT('Plan #', p.id)) AS project_name,
         COALESCE(pr.project_type, 'external') AS project_type,
         l.business_name AS client_name,
         COALESCE(SUM(CASE WHEN cp.format = 'reel' THEN 1 ELSE 0 END), 0) AS video_count,
         COALESCE(SUM(CASE WHEN cp.format IN ('static_post', 'carousel') THEN 1 ELSE 0 END), 0) AS poster_count,
         COUNT(cp.id) AS total_creatives,
         COALESCE(SUM(CASE WHEN cp.status = 'done' THEN 1 ELSE 0 END), 0) AS done_count,
         GROUP_CONCAT(DISTINCT cp.platform ORDER BY cp.platform SEPARATOR ' / ') AS platforms
       FROM content_calendar_plans p
       LEFT JOIN projects pr ON pr.id = p.project_id
       LEFT JOIN leads l ON l.id = p.client_id
       LEFT JOIN content_calendar_posts cp ON cp.plan_id = p.id
       WHERE ${where}
       GROUP BY p.id
       ORDER BY COALESCE(pr.title, '') ASC, p.plan_month DESC`,
      params
    );

    return res.json(rows);
  } catch (err) {
    console.error('Social overview getProjects error:', err.message, err.sql || '');
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

/**
 * GET /api/social-overview/summary
 * Returns aggregated summary cards data from content calendar
 */
exports.getSummary = async (req, res) => {
  try {
    const userId = req.user.id;
    const isAdmin = req.user.is_admin;
    const { month_year } = req.query;

    let where = 'p.deleted = 0';
    const params = [];

    if (month_year) {
      const [yr, mo] = month_year.split('-');
      const monthStart = `${month_year}-01`;
      const monthEnd = new Date(parseInt(yr), parseInt(mo), 0).toISOString().split('T')[0];
      where += ` AND (
        (YEAR(p.plan_month) = ? AND MONTH(p.plan_month) = ?)
        OR p.id IN (SELECT DISTINCT plan_id FROM content_calendar_posts WHERE posting_date >= ? AND posting_date <= ?)
      )`;
      params.push(parseInt(yr), parseInt(mo), monthStart, monthEnd);
    }

    if (!isAdmin) {
      where += ` AND (p.created_by = ? OR p.project_id IN (SELECT project_id FROM project_members WHERE user_id = ?))`;
      params.push(userId, userId);
    }

    const [summary] = await db.query(
      `SELECT
         COUNT(DISTINCT p.id) AS total_plans,
         COUNT(DISTINCT p.project_id) AS total_projects,
         COUNT(DISTINCT CASE WHEN pr.project_type = 'internal' THEN p.id END) AS internal_count,
         COUNT(DISTINCT CASE WHEN pr.project_type = 'external' THEN p.id END) AS external_count,
         COALESCE(SUM(CASE WHEN cp.format = 'reel' THEN 1 ELSE 0 END), 0) AS total_videos,
         COALESCE(SUM(CASE WHEN cp.format IN ('static_post', 'carousel') THEN 1 ELSE 0 END), 0) AS total_posters,
         COUNT(cp.id) AS total_creatives,
         COALESCE(SUM(CASE WHEN cp.status = 'done' THEN 1 ELSE 0 END), 0) AS total_done
       FROM content_calendar_plans p
       LEFT JOIN projects pr ON pr.id = p.project_id
       LEFT JOIN content_calendar_posts cp ON cp.plan_id = p.id
       WHERE ${where}`,
      params
    );

    // Platform breakdown
    const [platformRows] = await db.query(
      `SELECT cp.platform, COUNT(*) AS count
       FROM content_calendar_posts cp
       JOIN content_calendar_plans p ON p.id = cp.plan_id
       LEFT JOIN projects pr ON pr.id = p.project_id
       WHERE cp.platform IS NOT NULL AND cp.platform != '' AND ${where}
       GROUP BY cp.platform
       ORDER BY count DESC`,
      params
    );

    const platformBreakdown = {};
    platformRows.forEach(row => {
      if (row.platform) {
        platformBreakdown[row.platform] = (platformBreakdown[row.platform] || 0) + row.count;
      }
    });

    // Format breakdown
    const [formatRows] = await db.query(
      `SELECT cp.format, COUNT(*) AS count
       FROM content_calendar_posts cp
       JOIN content_calendar_plans p ON p.id = cp.plan_id
       LEFT JOIN projects pr ON pr.id = p.project_id
       WHERE ${where}
       GROUP BY cp.format`,
      params
    );

    const formatBreakdown = {};
    formatRows.forEach(row => { formatBreakdown[row.format] = row.count; });

    return res.json({
      ...(summary[0] || {}),
      platform_breakdown: platformBreakdown,
      format_breakdown: formatBreakdown,
    });
  } catch (err) {
    console.error('Social overview getSummary error:', err.message, err.sql || '');
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

/**
 * GET /api/social-overview/deliverables
 * Returns SMM service deliverables for all active projects that have allocation sheets
 */
exports.getDeliverables = async (req, res) => {
  try {
    const { search } = req.query;

    let where = `pr.status = 'active' AND pr.deleted = 0`;
    const params = [];

    if (search) {
      where += ' AND (pr.title LIKE ? OR COALESCE(l.business_name, "") LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    const [rows] = await db.query(
      `SELECT
         pas.id AS allocation_id,
         pas.project_id,
         pr.title AS project_name,
         COALESCE(pr.project_type, 'external') AS project_type,
         l.business_name AS client_name,
         pas.platforms_managed,
         pas.commitment_reels,
         pas.commitment_static_posts,
         pas.commitment_stories,
         pas.commitment_content_calendar,
         pas.commitment_insight_report,
         pas.commitment_strategy_call,
         pas.shoot_sessions,
         pas.shoot_hours,
         pas.community_dm_monitoring,
         pas.community_comment_monitoring,
         pas.community_review_monitoring,
         pas.community_lead_escalation,
         pas.ads_pre_ad_report,
         pas.ads_post_ad_report,
         pas.special_notes
       FROM project_allocation_sheets pas
       JOIN projects pr ON pr.id = pas.project_id
       LEFT JOIN leads l ON l.id = pr.client_id
       WHERE ${where}
       ORDER BY pr.title ASC`,
      params
    );

    // Parse JSON fields
    const result = rows.map(row => ({
      ...row,
      platforms_managed: row.platforms_managed ? (typeof row.platforms_managed === 'string' ? JSON.parse(row.platforms_managed) : row.platforms_managed) : [],
    }));

    return res.json(result);
  } catch (err) {
    console.error('Social overview getDeliverables error:', err.message, err.sql || '');
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};
