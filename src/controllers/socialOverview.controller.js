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

    if (month_year) {
      // month_year = "2026-08" — match by year and month to handle any day value
      const [yr, mo] = month_year.split('-');
      where += ' AND YEAR(p.plan_month) = ? AND MONTH(p.plan_month) = ?';
      params.push(parseInt(yr), parseInt(mo));
    }

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
      where += ' AND YEAR(p.plan_month) = ? AND MONTH(p.plan_month) = ?';
      params.push(parseInt(yr), parseInt(mo));
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
