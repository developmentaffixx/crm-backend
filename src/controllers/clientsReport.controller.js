const db = require('../config/db');

/**
 * GET /api/reports/clients
 * Comprehensive client analytics data
 * Query params: startDate, endDate, assignedTo, source
 */
exports.getClientsReport = async (req, res) => {
  try {
    const { startDate, endDate, assignedTo, source } = req.query;

    let dateFilter = '';
    const dateParams = [];

    if (startDate && endDate) {
      dateFilter = 'AND l.updated_at BETWEEN ? AND ?';
      dateParams.push(startDate, endDate + ' 23:59:59');
    } else if (startDate) {
      dateFilter = 'AND l.updated_at >= ?';
      dateParams.push(startDate);
    } else if (endDate) {
      dateFilter = 'AND l.updated_at <= ?';
      dateParams.push(endDate + ' 23:59:59');
    }

    let extraFilter = '';
    const extraParams = [];
    if (assignedTo) { extraFilter += ' AND l.assigned_to = ?'; extraParams.push(assignedTo); }
    if (source) { extraFilter += ' AND l.source = ?'; extraParams.push(source); }

    const baseWhere = `l.deleted = 0 AND l.status = 'Won' ${dateFilter} ${extraFilter}`;
    const allParams = [...dateParams, ...extraParams];

    // ─── 1. Core KPIs ───────────────────────────────────────────────────────────
    const [kpiRows] = await db.query(
      `SELECT 
        COUNT(*) AS total_clients,
        SUM(CASE WHEN l.updated_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) AS new_clients_30d,
        SUM(CASE WHEN l.updated_at >= DATE_SUB(CURDATE(), INTERVAL 90 DAY) THEN 1 ELSE 0 END) AS new_clients_90d,
        AVG(DATEDIFF(CURDATE(), l.updated_at)) AS avg_client_age_days,
        SUM(COALESCE(l.budget_max, 0)) AS total_deal_value
       FROM leads l
       WHERE ${baseWhere}`,
      allParams
    );

    // ─── 2. Revenue KPIs (from invoices) ────────────────────────────────────────
    const [revenueRows] = await db.query(
      `SELECT 
        COALESCE(SUM(i.total_amount), 0) AS total_invoiced,
        COALESCE(SUM(i.paid_amount), 0) AS total_collected,
        COALESCE(SUM(i.balance_amount), 0) AS total_outstanding,
        COALESCE(AVG(i.total_amount), 0) AS avg_invoice_value,
        COUNT(i.id) AS total_invoices,
        SUM(CASE WHEN i.status = 'Paid' THEN 1 ELSE 0 END) AS paid_invoices,
        SUM(CASE WHEN i.status = 'Overdue' THEN 1 ELSE 0 END) AS overdue_invoices,
        SUM(CASE WHEN i.status = 'Partial' THEN 1 ELSE 0 END) AS partial_invoices,
        SUM(CASE WHEN i.status = 'New' THEN 1 ELSE 0 END) AS new_invoices
       FROM invoices i
       JOIN leads l ON l.id = i.lead_id
       WHERE i.deleted = 0 AND ${baseWhere}`,
      allParams
    );

    // ─── 3. Revenue Trend (monthly) ─────────────────────────────────────────────
    const [revenueTrend] = await db.query(
      `SELECT 
        DATE_FORMAT(i.bill_date, '%Y-%m') AS month,
        SUM(i.total_amount) AS invoiced,
        SUM(i.paid_amount) AS collected,
        COUNT(i.id) AS invoice_count
       FROM invoices i
       JOIN leads l ON l.id = i.lead_id
       WHERE i.deleted = 0 AND ${baseWhere}
       GROUP BY DATE_FORMAT(i.bill_date, '%Y-%m')
       ORDER BY month ASC
       LIMIT 12`,
      allParams
    );

    // ─── 4. Top Clients by Revenue ──────────────────────────────────────────────
    const [topClients] = await db.query(
      `SELECT 
        l.id,
        l.name,
        l.business_name,
        COALESCE(SUM(i.total_amount), 0) AS total_revenue,
        COALESCE(SUM(i.paid_amount), 0) AS paid_amount,
        COALESCE(SUM(i.balance_amount), 0) AS outstanding,
        COUNT(DISTINCT i.id) AS invoice_count,
        COUNT(DISTINCT p.id) AS project_count
       FROM leads l
       LEFT JOIN invoices i ON i.lead_id = l.id AND i.deleted = 0
       LEFT JOIN projects p ON p.client_id = l.id AND p.deleted = 0
       WHERE ${baseWhere}
       GROUP BY l.id, l.name, l.business_name
       ORDER BY total_revenue DESC
       LIMIT 10`,
      allParams
    );

    // ─── 5. Client Acquisition Trend (monthly new clients) ──────────────────────
    const [acquisitionTrend] = await db.query(
      `SELECT 
        DATE_FORMAT(l.updated_at, '%Y-%m') AS month,
        COUNT(*) AS new_clients
       FROM leads l
       WHERE ${baseWhere}
       GROUP BY DATE_FORMAT(l.updated_at, '%Y-%m')
       ORDER BY month ASC
       LIMIT 12`,
      allParams
    );

    // ─── 6. Source Breakdown ────────────────────────────────────────────────────
    const [sourceBreakdown] = await db.query(
      `SELECT 
        COALESCE(l.source, 'Unknown') AS source,
        COUNT(*) AS count,
        ROUND(COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM leads l2 WHERE l2.deleted = 0 AND l2.status = 'Won'), 0), 1) AS percentage
       FROM leads l
       WHERE ${baseWhere}
       GROUP BY l.source
       ORDER BY count DESC`,
      allParams
    );

    // ─── 7. Project Delivery Metrics ────────────────────────────────────────────
    const [projectMetrics] = await db.query(
      `SELECT 
        COUNT(*) AS total_projects,
        SUM(CASE WHEN p.status = 'completed' THEN 1 ELSE 0 END) AS completed_projects,
        SUM(CASE WHEN p.status = 'in_progress' THEN 1 ELSE 0 END) AS active_projects,
        SUM(CASE WHEN p.status = 'open' THEN 1 ELSE 0 END) AS open_projects,
        SUM(CASE WHEN p.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_projects,
        ROUND(SUM(CASE WHEN p.status = 'completed' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 1) AS completion_rate,
        SUM(CASE WHEN p.status = 'completed' AND p.end_date IS NOT NULL AND p.updated_at <= p.end_date THEN 1 ELSE 0 END) AS on_time_deliveries
       FROM projects p
       JOIN leads l ON l.id = p.client_id
       WHERE p.deleted = 0 AND ${baseWhere}`,
      allParams
    );

    // ─── 8. Payment Status Distribution ─────────────────────────────────────────
    const [paymentStatus] = await db.query(
      `SELECT 
        i.status,
        COUNT(*) AS count,
        SUM(i.total_amount) AS total_value
       FROM invoices i
       JOIN leads l ON l.id = i.lead_id
       WHERE i.deleted = 0 AND ${baseWhere}
       GROUP BY i.status
       ORDER BY FIELD(i.status, 'Paid', 'Partial', 'New', 'Overdue')`,
      allParams
    );

    // ─── 9. Payment Aging (30/60/90 days overdue) ───────────────────────────────
    const [paymentAging] = await db.query(
      `SELECT 
        SUM(CASE WHEN DATEDIFF(CURDATE(), i.due_date) BETWEEN 1 AND 30 THEN i.balance_amount ELSE 0 END) AS overdue_30,
        SUM(CASE WHEN DATEDIFF(CURDATE(), i.due_date) BETWEEN 31 AND 60 THEN i.balance_amount ELSE 0 END) AS overdue_60,
        SUM(CASE WHEN DATEDIFF(CURDATE(), i.due_date) BETWEEN 61 AND 90 THEN i.balance_amount ELSE 0 END) AS overdue_90,
        SUM(CASE WHEN DATEDIFF(CURDATE(), i.due_date) > 90 THEN i.balance_amount ELSE 0 END) AS overdue_90_plus
       FROM invoices i
       JOIN leads l ON l.id = i.lead_id
       WHERE i.deleted = 0 AND i.balance_amount > 0 AND i.due_date < CURDATE() AND ${baseWhere}`,
      allParams
    );

    // ─── 10. Expenses per Client (top 10) ───────────────────────────────────────
    const [clientExpenses] = await db.query(
      `SELECT 
        l.id,
        l.name,
        l.business_name,
        COALESCE(SUM(e.amount), 0) AS total_expenses,
        COUNT(e.id) AS expense_count
       FROM leads l
       LEFT JOIN expenses e ON e.client_id = l.id AND e.deleted = 0
       WHERE ${baseWhere}
       GROUP BY l.id, l.name, l.business_name
       HAVING total_expenses > 0
       ORDER BY total_expenses DESC
       LIMIT 10`,
      allParams
    );

    // ─── 11. Client Profitability (Revenue - Expenses) ──────────────────────────
    const [profitability] = await db.query(
      `SELECT 
        l.id,
        l.name,
        l.business_name,
        COALESCE(inv.total_revenue, 0) AS revenue,
        COALESCE(exp.total_expenses, 0) AS expenses,
        COALESCE(inv.total_revenue, 0) - COALESCE(exp.total_expenses, 0) AS profit
       FROM leads l
       LEFT JOIN (
         SELECT lead_id, SUM(total_amount) AS total_revenue FROM invoices WHERE deleted = 0 GROUP BY lead_id
       ) inv ON inv.lead_id = l.id
       LEFT JOIN (
         SELECT client_id, SUM(amount) AS total_expenses FROM expenses WHERE deleted = 0 GROUP BY client_id
       ) exp ON exp.client_id = l.id
       WHERE ${baseWhere}
       GROUP BY l.id, l.name, l.business_name, inv.total_revenue, exp.total_expenses
       HAVING revenue > 0 OR expenses > 0
       ORDER BY profit DESC
       LIMIT 10`,
      allParams
    );

    // ─── 12. Ticket/Support Volume ──────────────────────────────────────────────
    const [ticketMetrics] = await db.query(
      `SELECT 
        COUNT(*) AS total_tickets,
        SUM(CASE WHEN t.status IN ('resolved', 'closed') THEN 1 ELSE 0 END) AS resolved_tickets,
        SUM(CASE WHEN t.status = 'open' THEN 1 ELSE 0 END) AS open_tickets,
        SUM(CASE WHEN t.priority = 'critical' THEN 1 ELSE 0 END) AS critical_tickets,
        AVG(CASE WHEN t.resolved_at IS NOT NULL THEN TIMESTAMPDIFF(HOUR, t.created_at, t.resolved_at) END) AS avg_resolution_hours
       FROM tickets t
       JOIN leads l ON l.id = t.related_to_id AND t.related_to_type = 'client'
       WHERE t.deleted = 0 AND ${baseWhere}`,
      allParams
    );

    // ─── 13. Client Health Scores ───────────────────────────────────────────────
    const [healthData] = await db.query(
      `SELECT 
        l.id,
        l.name,
        l.business_name,
        DATEDIFF(CURDATE(), l.updated_at) AS days_since_conversion,
        (SELECT COUNT(*) FROM projects p WHERE p.client_id = l.id AND p.deleted = 0 AND p.status = 'in_progress') AS active_projects,
        (SELECT COUNT(*) FROM invoices i WHERE i.lead_id = l.id AND i.deleted = 0 AND i.status = 'Overdue') AS overdue_invoices,
        (SELECT COUNT(*) FROM tickets t WHERE t.related_to_id = l.id AND t.related_to_type = 'client' AND t.deleted = 0 AND t.status = 'open') AS open_tickets,
        (SELECT MAX(i.created_at) FROM invoices i WHERE i.lead_id = l.id AND i.deleted = 0) AS last_invoice_date,
        (SELECT COALESCE(SUM(i.paid_amount), 0) FROM invoices i WHERE i.lead_id = l.id AND i.deleted = 0) AS total_paid
       FROM leads l
       WHERE ${baseWhere}
       ORDER BY l.name ASC`,
      allParams
    );

    // Calculate health scores
    const clientHealth = healthData.map(client => {
      let score = 50; // base score

      // Active projects boost (+20 max)
      if (client.active_projects > 0) score += Math.min(client.active_projects * 10, 20);

      // Overdue invoices penalty (-15 each, max -30)
      if (client.overdue_invoices > 0) score -= Math.min(client.overdue_invoices * 15, 30);

      // Open tickets penalty (-5 each, max -15)
      if (client.open_tickets > 0) score -= Math.min(client.open_tickets * 5, 15);

      // Recent invoice activity boost (+15)
      if (client.last_invoice_date) {
        const daysSinceInvoice = Math.floor((Date.now() - new Date(client.last_invoice_date).getTime()) / (1000 * 60 * 60 * 24));
        if (daysSinceInvoice <= 30) score += 15;
        else if (daysSinceInvoice <= 60) score += 10;
        else if (daysSinceInvoice <= 90) score += 5;
        else if (daysSinceInvoice > 180) score -= 10;
      } else {
        score -= 10;
      }

      // Revenue boost (+15 max)
      if (client.total_paid > 100000) score += 15;
      else if (client.total_paid > 50000) score += 10;
      else if (client.total_paid > 10000) score += 5;

      // Clamp score
      score = Math.max(0, Math.min(100, score));

      let status = 'healthy';
      if (score < 40) status = 'at_risk';
      else if (score < 65) status = 'needs_attention';

      return { ...client, health_score: score, health_status: status };
    });

    // Health distribution summary
    const healthDistribution = {
      healthy: clientHealth.filter(c => c.health_status === 'healthy').length,
      needs_attention: clientHealth.filter(c => c.health_status === 'needs_attention').length,
      at_risk: clientHealth.filter(c => c.health_status === 'at_risk').length,
    };

    // ─── 14. Account Manager Performance ────────────────────────────────────────
    const [managerPerformance] = await db.query(
      `SELECT 
        l.assigned_to,
        CONCAT(u.first_name, ' ', u.last_name) AS name,
        COUNT(DISTINCT l.id) AS client_count,
        COALESCE(SUM(inv_sub.revenue), 0) AS total_revenue,
        COALESCE(SUM(inv_sub.collected), 0) AS collected_revenue,
        COUNT(DISTINCT proj_sub.project_id) AS project_count
       FROM leads l
       LEFT JOIN users u ON u.id = l.assigned_to
       LEFT JOIN (
         SELECT lead_id, SUM(total_amount) AS revenue, SUM(paid_amount) AS collected FROM invoices WHERE deleted = 0 GROUP BY lead_id
       ) inv_sub ON inv_sub.lead_id = l.id
       LEFT JOIN (
         SELECT client_id AS cid, id AS project_id FROM projects WHERE deleted = 0
       ) proj_sub ON proj_sub.cid = l.id
       WHERE ${baseWhere} AND l.assigned_to IS NOT NULL
       GROUP BY l.assigned_to, u.first_name, u.last_name
       ORDER BY total_revenue DESC
       LIMIT 10`,
      allParams
    );

    // ─── 15. Period Comparison ───────────────────────────────────────────────────
    let comparison = null;
    if (startDate && endDate) {
      const daysDiff = Math.ceil((new Date(endDate) - new Date(startDate)) / (1000 * 60 * 60 * 24));
      const prevEnd = new Date(new Date(startDate).getTime() - 1000 * 60 * 60 * 24);
      const prevStart = new Date(prevEnd.getTime() - daysDiff * 1000 * 60 * 60 * 24);
      const prevStartStr = prevStart.toISOString().split('T')[0];
      const prevEndStr = prevEnd.toISOString().split('T')[0];

      const [prevData] = await db.query(
        `SELECT 
          COUNT(*) AS prev_clients,
          (SELECT COALESCE(SUM(i.total_amount), 0) FROM invoices i JOIN leads l2 ON l2.id = i.lead_id WHERE i.deleted = 0 AND l2.deleted = 0 AND l2.status = 'Won' AND i.bill_date BETWEEN ? AND ?) AS prev_revenue
         FROM leads l
         WHERE l.deleted = 0 AND l.status = 'Won' AND l.updated_at BETWEEN ? AND ?`,
        [prevStartStr, prevEndStr + ' 23:59:59', prevStartStr, prevEndStr + ' 23:59:59']
      );
      comparison = prevData[0] || null;
    }

    // ─── Response ───────────────────────────────────────────────────────────────
    return res.json({
      kpi: kpiRows[0] || {},
      revenue: revenueRows[0] || {},
      revenueTrend,
      topClients,
      acquisitionTrend,
      sourceBreakdown,
      projectMetrics: projectMetrics[0] || {},
      paymentStatus,
      paymentAging: paymentAging[0] || {},
      clientExpenses,
      profitability,
      ticketMetrics: ticketMetrics[0] || {},
      clientHealth: clientHealth.slice(0, 20),
      healthDistribution,
      managerPerformance,
      comparison,
    });
  } catch (err) {
    console.error('Clients report error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/reports/clients/:id
 * Detailed report for a single client
 * Query params: startDate, endDate
 */
exports.getSingleClientReport = async (req, res) => {
  try {
    const clientId = req.params.id;
    const { startDate, endDate } = req.query;

    let dateFilter = '';
    const dateParams = [];
    if (startDate && endDate) {
      dateFilter = 'AND created_at BETWEEN ? AND ?';
      dateParams.push(startDate, endDate + ' 23:59:59');
    } else if (startDate) {
      dateFilter = 'AND created_at >= ?';
      dateParams.push(startDate);
    } else if (endDate) {
      dateFilter = 'AND created_at <= ?';
      dateParams.push(endDate + ' 23:59:59');
    }

    // ─── Client Profile ─────────────────────────────────────────────────────────
    const [clientRows] = await db.query(
      `SELECT l.*, 
              CONCAT(u_a.first_name, ' ', u_a.last_name) AS assigned_to_name,
              CONCAT(u_c.first_name, ' ', u_c.last_name) AS created_by_name
       FROM leads l
       LEFT JOIN users u_a ON u_a.id = l.assigned_to
       LEFT JOIN users u_c ON u_c.id = l.created_by
       WHERE l.id = ? AND l.deleted = 0 AND l.status = 'Won'`,
      [clientId]
    );

    if (clientRows.length === 0) {
      return res.status(404).json({ message: 'Client not found' });
    }

    const client = clientRows[0];

    // ─── Revenue KPIs ───────────────────────────────────────────────────────────
    const [revenueKpi] = await db.query(
      `SELECT 
        COALESCE(SUM(total_amount), 0) AS total_invoiced,
        COALESCE(SUM(paid_amount), 0) AS total_collected,
        COALESCE(SUM(balance_amount), 0) AS total_outstanding,
        COUNT(*) AS total_invoices,
        SUM(CASE WHEN status = 'Paid' THEN 1 ELSE 0 END) AS paid_invoices,
        SUM(CASE WHEN status = 'Overdue' THEN 1 ELSE 0 END) AS overdue_invoices,
        SUM(CASE WHEN status = 'Partial' THEN 1 ELSE 0 END) AS partial_invoices,
        SUM(CASE WHEN status = 'New' THEN 1 ELSE 0 END) AS new_invoices
       FROM invoices
       WHERE lead_id = ? AND deleted = 0`,
      [clientId]
    );

    // ─── Revenue Trend (monthly) ────────────────────────────────────────────────
    const [revenueTrend] = await db.query(
      `SELECT 
        DATE_FORMAT(bill_date, '%Y-%m') AS month,
        SUM(total_amount) AS invoiced,
        SUM(paid_amount) AS collected
       FROM invoices
       WHERE lead_id = ? AND deleted = 0
       GROUP BY DATE_FORMAT(bill_date, '%Y-%m')
       ORDER BY month ASC
       LIMIT 12`,
      [clientId]
    );

    // ─── Invoices Table ─────────────────────────────────────────────────────────
    const [invoices] = await db.query(
      `SELECT id, invoice_number, bill_date, due_date, total_amount, paid_amount, balance_amount, status, created_at
       FROM invoices
       WHERE lead_id = ? AND deleted = 0
       ORDER BY bill_date DESC`,
      [clientId]
    );

    // ─── Payments Table ─────────────────────────────────────────────────────────
    const [payments] = await db.query(
      `SELECT ip.*, i.invoice_number
       FROM invoice_payments ip
       JOIN invoices i ON i.id = ip.invoice_id
       WHERE i.lead_id = ? AND i.deleted = 0
       ORDER BY ip.payment_date DESC`,
      [clientId]
    );

    // ─── Projects ───────────────────────────────────────────────────────────────
    const [projects] = await db.query(
      `SELECT p.id, p.title, p.project_type, p.start_date, p.end_date, p.status, p.created_at,
              (SELECT GROUP_CONCAT(CONCAT(u.first_name, ' ', u.last_name) SEPARATOR ', ')
               FROM project_members pm JOIN users u ON u.id = pm.user_id WHERE pm.project_id = p.id) AS team_members
       FROM projects p
       WHERE p.client_id = ? AND p.deleted = 0
       ORDER BY p.created_at DESC`,
      [clientId]
    );

    // ─── Project KPIs ───────────────────────────────────────────────────────────
    const [projectKpi] = await db.query(
      `SELECT 
        COUNT(*) AS total_projects,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_projects,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled
       FROM projects
       WHERE client_id = ? AND deleted = 0`,
      [clientId]
    );

    // ─── Expenses Table ─────────────────────────────────────────────────────────
    const [expenses] = await db.query(
      `SELECT e.id, e.title, e.expense_date, e.category, e.amount, e.payment_mode, e.vendor_name,
              p.title AS project_name
       FROM expenses e
       LEFT JOIN projects p ON p.id = e.project_id
       WHERE e.client_id = ? AND e.deleted = 0
       ORDER BY e.expense_date DESC`,
      [clientId]
    );

    const [expenseKpi] = await db.query(
      `SELECT COALESCE(SUM(amount), 0) AS total_expenses, COUNT(*) AS expense_count
       FROM expenses WHERE client_id = ? AND deleted = 0`,
      [clientId]
    );

    // ─── Tickets Table ──────────────────────────────────────────────────────────
    const [tickets] = await db.query(
      `SELECT t.id, t.title, t.ticket_type, t.priority, t.status, t.created_at, t.resolved_at, t.closed_at,
              CONCAT(u.first_name, ' ', u.last_name) AS assigned_to_name,
              CASE WHEN t.resolved_at IS NOT NULL THEN TIMESTAMPDIFF(HOUR, t.created_at, t.resolved_at) ELSE NULL END AS resolution_hours
       FROM tickets t
       LEFT JOIN users u ON u.id = t.assigned_to
       WHERE t.related_to_id = ? AND t.related_to_type = 'client' AND t.deleted = 0
       ORDER BY t.created_at DESC`,
      [clientId]
    );

    const [ticketKpi] = await db.query(
      `SELECT 
        COUNT(*) AS total_tickets,
        SUM(CASE WHEN status IN ('resolved','closed') THEN 1 ELSE 0 END) AS resolved,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_tickets,
        SUM(CASE WHEN priority = 'critical' THEN 1 ELSE 0 END) AS critical,
        AVG(CASE WHEN resolved_at IS NOT NULL THEN TIMESTAMPDIFF(HOUR, created_at, resolved_at) END) AS avg_resolution_hours
       FROM tickets
       WHERE related_to_id = ? AND related_to_type = 'client' AND deleted = 0`,
      [clientId]
    );

    // ─── Follow-ups / Activity ──────────────────────────────────────────────────
    const [followUps] = await db.query(
      `SELECT lf.id, lf.type, lf.note, lf.follow_up_date, lf.created_at,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM lead_follow_ups lf
       LEFT JOIN users u ON u.id = lf.created_by
       WHERE lf.lead_id = ?
       ORDER BY lf.created_at DESC`,
      [clientId]
    );

    // ─── Health Score Calculation ───────────────────────────────────────────────
    let healthScore = 50;
    const pKpi = projectKpi[0] || {};
    const tKpi = ticketKpi[0] || {};
    const rKpi = revenueKpi[0] || {};

    if (pKpi.in_progress > 0) healthScore += Math.min(pKpi.in_progress * 10, 20);
    if (rKpi.overdue_invoices > 0) healthScore -= Math.min(rKpi.overdue_invoices * 15, 30);
    if (tKpi.open_tickets > 0) healthScore -= Math.min(tKpi.open_tickets * 5, 15);

    if (invoices.length > 0) {
      const lastInvoiceDate = new Date(invoices[0].created_at);
      const daysSince = Math.floor((Date.now() - lastInvoiceDate.getTime()) / (1000 * 60 * 60 * 24));
      if (daysSince <= 30) healthScore += 15;
      else if (daysSince <= 60) healthScore += 10;
      else if (daysSince <= 90) healthScore += 5;
      else if (daysSince > 180) healthScore -= 10;
    } else {
      healthScore -= 10;
    }

    if (rKpi.total_collected > 100000) healthScore += 15;
    else if (rKpi.total_collected > 50000) healthScore += 10;
    else if (rKpi.total_collected > 10000) healthScore += 5;

    healthScore = Math.max(0, Math.min(100, healthScore));
    let healthStatus = 'healthy';
    if (healthScore < 40) healthStatus = 'at_risk';
    else if (healthScore < 65) healthStatus = 'needs_attention';

    // ─── Profitability ──────────────────────────────────────────────────────────
    const totalRevenue = rKpi.total_invoiced || 0;
    const totalExpenses = (expenseKpi[0] || {}).total_expenses || 0;
    const profit = totalRevenue - totalExpenses;
    const profitMargin = totalRevenue > 0 ? ((profit / totalRevenue) * 100).toFixed(1) : 0;

    // ─── Response ───────────────────────────────────────────────────────────────
    return res.json({
      client,
      revenue: revenueKpi[0] || {},
      revenueTrend,
      invoices,
      payments,
      projects,
      projectKpi: pKpi,
      expenses,
      expenseKpi: expenseKpi[0] || {},
      tickets,
      ticketKpi: tKpi,
      followUps,
      healthScore,
      healthStatus,
      profitability: { revenue: totalRevenue, expenses: totalExpenses, profit, profitMargin },
    });
  } catch (err) {
    console.error('Single client report error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
