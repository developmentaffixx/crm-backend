const db = require('../config/db');

/**
 * GET /api/reports/leads
 * Comprehensive leads analytics data
 * Query params: startDate, endDate, assignedTo, source, temperature
 */
exports.getLeadsReport = async (req, res) => {
  try {
    const { startDate, endDate, assignedTo, source, temperature } = req.query;

    let dateFilter = '';
    const dateParams = [];

    if (startDate && endDate) {
      dateFilter = 'AND l.created_at BETWEEN ? AND ?';
      dateParams.push(startDate, endDate + ' 23:59:59');
    } else if (startDate) {
      dateFilter = 'AND l.created_at >= ?';
      dateParams.push(startDate);
    } else if (endDate) {
      dateFilter = 'AND l.created_at <= ?';
      dateParams.push(endDate + ' 23:59:59');
    }

    let extraFilter = '';
    const extraParams = [];
    if (assignedTo) { extraFilter += ' AND l.assigned_to = ?'; extraParams.push(assignedTo); }
    if (source) { extraFilter += ' AND l.source = ?'; extraParams.push(source); }
    if (temperature) { extraFilter += ' AND l.temperature = ?'; extraParams.push(temperature); }

    const baseWhere = `l.deleted = 0 ${dateFilter} ${extraFilter}`;
    const allParams = [...dateParams, ...extraParams];

    // 1. Overview KPIs
    const [kpiRows] = await db.query(
      `SELECT 
        COUNT(*) AS total_leads,
        SUM(CASE WHEN l.status = 'Won' THEN 1 ELSE 0 END) AS won_leads,
        SUM(CASE WHEN l.status = 'Lost' THEN 1 ELSE 0 END) AS lost_leads,
        SUM(CASE WHEN l.status NOT IN ('Won', 'Lost') THEN 1 ELSE 0 END) AS active_leads,
        SUM(CASE WHEN l.temperature = 'hot' THEN 1 ELSE 0 END) AS hot_leads,
        SUM(CASE WHEN l.temperature = 'warm' THEN 1 ELSE 0 END) AS warm_leads,
        SUM(CASE WHEN l.temperature = 'cold' THEN 1 ELSE 0 END) AS cold_leads,
        AVG(CASE WHEN l.status = 'Won' THEN DATEDIFF(l.updated_at, l.created_at) END) AS avg_conversion_days,
        SUM(CASE WHEN l.status = 'Won' THEN COALESCE(l.budget_max, 0) ELSE 0 END) AS total_won_value,
        SUM(CASE WHEN l.status NOT IN ('Won', 'Lost') THEN COALESCE(l.budget_max, 0) ELSE 0 END) AS pipeline_value
       FROM leads l
       WHERE ${baseWhere}`,
      allParams
    );

    // 2. Pipeline funnel (status breakdown with order)
    const [funnelRows] = await db.query(
      `SELECT 
        l.status,
        COUNT(*) AS count,
        SUM(COALESCE(l.budget_max, 0)) AS value
       FROM leads l
       WHERE ${baseWhere}
       GROUP BY l.status
       ORDER BY FIELD(l.status, 'New', 'Contacted', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost')`,
      allParams
    );

    // 3. Leads over time (monthly trend)
    const [trendRows] = await db.query(
      `SELECT 
        DATE_FORMAT(l.created_at, '%Y-%m') AS month,
        COUNT(*) AS created,
        SUM(CASE WHEN l.status = 'Won' THEN 1 ELSE 0 END) AS won,
        SUM(CASE WHEN l.status = 'Lost' THEN 1 ELSE 0 END) AS lost
       FROM leads l
       WHERE ${baseWhere}
       GROUP BY DATE_FORMAT(l.created_at, '%Y-%m')
       ORDER BY month ASC
       LIMIT 12`,
      allParams
    );

    // 4. Source performance
    const [sourceRows] = await db.query(
      `SELECT 
        COALESCE(l.source, 'Unknown') AS source,
        COUNT(*) AS total,
        SUM(CASE WHEN l.status = 'Won' THEN 1 ELSE 0 END) AS won,
        SUM(CASE WHEN l.status = 'Lost' THEN 1 ELSE 0 END) AS lost,
        ROUND(SUM(CASE WHEN l.status = 'Won' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 1) AS conversion_rate
       FROM leads l
       WHERE ${baseWhere}
       GROUP BY l.source
       ORDER BY total DESC`,
      allParams
    );

    // 5. Temperature distribution
    const [tempRows] = await db.query(
      `SELECT 
        l.temperature,
        COUNT(*) AS count,
        ROUND(COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM leads l2 WHERE l2.deleted = 0 ${dateFilter} ${extraFilter}), 0), 1) AS percentage
       FROM leads l
       WHERE ${baseWhere}
       GROUP BY l.temperature`,
      [...allParams, ...allParams]
    );

    // 6. Team performance (leads per assignee)
    const [teamRows] = await db.query(
      `SELECT 
        l.assigned_to,
        CONCAT(u.first_name, ' ', u.last_name) AS name,
        COUNT(*) AS total,
        SUM(CASE WHEN l.status = 'Won' THEN 1 ELSE 0 END) AS won,
        SUM(CASE WHEN l.status = 'Lost' THEN 1 ELSE 0 END) AS lost,
        SUM(CASE WHEN l.status NOT IN ('Won', 'Lost') THEN 1 ELSE 0 END) AS active,
        ROUND(SUM(CASE WHEN l.status = 'Won' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 1) AS conversion_rate
       FROM leads l
       LEFT JOIN users u ON u.id = l.assigned_to
       WHERE ${baseWhere} AND l.assigned_to IS NOT NULL
       GROUP BY l.assigned_to, u.first_name, u.last_name
       ORDER BY won DESC
       LIMIT 10`,
      allParams
    );

    // 7. Weekly activity heatmap (last 12 weeks)
    const [heatmapRows] = await db.query(
      `SELECT 
        DATE(l.created_at) AS date,
        COUNT(*) AS count
       FROM leads l
       WHERE ${baseWhere} AND l.created_at >= DATE_SUB(CURDATE(), INTERVAL 84 DAY)
       GROUP BY DATE(l.created_at)
       ORDER BY date ASC`,
      allParams
    );

    // 8. Average time in each status stage
    const [stageTimeRows] = await db.query(
      `SELECT 
        h.old_status,
        h.new_status,
        AVG(TIMESTAMPDIFF(HOUR, 
          (SELECT h2.changed_at FROM lead_status_history h2 
           WHERE h2.lead_id = h.lead_id AND h2.new_status = h.old_status 
           ORDER BY h2.changed_at DESC LIMIT 1),
          h.changed_at
        )) AS avg_hours
       FROM lead_status_history h
       JOIN leads l ON l.id = h.lead_id
       WHERE l.deleted = 0 AND h.old_status != ''
       GROUP BY h.old_status, h.new_status
       HAVING avg_hours IS NOT NULL
       ORDER BY FIELD(h.old_status, 'New', 'Contacted', 'Qualified', 'Proposal', 'Negotiation')`,
      []
    );

    // 9. Recent conversions
    const [recentWins] = await db.query(
      `SELECT 
        l.id, l.lead_id, l.name, l.business_name, l.source, l.budget_max,
        l.updated_at AS won_date,
        DATEDIFF(l.updated_at, l.created_at) AS days_to_convert,
        CONCAT(u.first_name, ' ', u.last_name) AS assigned_to_name
       FROM leads l
       LEFT JOIN users u ON u.id = l.assigned_to
       WHERE l.deleted = 0 AND l.status = 'Won'
       ORDER BY l.updated_at DESC
       LIMIT 5`,
      []
    );

    // 10. Comparison with previous period
    let comparison = null;
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      const diffDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
      const prevEnd = new Date(start);
      prevEnd.setDate(prevEnd.getDate() - 1);
      const prevStart = new Date(prevEnd);
      prevStart.setDate(prevStart.getDate() - diffDays);

      const [prevRows] = await db.query(
        `SELECT 
          COUNT(*) AS total_leads,
          SUM(CASE WHEN l.status = 'Won' THEN 1 ELSE 0 END) AS won_leads,
          SUM(CASE WHEN l.status = 'Lost' THEN 1 ELSE 0 END) AS lost_leads
         FROM leads l
         WHERE l.deleted = 0 AND l.created_at BETWEEN ? AND ? ${extraFilter}`,
        [prevStart.toISOString().split('T')[0], prevEnd.toISOString().split('T')[0] + ' 23:59:59', ...extraParams]
      );

      comparison = {
        prev_total: prevRows[0].total_leads || 0,
        prev_won: prevRows[0].won_leads || 0,
        prev_lost: prevRows[0].lost_leads || 0,
      };
    }

    return res.json({
      kpi: kpiRows[0],
      funnel: funnelRows,
      trend: trendRows,
      sources: sourceRows,
      temperature: tempRows,
      team: teamRows,
      heatmap: heatmapRows,
      stageTime: stageTimeRows,
      recentWins,
      comparison,
    });
  } catch (err) {
    console.error('Leads report error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
