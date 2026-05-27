const db = require('../config/db');

/**
 * GET /api/reports/tickets
 * Comprehensive ticket analytics
 * Query params: startDate, endDate, status, priority, ticketType, assignedTo, mode
 */
exports.getTicketsReport = async (req, res) => {
  try {
    const { startDate, endDate, status, priority, ticketType, assignedTo, mode } = req.query;

    let dateFilter = '';
    const dateParams = [];
    if (startDate && endDate) {
      dateFilter = 'AND t.created_at BETWEEN ? AND ?';
      dateParams.push(startDate, endDate + ' 23:59:59');
    } else if (startDate) {
      dateFilter = 'AND t.created_at >= ?';
      dateParams.push(startDate);
    } else if (endDate) {
      dateFilter = 'AND t.created_at <= ?';
      dateParams.push(endDate + ' 23:59:59');
    }

    let extraFilter = '';
    const extraParams = [];
    if (status) { extraFilter += ' AND t.status = ?'; extraParams.push(status); }
    if (priority) { extraFilter += ' AND t.priority = ?'; extraParams.push(priority); }
    if (ticketType) { extraFilter += ' AND t.ticket_type = ?'; extraParams.push(ticketType); }
    if (assignedTo) { extraFilter += ' AND t.assigned_to = ?'; extraParams.push(assignedTo); }
    if (mode) { extraFilter += ' AND t.mode = ?'; extraParams.push(mode); }

    const baseWhere = `t.deleted = 0 ${dateFilter} ${extraFilter}`;
    const allParams = [...dateParams, ...extraParams];

    // Helper to safely run queries
    const safeQuery = async (sql, params) => {
      try { return await db.query(sql, params); }
      catch (e) { console.error('Query failed:', e.message); return [[]]; }
    };

    // ─── 1. Core KPIs ───────────────────────────────────────────────────────────
    const [kpiRows] = await safeQuery(
      `SELECT 
        COUNT(*) AS total_tickets,
        SUM(CASE WHEN t.status = 'open' THEN 1 ELSE 0 END) AS open_tickets,
        SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
        SUM(CASE WHEN t.status = 'hold' THEN 1 ELSE 0 END) AS on_hold,
        SUM(CASE WHEN t.status = 'resolved' THEN 1 ELSE 0 END) AS resolved,
        SUM(CASE WHEN t.status = 'closed' THEN 1 ELSE 0 END) AS closed,
        SUM(CASE WHEN t.due_date < CURDATE() AND t.status NOT IN ('resolved','closed') THEN 1 ELSE 0 END) AS overdue,
        SUM(CASE WHEN t.priority = 'critical' AND t.status NOT IN ('resolved','closed') THEN 1 ELSE 0 END) AS critical_open,
        ROUND(SUM(CASE WHEN t.status IN ('resolved','closed') THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 1) AS resolution_rate,
        AVG(CASE WHEN t.resolved_at IS NOT NULL THEN TIMESTAMPDIFF(HOUR, t.created_at, t.resolved_at) END) AS avg_resolution_hours,
        SUM(t.total_time_minutes) AS total_time_minutes,
        SUM(CASE WHEN t.mode = 'support' THEN 1 ELSE 0 END) AS support_count,
        SUM(CASE WHEN t.mode = 'work' THEN 1 ELSE 0 END) AS work_count
       FROM tickets t
       WHERE ${baseWhere}`,
      allParams
    );

    // ─── 2. Status Distribution ─────────────────────────────────────────────────
    const [statusDistribution] = await safeQuery(
      `SELECT t.status, COUNT(*) AS count
       FROM tickets t
       WHERE ${baseWhere}
       GROUP BY t.status
       ORDER BY FIELD(t.status, 'open','in_progress','hold','resolved','closed')`,
      allParams
    );

    // ─── 3. Priority Distribution ───────────────────────────────────────────────
    const [priorityDistribution] = await safeQuery(
      `SELECT t.priority, COUNT(*) AS count
       FROM tickets t
       WHERE ${baseWhere}
       GROUP BY t.priority
       ORDER BY FIELD(t.priority, 'critical','high','medium','low')`,
      allParams
    );

    // ─── 4. Ticket Type Distribution ────────────────────────────────────────────
    const [typeDistribution] = await safeQuery(
      `SELECT t.ticket_type, COUNT(*) AS count
       FROM tickets t
       WHERE ${baseWhere}
       GROUP BY t.ticket_type
       ORDER BY count DESC`,
      allParams
    );

    // ─── 5. Monthly Trend ───────────────────────────────────────────────────────
    const [monthlyTrend] = await safeQuery(
      `SELECT 
        DATE_FORMAT(t.created_at, '%Y-%m') AS month,
        COUNT(*) AS created,
        SUM(CASE WHEN t.status IN ('resolved','closed') THEN 1 ELSE 0 END) AS resolved
       FROM tickets t
       WHERE ${baseWhere}
       GROUP BY DATE_FORMAT(t.created_at, '%Y-%m')
       ORDER BY month ASC
       LIMIT 12`,
      allParams
    );

    // ─── 6. Assignee Performance ────────────────────────────────────────────────
    const [assigneePerformance] = await safeQuery(
      `SELECT 
        u.id AS user_id,
        CONCAT(u.first_name, ' ', u.last_name) AS name,
        COUNT(t.id) AS total_assigned,
        SUM(CASE WHEN t.status IN ('resolved','closed') THEN 1 ELSE 0 END) AS resolved_count,
        SUM(CASE WHEN t.status = 'open' THEN 1 ELSE 0 END) AS open_count,
        SUM(CASE WHEN t.due_date < CURDATE() AND t.status NOT IN ('resolved','closed') THEN 1 ELSE 0 END) AS overdue_count,
        AVG(CASE WHEN t.resolved_at IS NOT NULL THEN TIMESTAMPDIFF(HOUR, t.created_at, t.resolved_at) END) AS avg_resolution_hours,
        SUM(t.total_time_minutes) AS total_time_minutes
       FROM users u
       JOIN tickets t ON t.assigned_to = u.id
       WHERE u.deleted = 0 AND ${baseWhere}
       GROUP BY u.id, u.first_name, u.last_name
       ORDER BY total_assigned DESC
       LIMIT 15`,
      allParams
    );

    // ─── 7. Related To Distribution ─────────────────────────────────────────────
    const [relatedToDistribution] = await safeQuery(
      `SELECT 
        COALESCE(t.related_to_type, 'unassigned') AS related_to_type, 
        COUNT(*) AS count
       FROM tickets t
       WHERE ${baseWhere}
       GROUP BY t.related_to_type
       ORDER BY count DESC`,
      allParams
    );

    // ─── 8. Resolution Time Breakdown ───────────────────────────────────────────
    const [resolutionBreakdown] = await safeQuery(
      `SELECT 
        CASE 
          WHEN TIMESTAMPDIFF(HOUR, t.created_at, t.resolved_at) <= 4 THEN '0-4 hours'
          WHEN TIMESTAMPDIFF(HOUR, t.created_at, t.resolved_at) <= 24 THEN '4-24 hours'
          WHEN TIMESTAMPDIFF(HOUR, t.created_at, t.resolved_at) <= 72 THEN '1-3 days'
          WHEN TIMESTAMPDIFF(HOUR, t.created_at, t.resolved_at) <= 168 THEN '3-7 days'
          ELSE '7+ days'
        END AS time_bucket,
        COUNT(*) AS count
       FROM tickets t
       WHERE ${baseWhere} AND t.resolved_at IS NOT NULL
       GROUP BY time_bucket
       ORDER BY FIELD(time_bucket, '0-4 hours','4-24 hours','1-3 days','3-7 days','7+ days')`,
      allParams
    );

    // ─── 9. Top Reporters ───────────────────────────────────────────────────────
    const [topReporters] = await safeQuery(
      `SELECT 
        u.id AS user_id,
        CONCAT(u.first_name, ' ', u.last_name) AS name,
        COUNT(t.id) AS tickets_reported,
        SUM(CASE WHEN t.priority = 'critical' THEN 1 ELSE 0 END) AS critical_count,
        SUM(CASE WHEN t.priority = 'high' THEN 1 ELSE 0 END) AS high_count
       FROM users u
       JOIN tickets t ON t.reported_by = u.id
       WHERE u.deleted = 0 AND ${baseWhere}
       GROUP BY u.id, u.first_name, u.last_name
       ORDER BY tickets_reported DESC
       LIMIT 10`,
      allParams
    );

    // ─── 10. Tickets List ───────────────────────────────────────────────────────
    const [ticketsList] = await safeQuery(
      `SELECT 
        t.id, t.title, t.mode, t.ticket_type, t.priority, t.status,
        t.due_date, t.created_at, t.resolved_at, t.closed_at,
        t.total_time_minutes,
        CONCAT(u_assigned.first_name, ' ', u_assigned.last_name) AS assigned_to_name,
        CONCAT(u_reported.first_name, ' ', u_reported.last_name) AS reported_by_name,
        t.related_to_type,
        p.title AS project_title,
        cl.business_name AS client_name
       FROM tickets t
       LEFT JOIN users u_assigned ON u_assigned.id = t.assigned_to
       LEFT JOIN users u_reported ON u_reported.id = t.reported_by
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN leads cl ON cl.id = t.related_to_id AND t.related_to_type = 'client'
       WHERE ${baseWhere}
       ORDER BY t.created_at DESC`,
      allParams
    );

    // ─── 11. SLA Metrics ────────────────────────────────────────────────────────
    const [slaMetrics] = await safeQuery(
      `SELECT 
        SUM(CASE WHEN t.due_date IS NOT NULL AND t.status IN ('resolved','closed') AND t.resolved_at <= t.due_date THEN 1 ELSE 0 END) AS resolved_on_time,
        SUM(CASE WHEN t.due_date IS NOT NULL AND t.status IN ('resolved','closed') AND t.resolved_at > t.due_date THEN 1 ELSE 0 END) AS resolved_late,
        SUM(CASE WHEN t.due_date IS NOT NULL AND t.status NOT IN ('resolved','closed') AND t.due_date < CURDATE() THEN 1 ELSE 0 END) AS breached,
        SUM(CASE WHEN t.due_date IS NOT NULL THEN 1 ELSE 0 END) AS with_due_date
       FROM tickets t
       WHERE ${baseWhere}`,
      allParams
    );

    // ─── Response ───────────────────────────────────────────────────────────────
    return res.json({
      kpi: kpiRows[0] || {},
      statusDistribution,
      priorityDistribution,
      typeDistribution,
      monthlyTrend,
      assigneePerformance,
      relatedToDistribution,
      resolutionBreakdown,
      topReporters,
      ticketsList,
      slaMetrics: slaMetrics[0] || {},
    });
  } catch (err) {
    console.error('Tickets report error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
