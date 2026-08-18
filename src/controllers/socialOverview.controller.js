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

    // Build month filter for plan_month (stored as DATE like '2026-08-01')
    let monthFilter = '';
    const params = [];

    if (month_year) {
      // month_year comes as "2026-08", convert to first day of month
      monthFilter = ' AND p.plan_month = ?';
      params.push(`${month_year}-01`);
    }

    let typeFilter = '';
    if (project_type) {
      typeFilter = ' AND pr.project_type = ?';
      params.push(project_type);
    }

    let searchFilter = '';
    if (search) {
      searchFilter = ' AND (pr.title LIKE ? OR l.business_name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    // Non-admin: only plans for projects they are members of or created by them
    let accessFilter = '';
    if (!isAdmin) {
      accessFilter = ` AND (p.created_by = ? OR p.project_id IN (SELECT project_id FROM project_members WHERE user_id = ?))`;
      params.push(userId, userId);
    }

    const [rows] = await db.query(
      `SELECT 
         p.id AS plan_id,
         p.project_id,
         p.client_id,
         p.plan_month,
         p.status AS plan_status,
         pr.title AS project_name,
         pr.project_type,
         l.business_name AS client_name,
         -- Video count (reels)
         COALESCE(SUM(CASE WHEN cp.format = 'reel' THEN 1 ELSE 0 END), 0) AS video_count,
         -- Poster count (static_post + carousel)
         COALESCE(SUM(CASE WHEN cp.format IN ('static_post', 'carousel') THEN 1 ELSE 0 END), 0) AS poster_count,
         -- Total posts
         COALESCE(COUNT(cp.id), 0) AS total_creatives,
         -- Done count
         COALESCE(SUM(CASE WHEN cp.status = 'done' THEN 1 ELSE 0 END), 0) AS done_count,
         -- Collect platforms (comma-separated unique)
         GROUP_CONCAT(DISTINCT cp.platform ORDER BY cp.platform SEPARATOR ' / ') AS platforms
       FROM content_calendar_plans p
       LEFT JOIN projects pr ON pr.id = p.project_id
       LEFT JOIN leads l ON l.id = p.client_id
       LEFT JOIN content_calendar_posts cp ON cp.plan_id = p.id
       WHERE p.deleted = 0
         ${monthFilter}
         ${typeFilter}
         ${searchFilter}
         ${accessFilter}
       GROUP BY p.id, p.project_id, p.client_id, p.plan_month, p.status, pr.title, pr.project_type, l.business_name
       ORDER BY pr.title ASC, p.plan_month DESC`,
      params
    );

    return res.json(rows);
  } catch (err) {
    console.error('Social overview getProjects error:', err);
    return res.status(500).json({ message: 'Server error' });
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

    let monthFilter = '';
    const params = [];

    if (month_year) {
      monthFilter = ' AND p.plan_month = ?';
      params.push(`${month_year}-01`);
    }

    let accessFilter = '';
    if (!isAdmin) {
      accessFilter = ` AND (p.created_by = ? OR p.project_id IN (SELECT project_id FROM project_members WHERE user_id = ?))`;
      params.push(userId, userId);
    }

    // Main summary
    const [summary] = await db.query(
      `SELECT
         COUNT(DISTINCT p.id) AS total_plans,
         COUNT(DISTINCT p.project_id) AS total_projects,
         SUM(CASE WHEN pr.project_type = 'internal' THEN 1 ELSE 0 END) AS internal_count,
         SUM(CASE WHEN pr.project_type = 'external' THEN 1 ELSE 0 END) AS external_count,
         COALESCE(SUM(CASE WHEN cp.format = 'reel' THEN 1 ELSE 0 END), 0) AS total_videos,
         COALESCE(SUM(CASE WHEN cp.format IN ('static_post', 'carousel') THEN 1 ELSE 0 END), 0) AS total_posters,
         COALESCE(COUNT(cp.id), 0) AS total_creatives,
         COALESCE(SUM(CASE WHEN cp.status = 'done' THEN 1 ELSE 0 END), 0) AS total_done
       FROM content_calendar_plans p
       LEFT JOIN projects pr ON pr.id = p.project_id
       LEFT JOIN content_calendar_posts cp ON cp.plan_id = p.id
       WHERE p.deleted = 0
         ${monthFilter}
         ${accessFilter}`,
      params
    );

    // Service breakdown (from projects.service_id — but we'll use project_type for now)
    // Platform breakdown
    const [platformRows] = await db.query(
      `SELECT cp.platform, COUNT(*) AS count
       FROM content_calendar_posts cp
       JOIN content_calendar_plans p ON p.id = cp.plan_id AND p.deleted = 0
       LEFT JOIN projects pr ON pr.id = p.project_id
       WHERE cp.platform IS NOT NULL AND cp.platform != ''
         ${monthFilter}
         ${accessFilter}
       GROUP BY cp.platform
       ORDER BY count DESC`,
      params
    );

    const platformBreakdown = {};
    platformRows.forEach(row => {
      if (row.platform) {
        // Split in case platform field has multiple (e.g. "Instagram, Facebook")
        row.platform.split(',').map(p => p.trim()).filter(Boolean).forEach(plat => {
          platformBreakdown[plat] = (platformBreakdown[plat] || 0) + row.count;
        });
      }
    });

    // Format breakdown
    const [formatRows] = await db.query(
      `SELECT cp.format, COUNT(*) AS count
       FROM content_calendar_posts cp
       JOIN content_calendar_plans p ON p.id = cp.plan_id AND p.deleted = 0
       LEFT JOIN projects pr ON pr.id = p.project_id
       WHERE 1=1
         ${monthFilter}
         ${accessFilter}
       GROUP BY cp.format`,
      params
    );

    const formatBreakdown = {};
    formatRows.forEach(row => { formatBreakdown[row.format] = row.count; });

    return res.json({
      ...summary[0],
      platform_breakdown: platformBreakdown,
      format_breakdown: formatBreakdown,
    });
  } catch (err) {
    console.error('Social overview getSummary error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
