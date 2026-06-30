const db = require('../config/db');

/**
 * GET /api/social-overview/dashboard
 * Returns aggregated social media ops dashboard data
 */
exports.dashboard = async (req, res) => {
  try {
    const userId = req.user.id;
    const isAdmin = req.user.is_admin;

    // Current month range
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
    const today = now.toISOString().split('T')[0];

    // User filter for non-admin
    const userFilter = isAdmin ? '' : `AND p.id IN (SELECT project_id FROM project_members WHERE user_id = ${userId})`;

    // 1. Active projects count (projects with social media ops activity)
    const [activeProjects] = await db.query(
      `SELECT COUNT(DISTINCT p.id) AS count
       FROM projects p
       WHERE p.deleted = 0 AND p.status IN ('open','in_progress')
       ${userFilter}`,
    );

    // 2. Pending approvals (content briefs + ad campaigns)
    const [pendingBriefs] = await db.query(
      `SELECT COUNT(*) AS count FROM content_write_requests
       WHERE status = 'pending' AND deleted = 0
       ${isAdmin ? '' : `AND created_by = ${userId}`}`,
    );

    const [pendingAds] = await db.query(
      `SELECT COUNT(*) AS count FROM ad_campaigns
       WHERE status = 'pending_approval' AND deleted = 0
       ${isAdmin ? '' : `AND (created_by = ${userId} OR assigned_to = ${userId})`}`,
    );

    // 3. This week's scheduled posts
    const weekEnd = new Date(now);
    weekEnd.setDate(weekEnd.getDate() + (7 - weekEnd.getDay()));
    const weekEndStr = weekEnd.toISOString().split('T')[0];

    const [weekPosts] = await db.query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN cp.status = 'done' THEN 1 ELSE 0 END) AS published,
              SUM(CASE WHEN cp.status = 'planned' THEN 1 ELSE 0 END) AS planned,
              SUM(CASE WHEN cp.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress
       FROM content_calendar_posts cp
       JOIN content_calendar_plans p ON p.id = cp.plan_id
       WHERE p.deleted = 0
         AND cp.posting_date >= ? AND cp.posting_date <= ?
         ${isAdmin ? '' : `AND p.created_by = ${userId}`}`,
      [today, weekEndStr]
    );

    // 4. Overdue journal entries (projects that haven't had an entry today)
    const [projectsWithJournal] = await db.query(
      `SELECT DISTINCT project_id FROM smm_daily_journal
       WHERE journal_date = ?
       ${isAdmin ? '' : `AND submitted_by = ${userId}`}`,
      [today]
    );
    const journalProjectIds = projectsWithJournal.map(r => r.project_id);

    const [activeProjectsList] = await db.query(
      `SELECT p.id, p.title, l.business_name AS client_name
       FROM projects p
       LEFT JOIN leads l ON l.id = p.client_id
       WHERE p.deleted = 0 AND p.status IN ('open','in_progress')
       ${userFilter}
       ORDER BY p.title ASC`,
    );

    const missingJournalProjects = activeProjectsList.filter(
      p => !journalProjectIds.includes(p.id)
    ).slice(0, 10);

    // 5. Health status summary across all projects (last 7 days)
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];

    const [healthSummary] = await db.query(
      `SELECT health_status, COUNT(*) AS count
       FROM smm_daily_journal
       WHERE journal_date >= ?
       ${isAdmin ? '' : `AND submitted_by = ${userId}`}
       GROUP BY health_status`,
      [sevenDaysAgoStr]
    );

    const health = { on_track: 0, attention_needed: 0, critical: 0 };
    healthSummary.forEach(h => { health[h.health_status] = h.count; });

    // 6. This month's content calendar stats
    const [monthStats] = await db.query(
      `SELECT
         COUNT(*) AS total_posts,
         SUM(CASE WHEN cp.status = 'done' THEN 1 ELSE 0 END) AS published,
         SUM(CASE WHEN cp.status = 'planned' THEN 1 ELSE 0 END) AS planned,
         SUM(CASE WHEN cp.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
         SUM(CASE WHEN cp.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
       FROM content_calendar_posts cp
       JOIN content_calendar_plans p ON p.id = cp.plan_id
       WHERE p.deleted = 0
         AND cp.posting_date >= ? AND cp.posting_date <= ?
         ${isAdmin ? '' : `AND p.created_by = ${userId}`}`,
      [monthStart, monthEnd]
    );

    // 7. Active ad campaigns
    const [activeAds] = await db.query(
      `SELECT COUNT(*) AS count,
              SUM(COALESCE(budget, 0)) AS total_budget
       FROM ad_campaigns
       WHERE status = 'active' AND deleted = 0
       ${isAdmin ? '' : `AND (created_by = ${userId} OR assigned_to = ${userId})`}`,
    );

    // 8. Upcoming shoots this month
    const [upcomingShoots] = await db.query(
      `SELECT COUNT(*) AS count
       FROM content_calendar_shoots cs
       JOIN content_calendar_plans p ON p.id = cs.plan_id
       WHERE p.deleted = 0
         AND cs.shoot_date >= ? AND cs.shoot_date <= ?
         AND cs.status IN ('planned','confirmed')
         ${isAdmin ? '' : `AND p.created_by = ${userId}`}`,
      [today, monthEnd]
    );

    // 9. Recent escalations
    const [recentEscalations] = await db.query(
      `SELECT dj.id, dj.project_id, dj.journal_date, dj.escalation_details,
              p.title AS project_title, l.business_name AS client_name,
              CONCAT(u.first_name, ' ', u.last_name) AS submitted_by_name
       FROM smm_daily_journal dj
       LEFT JOIN projects p ON p.id = dj.project_id
       LEFT JOIN leads l ON l.id = p.client_id
       LEFT JOIN users u ON u.id = dj.submitted_by
       WHERE dj.escalation_required = 'yes'
         AND dj.journal_date >= ?
         ${isAdmin ? '' : `AND dj.submitted_by = ${userId}`}
       ORDER BY dj.journal_date DESC
       LIMIT 5`,
      [sevenDaysAgoStr]
    );

    return res.json({
      active_projects: activeProjects[0].count,
      pending_approvals: {
        briefs: pendingBriefs[0].count,
        ads: pendingAds[0].count,
        total: pendingBriefs[0].count + pendingAds[0].count,
      },
      this_week_posts: {
        total: weekPosts[0].total || 0,
        published: weekPosts[0].published || 0,
        planned: weekPosts[0].planned || 0,
        in_progress: weekPosts[0].in_progress || 0,
      },
      missing_journal_today: missingJournalProjects,
      health_last_7_days: health,
      month_content: {
        total: monthStats[0].total_posts || 0,
        published: monthStats[0].published || 0,
        planned: monthStats[0].planned || 0,
        in_progress: monthStats[0].in_progress || 0,
        cancelled: monthStats[0].cancelled || 0,
      },
      active_ads: {
        count: activeAds[0].count || 0,
        total_budget: activeAds[0].total_budget || 0,
      },
      upcoming_shoots: upcomingShoots[0].count || 0,
      recent_escalations: recentEscalations,
    });
  } catch (err) {
    console.error('Social overview dashboard error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
