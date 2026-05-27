const db = require('../config/db');

/**
 * GET /api/reports/projects/search?q=
 * Search projects by name for autocomplete
 */
exports.searchProjects = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2) {
      return res.json([]);
    }
    const [rows] = await db.query(
      `SELECT p.id, p.title, p.status, p.project_type,
              l.name AS client_name, l.business_name
       FROM projects p
       LEFT JOIN leads l ON l.id = p.client_id
       WHERE p.deleted = 0 AND p.title LIKE ?
       ORDER BY p.title ASC
       LIMIT 15`,
      [`%${q.trim()}%`]
    );
    return res.json(rows);
  } catch (err) {
    console.error('Project search error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/reports/projects
 * Comprehensive project analytics (all projects overview)
 * Query params: startDate, endDate, status, projectType, memberId
 */
exports.getProjectsReport = async (req, res) => {
  try {
    const { startDate, endDate, status, projectType, memberId } = req.query;

    let dateFilter = '';
    const dateParams = [];
    if (startDate && endDate) {
      dateFilter = 'AND p.created_at BETWEEN ? AND ?';
      dateParams.push(startDate, endDate + ' 23:59:59');
    } else if (startDate) {
      dateFilter = 'AND p.created_at >= ?';
      dateParams.push(startDate);
    } else if (endDate) {
      dateFilter = 'AND p.created_at <= ?';
      dateParams.push(endDate + ' 23:59:59');
    }

    let extraFilter = '';
    const extraParams = [];
    if (status) { extraFilter += ' AND p.status = ?'; extraParams.push(status); }
    if (projectType) { extraFilter += ' AND p.project_type = ?'; extraParams.push(projectType); }
    if (memberId) { extraFilter += ' AND p.id IN (SELECT project_id FROM project_members WHERE user_id = ?)'; extraParams.push(memberId); }

    const baseWhere = `p.deleted = 0 ${dateFilter} ${extraFilter}`;
    const allParams = [...dateParams, ...extraParams];

    // Helper to safely run queries
    const safeQuery = async (sql, params) => {
      try { return await db.query(sql, params); }
      catch (e) { console.error('Query failed:', e.message); return [[]]; }
    };

    // ─── 1. Core KPIs ───────────────────────────────────────────────────────────
    const [kpiRows] = await safeQuery(
      `SELECT 
        COUNT(*) AS total_projects,
        SUM(CASE WHEN p.status = 'open' THEN 1 ELSE 0 END) AS open_projects,
        SUM(CASE WHEN p.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
        SUM(CASE WHEN p.status = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN p.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
        SUM(CASE WHEN p.end_date < CURDATE() AND p.status NOT IN ('completed','cancelled') THEN 1 ELSE 0 END) AS overdue,
        ROUND(SUM(CASE WHEN p.status = 'completed' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 1) AS completion_rate,
        AVG(CASE WHEN p.status = 'completed' AND p.start_date IS NOT NULL 
            THEN DATEDIFF(p.updated_at, p.start_date) END) AS avg_duration_days,
        SUM(CASE WHEN p.project_type = 'internal' THEN 1 ELSE 0 END) AS internal_count,
        SUM(CASE WHEN p.project_type = 'external' THEN 1 ELSE 0 END) AS external_count
       FROM projects p
       WHERE ${baseWhere}`,
      allParams
    );

    // ─── 2. Financial KPIs ──────────────────────────────────────────────────────
    const [expenseRows] = await safeQuery(
      `SELECT COALESCE(SUM(e.amount), 0) AS total_expenses
       FROM expenses e
       JOIN projects p ON p.id = e.project_id
       WHERE e.deleted = 0 AND ${baseWhere}`,
      allParams
    );

    const [revenueRows] = await safeQuery(
      `SELECT 
        COALESCE(SUM(i.total_amount), 0) AS total_revenue,
        COALESCE(SUM(i.paid_amount), 0) AS total_collected,
        COALESCE(SUM(i.balance_amount), 0) AS total_outstanding
       FROM invoices i
       WHERE i.deleted = 0 AND i.lead_id IN (
         SELECT DISTINCT p.client_id FROM projects p WHERE ${baseWhere} AND p.client_id IS NOT NULL
       )`,
      allParams
    );

    const financial = {
      total_revenue: revenueRows[0]?.total_revenue || 0,
      total_collected: revenueRows[0]?.total_collected || 0,
      total_outstanding: revenueRows[0]?.total_outstanding || 0,
      total_expenses: expenseRows[0]?.total_expenses || 0,
    };

    // ─── 3. Status Distribution ─────────────────────────────────────────────────
    const [statusDistribution] = await safeQuery(
      `SELECT p.status, COUNT(*) AS count
       FROM projects p
       WHERE ${baseWhere}
       GROUP BY p.status
       ORDER BY FIELD(p.status, 'open','in_progress','completed','cancelled')`,
      allParams
    );

    // ─── 4. Project Type Distribution ───────────────────────────────────────────
    const [typeDistribution] = await safeQuery(
      `SELECT p.project_type, COUNT(*) AS count
       FROM projects p
       WHERE ${baseWhere}
       GROUP BY p.project_type`,
      allParams
    );

    // ─── 5. Monthly Trend ───────────────────────────────────────────────────────
    const [monthlyTrend] = await safeQuery(
      `SELECT 
        DATE_FORMAT(p.created_at, '%Y-%m') AS month,
        COUNT(*) AS created,
        SUM(CASE WHEN p.status = 'completed' THEN 1 ELSE 0 END) AS completed
       FROM projects p
       WHERE ${baseWhere}
       GROUP BY DATE_FORMAT(p.created_at, '%Y-%m')
       ORDER BY month ASC
       LIMIT 12`,
      allParams
    );

    // ─── 6. Team Utilization ────────────────────────────────────────────────────
    const [teamUtilization] = await safeQuery(
      `SELECT 
        u.id AS user_id,
        CONCAT(u.first_name, ' ', u.last_name) AS name,
        COUNT(DISTINCT pm.project_id) AS project_count,
        0 AS total_seconds,
        0 AS tasks_completed,
        0 AS tasks_total
       FROM users u
       JOIN project_members pm ON pm.user_id = u.id
       JOIN projects p ON p.id = pm.project_id
       WHERE u.deleted = 0 AND ${baseWhere}
       GROUP BY u.id, u.first_name, u.last_name
       ORDER BY project_count DESC
       LIMIT 15`,
      allParams
    );

    // ─── 7. Task Analytics (across all projects) ────────────────────────────────
    const [taskAnalytics] = await safeQuery(
      `SELECT 
        COUNT(t.id) AS total_tasks,
        SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS completed_tasks,
        SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_tasks,
        SUM(CASE WHEN t.status = 'to_do' THEN 1 ELSE 0 END) AS todo_tasks,
        SUM(CASE WHEN t.is_active = 4 THEN 1 ELSE 0 END) AS rejected_tasks,
        SUM(CASE WHEN t.deadline < CURDATE() AND t.status != 'done' THEN 1 ELSE 0 END) AS overdue_tasks,
        SUM(CASE WHEN t.priority = 'high' THEN 1 ELSE 0 END) AS high_priority,
        SUM(CASE WHEN t.priority = 'medium' THEN 1 ELSE 0 END) AS medium_priority,
        SUM(CASE WHEN t.priority = 'low' THEN 1 ELSE 0 END) AS low_priority,
        COALESCE(SUM(t.time_spent), 0) AS total_time_seconds,
        AVG(CASE WHEN t.status = 'done' THEN DATEDIFF(t.updated_at, t.start_date) END) AS avg_completion_days
       FROM tasks t
       JOIN project_tasks pt ON pt.task_id = t.id
       JOIN projects p ON p.id = pt.project_id
       WHERE t.deleted = 0 AND ${baseWhere}`,
      allParams
    );

    // ─── 8. Top Projects by Revenue ─────────────────────────────────────────────
    const [topByRevenue] = await safeQuery(
      `SELECT 
        p.id, p.title, p.status, p.project_type,
        l.name AS client_name,
        COALESCE(SUM(i.total_amount), 0) AS revenue,
        COALESCE(SUM(i.paid_amount), 0) AS collected,
        (SELECT COALESCE(SUM(e.amount), 0) FROM expenses e WHERE e.project_id = p.id AND e.deleted = 0) AS expenses
       FROM projects p
       LEFT JOIN leads l ON l.id = p.client_id
       LEFT JOIN invoices i ON i.lead_id = p.client_id AND i.deleted = 0
       WHERE ${baseWhere}
       GROUP BY p.id, p.title, p.status, p.project_type, l.name
       ORDER BY revenue DESC
       LIMIT 10`,
      allParams
    );

    // ─── 9. Project Health Scores ───────────────────────────────────────────────
    const [healthData] = await safeQuery(
      `SELECT 
        p.id, p.title, p.status, p.project_type, p.start_date, p.end_date,
        l.name AS client_name,
        (SELECT COUNT(*) FROM project_tasks pt JOIN tasks t ON t.id = pt.task_id WHERE pt.project_id = p.id AND t.deleted = 0) AS total_tasks,
        (SELECT COUNT(*) FROM project_tasks pt JOIN tasks t ON t.id = pt.task_id WHERE pt.project_id = p.id AND t.deleted = 0 AND t.status = 'done') AS done_tasks,
        (SELECT COUNT(*) FROM project_tasks pt JOIN tasks t ON t.id = pt.task_id WHERE pt.project_id = p.id AND t.deleted = 0 AND t.deadline < CURDATE() AND t.status != 'done') AS overdue_tasks,
        (SELECT COUNT(*) FROM tickets tk WHERE tk.project_id = p.id AND tk.deleted = 0 AND tk.status = 'open') AS open_tickets,
        (SELECT COALESCE(SUM(e.amount), 0) FROM expenses e WHERE e.project_id = p.id AND e.deleted = 0) AS expenses
       FROM projects p
       LEFT JOIN leads l ON l.id = p.client_id
       WHERE ${baseWhere}
       ORDER BY p.created_at DESC`,
      allParams
    );

    // Calculate health scores
    const projectHealth = healthData.map(proj => {
      let score = 50;
      // Task completion boost
      if (proj.total_tasks > 0) {
        const completionRate = proj.done_tasks / proj.total_tasks;
        score += Math.round(completionRate * 25);
      }
      // Overdue tasks penalty
      if (proj.overdue_tasks > 0) score -= Math.min(proj.overdue_tasks * 8, 25);
      // Open tickets penalty
      if (proj.open_tickets > 0) score -= Math.min(proj.open_tickets * 5, 15);
      // Timeline check
      if (proj.end_date && proj.status !== 'completed' && proj.status !== 'cancelled') {
        const daysLeft = Math.ceil((new Date(proj.end_date) - new Date()) / (1000*60*60*24));
        if (daysLeft < 0) score -= 15; // overdue
        else if (daysLeft < 7) score -= 5; // close to deadline
      }
      if (proj.status === 'completed') score += 10;
      score = Math.max(0, Math.min(100, score));
      let health_status = 'healthy';
      if (score < 40) health_status = 'critical';
      else if (score < 65) health_status = 'at_risk';
      return { ...proj, health_score: score, health_status };
    });

    const healthDistribution = {
      healthy: projectHealth.filter(p => p.health_status === 'healthy').length,
      at_risk: projectHealth.filter(p => p.health_status === 'at_risk').length,
      critical: projectHealth.filter(p => p.health_status === 'critical').length,
    };

    // ─── 10. Ticket Metrics ─────────────────────────────────────────────────────
    const [ticketMetrics] = await safeQuery(
      `SELECT 
        COUNT(*) AS total_tickets,
        SUM(CASE WHEN tk.status IN ('resolved','closed') THEN 1 ELSE 0 END) AS resolved,
        SUM(CASE WHEN tk.status = 'open' THEN 1 ELSE 0 END) AS open_tickets,
        SUM(CASE WHEN tk.priority = 'critical' THEN 1 ELSE 0 END) AS critical,
        AVG(CASE WHEN tk.resolved_at IS NOT NULL THEN TIMESTAMPDIFF(HOUR, tk.created_at, tk.resolved_at) END) AS avg_resolution_hours
       FROM tickets tk
       JOIN projects p ON p.id = tk.project_id
       WHERE tk.deleted = 0 AND ${baseWhere}`,
      allParams
    );

    // ─── 11. Deadline Extension Stats ───────────────────────────────────────────
    const [extensionStats] = await safeQuery(
      `SELECT 
        COUNT(*) AS total_requests,
        SUM(CASE WHEN der.status = 'approved' THEN 1 ELSE 0 END) AS approved,
        SUM(CASE WHEN der.status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
        SUM(CASE WHEN der.status = 'pending' THEN 1 ELSE 0 END) AS pending
       FROM task_deadline_extension_requests der
       JOIN project_tasks pt ON pt.task_id = der.task_id
       JOIN projects p ON p.id = pt.project_id
       WHERE der.deleted = 0 AND ${baseWhere}`,
      allParams
    );

    // ─── 12. Projects Table (for listing) ───────────────────────────────────────
    const [projectsList] = await safeQuery(
      `SELECT 
        p.id, p.title, p.status, p.project_type, p.start_date, p.end_date, p.created_at,
        l.name AS client_name, l.business_name,
        (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) AS member_count,
        (SELECT COUNT(*) FROM project_tasks pt JOIN tasks t ON t.id = pt.task_id WHERE pt.project_id = p.id AND t.deleted = 0) AS task_count,
        (SELECT COUNT(*) FROM project_tasks pt JOIN tasks t ON t.id = pt.task_id WHERE pt.project_id = p.id AND t.deleted = 0 AND t.status = 'done') AS done_count,
        (SELECT COALESCE(SUM(e.amount), 0) FROM expenses e WHERE e.project_id = p.id AND e.deleted = 0) AS expenses
       FROM projects p
       LEFT JOIN leads l ON l.id = p.client_id
       WHERE ${baseWhere}
       ORDER BY p.created_at DESC`,
      allParams
    );

    // ─── Response ───────────────────────────────────────────────────────────────
    return res.json({
      kpi: kpiRows[0] || {},
      financial,
      statusDistribution,
      typeDistribution,
      monthlyTrend,
      teamUtilization,
      taskAnalytics: taskAnalytics[0] || {},
      topByRevenue,
      projectHealth: projectHealth.slice(0, 20),
      healthDistribution,
      ticketMetrics: ticketMetrics[0] || {},
      extensionStats: extensionStats[0] || {},
      projectsList,
    });
  } catch (err) {
    console.error('Projects report error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/reports/projects/:id
 * Detailed report for a single project
 */
exports.getSingleProjectReport = async (req, res) => {
  try {
    const projectId = req.params.id;

    // Helper to safely run queries
    const safeQuery = async (sql, params) => {
      try { return await db.query(sql, params); }
      catch (e) { console.error('Query failed:', e.message); return [[]]; }
    };

    // ─── Project Profile ────────────────────────────────────────────────────────
    const [projectRows] = await safeQuery(
      `SELECT p.*, 
              l.name AS client_name, l.business_name,
              COALESCE(s.name, '') AS service_name,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM projects p
       LEFT JOIN leads l ON l.id = p.client_id
       LEFT JOIN services s ON s.id = p.service_id
       LEFT JOIN users u ON u.id = p.created_by
       WHERE p.id = ? AND p.deleted = 0`,
      [projectId]
    );

    if (projectRows.length === 0) {
      return res.status(404).json({ message: 'Project not found' });
    }
    const project = projectRows[0];

    // ─── Team Members ───────────────────────────────────────────────────────────
    const [teamMembers] = await safeQuery(
      `SELECT u.id, CONCAT(u.first_name, ' ', u.last_name) AS name, u.email,
              (SELECT COUNT(*) FROM project_tasks pt JOIN tasks t ON t.id = pt.task_id 
               WHERE pt.project_id = ? AND t.assigned_to = u.id AND t.deleted = 0) AS task_count,
              (SELECT COUNT(*) FROM project_tasks pt JOIN tasks t ON t.id = pt.task_id 
               WHERE pt.project_id = ? AND t.assigned_to = u.id AND t.deleted = 0 AND t.status = 'done') AS done_count,
              (SELECT COALESCE(SUM(ttl.duration), 0) FROM task_time_logs ttl 
               JOIN project_tasks pt ON pt.task_id = ttl.task_id 
               WHERE pt.project_id = ? AND ttl.user_id = u.id) AS time_seconds
       FROM users u
       JOIN project_members pm ON pm.user_id = u.id
       WHERE pm.project_id = ?`,
      [projectId, projectId, projectId, projectId]
    );

    // ─── Task Analytics ─────────────────────────────────────────────────────────
    const [taskStats] = await safeQuery(
      `SELECT 
        COUNT(*) AS total_tasks,
        SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
        SUM(CASE WHEN t.status = 'to_do' THEN 1 ELSE 0 END) AS todo,
        SUM(CASE WHEN t.is_active = 4 THEN 1 ELSE 0 END) AS rejected,
        SUM(CASE WHEN t.deadline < CURDATE() AND t.status != 'done' THEN 1 ELSE 0 END) AS overdue,
        SUM(CASE WHEN t.priority = 'high' THEN 1 ELSE 0 END) AS high_priority,
        SUM(CASE WHEN t.priority = 'medium' THEN 1 ELSE 0 END) AS medium_priority,
        SUM(CASE WHEN t.priority = 'low' THEN 1 ELSE 0 END) AS low_priority,
        COALESCE(SUM(t.time_spent), 0) AS total_time_seconds,
        AVG(CASE WHEN t.status = 'done' THEN DATEDIFF(t.updated_at, t.start_date) END) AS avg_completion_days
       FROM tasks t
       JOIN project_tasks pt ON pt.task_id = t.id
       WHERE pt.project_id = ? AND t.deleted = 0`,
      [projectId]
    );

    // ─── Tasks List ─────────────────────────────────────────────────────────────
    const [tasksList] = await safeQuery(
      `SELECT t.id, t.title, t.status, t.priority, t.is_active, t.start_date, t.deadline,
              t.time_spent, t.created_at, t.updated_at,
              CONCAT(u.first_name, ' ', u.last_name) AS assigned_to_name
       FROM tasks t
       JOIN project_tasks pt ON pt.task_id = t.id
       LEFT JOIN users u ON u.id = t.assigned_to
       WHERE pt.project_id = ? AND t.deleted = 0
       ORDER BY t.created_at DESC`,
      [projectId]
    );

    // ─── Time Logs (daily breakdown) ────────────────────────────────────────────
    const [timeLogs] = await safeQuery(
      `SELECT 
        DATE(ttl.started_at) AS log_date,
        SUM(ttl.duration) AS total_seconds,
        COUNT(*) AS entries
       FROM task_time_logs ttl
       JOIN project_tasks pt ON pt.task_id = ttl.task_id
       WHERE pt.project_id = ?
       GROUP BY DATE(ttl.started_at)
       ORDER BY log_date DESC
       LIMIT 30`,
      [projectId]
    );

    // ─── Expenses ───────────────────────────────────────────────────────────────
    const [expenses] = await safeQuery(
      `SELECT e.id, e.title, e.expense_date, e.category, e.amount, e.payment_mode, e.vendor_name
       FROM expenses e
       WHERE e.project_id = ? AND e.deleted = 0
       ORDER BY e.expense_date DESC`,
      [projectId]
    );

    const [expenseKpi] = await safeQuery(
      `SELECT 
        COALESCE(SUM(amount), 0) AS total_expenses,
        COUNT(*) AS expense_count,
        COALESCE(AVG(amount), 0) AS avg_expense
       FROM expenses WHERE project_id = ? AND deleted = 0`,
      [projectId]
    );

    // ─── Expense by Category ────────────────────────────────────────────────────
    const [expenseByCategory] = await safeQuery(
      `SELECT category, SUM(amount) AS total, COUNT(*) AS count
       FROM expenses WHERE project_id = ? AND deleted = 0
       GROUP BY category ORDER BY total DESC`,
      [projectId]
    );

    // ─── Tickets ────────────────────────────────────────────────────────────────
    const [tickets] = await safeQuery(
      `SELECT tk.id, tk.title, tk.ticket_type, tk.priority, tk.status, 
              tk.created_at, tk.resolved_at,
              CONCAT(u.first_name, ' ', u.last_name) AS assigned_to_name,
              CASE WHEN tk.resolved_at IS NOT NULL THEN TIMESTAMPDIFF(HOUR, tk.created_at, tk.resolved_at) ELSE NULL END AS resolution_hours
       FROM tickets tk
       LEFT JOIN users u ON u.id = tk.assigned_to
       WHERE tk.project_id = ? AND tk.deleted = 0
       ORDER BY tk.created_at DESC`,
      [projectId]
    );

    const [ticketKpi] = await safeQuery(
      `SELECT 
        COUNT(*) AS total_tickets,
        SUM(CASE WHEN status IN ('resolved','closed') THEN 1 ELSE 0 END) AS resolved,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_tickets,
        SUM(CASE WHEN priority = 'critical' THEN 1 ELSE 0 END) AS critical,
        AVG(CASE WHEN resolved_at IS NOT NULL THEN TIMESTAMPDIFF(HOUR, created_at, resolved_at) END) AS avg_resolution_hours
       FROM tickets WHERE project_id = ? AND deleted = 0`,
      [projectId]
    );

    // ─── Deadline Extensions ────────────────────────────────────────────────────
    const [extensions] = await safeQuery(
      `SELECT der.*, t.title AS task_title,
              CONCAT(u.first_name, ' ', u.last_name) AS requested_by_name
       FROM task_deadline_extension_requests der
       JOIN tasks t ON t.id = der.task_id
       JOIN project_tasks pt ON pt.task_id = der.task_id
       LEFT JOIN users u ON u.id = der.requested_by
       WHERE pt.project_id = ? AND der.deleted = 0
       ORDER BY der.created_at DESC`,
      [projectId]
    );

    // ─── Activity Timeline ──────────────────────────────────────────────────────
    const [activities] = await safeQuery(
      `SELECT pa.id, pa.type, pa.note, pa.created_at,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM project_activities pa
       LEFT JOIN users u ON u.id = pa.created_by
       WHERE pa.project_id = ?
       ORDER BY pa.created_at DESC
       LIMIT 20`,
      [projectId]
    );

    // ─── Health Score ───────────────────────────────────────────────────────────
    const ts = taskStats[0] || {};
    let healthScore = 50;
    if (ts.total_tasks > 0) {
      healthScore += Math.round((ts.completed / ts.total_tasks) * 25);
    }
    if (ts.overdue > 0) healthScore -= Math.min(ts.overdue * 8, 25);
    const tkKpi = ticketKpi[0] || {};
    if (tkKpi.open_tickets > 0) healthScore -= Math.min(tkKpi.open_tickets * 5, 15);
    if (project.end_date && project.status !== 'completed' && project.status !== 'cancelled') {
      const daysLeft = Math.ceil((new Date(project.end_date) - new Date()) / (1000*60*60*24));
      if (daysLeft < 0) healthScore -= 15;
      else if (daysLeft < 7) healthScore -= 5;
    }
    if (project.status === 'completed') healthScore += 10;
    healthScore = Math.max(0, Math.min(100, healthScore));
    let healthStatus = 'healthy';
    if (healthScore < 40) healthStatus = 'critical';
    else if (healthScore < 65) healthStatus = 'at_risk';

    // ─── Timeline Progress ──────────────────────────────────────────────────────
    let timelineProgress = null;
    if (project.start_date && project.end_date) {
      const totalDays = Math.ceil((new Date(project.end_date) - new Date(project.start_date)) / (1000*60*60*24));
      const elapsed = Math.ceil((new Date() - new Date(project.start_date)) / (1000*60*60*24));
      timelineProgress = {
        totalDays,
        elapsed: Math.min(elapsed, totalDays),
        remaining: Math.max(totalDays - elapsed, 0),
        percentage: Math.min(Math.round((elapsed / totalDays) * 100), 100),
      };
    }

    // ─── Response ───────────────────────────────────────────────────────────────
    return res.json({
      project,
      teamMembers,
      taskStats: ts,
      tasksList,
      timeLogs,
      expenses,
      expenseKpi: expenseKpi[0] || {},
      expenseByCategory,
      tickets,
      ticketKpi: tkKpi,
      extensions,
      activities,
      healthScore,
      healthStatus,
      timelineProgress,
    });
  } catch (err) {
    console.error('Single project report error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
