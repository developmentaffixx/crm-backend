const db = require('../config/db');

const JSON_FIELDS = ['highlights','kpi_performance','social_performance','content_performance','content_distribution','community_management','lead_generation','ads_performance','competitor_insights','what_worked','challenges_faced','recommendations','next_month_plan','client_feedback','renewal_review','internal_review','report_approval','performance_summary'];

function parseJsonFields(row) {
  JSON_FIELDS.forEach(f => {
    if (row[f] && typeof row[f] === 'string') {
      try { row[f] = JSON.parse(row[f]); } catch(e) {}
    }
  });
  return row;
}

// ─── LIST ────────────────────────────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    const { project_id, status, page = 1, limit = 20 } = req.query;
    let where = '1=1';
    const params = [];

    if (project_id) { where += ' AND mr.project_id = ?'; params.push(project_id); }
    if (status) { where += ' AND mr.status = ?'; params.push(status); }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const [rows] = await db.query(
      `SELECT mr.id, mr.project_id, mr.reporting_month, mr.report_date, mr.status, mr.created_at,
              p.title AS project_title, l.business_name AS client_name,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM smm_monthly_reports mr
       LEFT JOIN projects p ON p.id = mr.project_id
       LEFT JOIN leads l ON l.id = p.client_id
       LEFT JOIN users u ON u.id = mr.created_by
       WHERE ${where}
       ORDER BY mr.created_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    const [countResult] = await db.query(`SELECT COUNT(*) AS total FROM smm_monthly_reports mr WHERE ${where}`, params);
    return res.json({ reports: rows, total: countResult[0].total });
  } catch (err) {
    console.error('Monthly report list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── GET ONE ─────────────────────────────────────────────────────────────────
exports.getOne = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT mr.*, p.title AS project_title, l.business_name AS client_name,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM smm_monthly_reports mr
       LEFT JOIN projects p ON p.id = mr.project_id
       LEFT JOIN leads l ON l.id = p.client_id
       LEFT JOIN users u ON u.id = mr.created_by
       WHERE mr.id = ?`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Report not found' });
    return res.json(parseJsonFields(rows[0]));
  } catch (err) {
    console.error('Monthly report getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── CREATE ──────────────────────────────────────────────────────────────────
exports.create = async (req, res) => {
  try {
    const { project_id, reporting_month } = req.body;
    if (!project_id || !reporting_month) return res.status(400).json({ message: 'Project and reporting month are required' });

    const data = { project_id, reporting_month, created_by: req.user.id };
    const fields = ['reporting_period','report_version','report_date','executive_summary','status'];
    fields.forEach(f => { if (req.body[f] !== undefined) data[f] = req.body[f]; });
    JSON_FIELDS.forEach(f => { if (req.body[f] !== undefined) data[f] = JSON.stringify(req.body[f]); });

    const columns = Object.keys(data).join(', ');
    const placeholders = Object.keys(data).map(() => '?').join(', ');
    const [result] = await db.query(`INSERT INTO smm_monthly_reports (${columns}) VALUES (${placeholders})`, Object.values(data));

    const [report] = await db.query('SELECT * FROM smm_monthly_reports WHERE id = ?', [result.insertId]);
    res.emitSocket('monthly-report:created', { id: result.insertId });
    return res.status(201).json(parseJsonFields(report[0]));
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'A report already exists for this project and month.' });
    console.error('Monthly report create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── UPDATE ──────────────────────────────────────────────────────────────────
exports.update = async (req, res) => {
  try {
    const [existing] = await db.query('SELECT * FROM smm_monthly_reports WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ message: 'Report not found' });

    if (!req.user.is_admin && existing[0].created_by !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const updates = {};
    const textFields = ['reporting_period','report_version','report_date','executive_summary','status'];
    textFields.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
    JSON_FIELDS.forEach(f => { if (req.body[f] !== undefined) updates[f] = JSON.stringify(req.body[f]); });

    if (Object.keys(updates).length > 0) {
      const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
      await db.query(`UPDATE smm_monthly_reports SET ${setClauses} WHERE id = ?`, [...Object.values(updates), req.params.id]);
    }

    const [updated] = await db.query('SELECT * FROM smm_monthly_reports WHERE id = ?', [req.params.id]);
    res.emitSocket('monthly-report:updated', { id: parseInt(req.params.id) });
    return res.json(parseJsonFields(updated[0]));
  } catch (err) {
    console.error('Monthly report update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── AUTO-POPULATE ───────────────────────────────────────────────────────────
// GET /api/monthly-reports/auto-populate?project_id=X&month=YYYY-MM
// Pulls real data from content calendar, ads, daily journal for the given month
exports.autoPopulate = async (req, res) => {
  try {
    const { project_id, month } = req.query;
    if (!project_id || !month) {
      return res.status(400).json({ message: 'project_id and month (YYYY-MM) are required' });
    }

    const monthStart = `${month}-01`;
    const monthEnd = new Date(parseInt(month.split('-')[0]), parseInt(month.split('-')[1]), 0)
      .toISOString().split('T')[0];

    // 1. Content distribution from content_calendar_posts
    const [posts] = await db.query(
      `SELECT cp.format, cp.status, cp.ad_target
       FROM content_calendar_posts cp
       JOIN content_calendar_plans p ON p.id = cp.plan_id
       WHERE p.project_id = ? AND p.deleted = 0
         AND cp.posting_date >= ? AND cp.posting_date <= ?`,
      [project_id, monthStart, monthEnd]
    );

    const contentDistribution = {
      reels: { planned: 0, published: 0 },
      static_posts: { planned: 0, published: 0 },
      carousels: { planned: 0, published: 0 },
      stories: { planned: 0, published: 0 },
      campaign_posts: { planned: 0, published: 0 },
      consistency: { planned_days: 0, actual_days: 0, completion: '0%' },
    };

    const postingDays = new Set();
    const publishedDays = new Set();

    posts.forEach(post => {
      const formatMap = { reel: 'reels', static_post: 'static_posts', carousel: 'carousels', story: 'stories', ad_copy: 'campaign_posts', blog_article: 'campaign_posts', email_newsletter: 'campaign_posts' };
      const key = formatMap[post.format] || 'static_posts';
      contentDistribution[key].planned++;
      if (post.status === 'done') {
        contentDistribution[key].published++;
      }
    });

    // Count unique posting days
    const [postedDates] = await db.query(
      `SELECT DISTINCT cp.posting_date
       FROM content_calendar_posts cp
       JOIN content_calendar_plans p ON p.id = cp.plan_id
       WHERE p.project_id = ? AND p.deleted = 0
         AND cp.posting_date >= ? AND cp.posting_date <= ?`,
      [project_id, monthStart, monthEnd]
    );
    contentDistribution.consistency.planned_days = postedDates.length;

    const [publishedDates] = await db.query(
      `SELECT DISTINCT cp.posting_date
       FROM content_calendar_posts cp
       JOIN content_calendar_plans p ON p.id = cp.plan_id
       WHERE p.project_id = ? AND p.deleted = 0
         AND cp.posting_date >= ? AND cp.posting_date <= ?
         AND cp.status = 'done'`,
      [project_id, monthStart, monthEnd]
    );
    contentDistribution.consistency.actual_days = publishedDates.length;
    contentDistribution.consistency.completion = postedDates.length > 0
      ? `${Math.round((publishedDates.length / postedDates.length) * 100)}%`
      : '0%';

    // 2. Ads performance from ad_campaign_reports
    const [adsData] = await db.query(
      `SELECT acr.*
       FROM ad_campaign_reports acr
       JOIN ad_campaigns ac ON ac.id = acr.campaign_id
       WHERE ac.project_id = ? AND ac.deleted = 0
         AND ac.start_date >= ? AND ac.start_date <= ?`,
      [project_id, monthStart, monthEnd]
    );

    const adsPerformance = {
      reach: 0, impressions: 0, clicks: 0, ctr: '', cpc: '', cpl: '',
      leads: 0, conversions: 0, best_ad: '', recommendations: '',
    };

    if (adsData.length > 0) {
      let totalReach = 0, totalImpressions = 0, totalClicks = 0, totalLeads = 0, totalConversions = 0;
      adsData.forEach(ad => {
        totalReach += ad.reach || 0;
        totalImpressions += ad.impressions || 0;
        totalClicks += ad.clicks || 0;
        totalLeads += ad.leads || 0;
        totalConversions += ad.conversions || 0;
      });
      adsPerformance.reach = totalReach;
      adsPerformance.impressions = totalImpressions;
      adsPerformance.clicks = totalClicks;
      adsPerformance.leads = totalLeads;
      adsPerformance.conversions = totalConversions;
      adsPerformance.ctr = totalImpressions > 0 ? ((totalClicks / totalImpressions) * 100).toFixed(2) + '%' : '0%';
      adsPerformance.cpc = totalClicks > 0 ? (adsData.reduce((s, a) => s + (parseFloat(a.amount_spent) || 0), 0) / totalClicks).toFixed(2) : '0';
      adsPerformance.cpl = totalLeads > 0 ? (adsData.reduce((s, a) => s + (parseFloat(a.amount_spent) || 0), 0) / totalLeads).toFixed(2) : '0';
      adsPerformance.best_ad = adsData[0]?.best_performing_ad || '';
      adsPerformance.recommendations = adsData[0]?.recommendations || '';
    }

    // 3. Daily journal health summary
    const [journalEntries] = await db.query(
      `SELECT health_status, activities_completed, issues_delays, escalation_required
       FROM smm_daily_journal
       WHERE project_id = ? AND journal_date >= ? AND journal_date <= ?`,
      [project_id, monthStart, monthEnd]
    );

    const healthSummary = { on_track: 0, attention_needed: 0, critical: 0 };
    let totalEscalations = 0;
    journalEntries.forEach(entry => {
      if (entry.health_status) healthSummary[entry.health_status] = (healthSummary[entry.health_status] || 0) + 1;
      if (entry.escalation_required === 'yes') totalEscalations++;
    });

    // Determine overall health
    let overallHealth = 'good';
    if (healthSummary.critical > 2) overallHealth = 'poor';
    else if (healthSummary.attention_needed > 5 || healthSummary.critical > 0) overallHealth = 'average';

    // 4. Lead generation from ads
    const [leadSources] = await db.query(
      `SELECT ac.platform, COALESCE(acr.leads, 0) AS leads
       FROM ad_campaigns ac
       LEFT JOIN ad_campaign_reports acr ON acr.campaign_id = ac.id
       WHERE ac.project_id = ? AND ac.deleted = 0
         AND ac.start_date >= ? AND ac.start_date <= ?`,
      [project_id, monthStart, monthEnd]
    );

    const leadGeneration = {
      sources: [
        { source: 'Instagram', leads: 0 },
        { source: 'Facebook', leads: 0 },
        { source: 'LinkedIn', leads: 0 },
        { source: 'Google Ads', leads: 0 },
        { source: 'Other', leads: 0 },
      ],
      quality: { hot: '', warm: '', cold: '' },
      observations: '',
    };

    leadSources.forEach(ls => {
      const platform = (ls.platform || '').toLowerCase();
      const match = leadGeneration.sources.find(s => platform.includes(s.source.toLowerCase()));
      if (match) match.leads += ls.leads;
      else leadGeneration.sources[4].leads += ls.leads;
    });

    // 5. Performance summary
    const totalPosts = posts.length;
    const publishedPosts = posts.filter(p => p.status === 'done').length;
    const performanceSummary = {
      total_reach: adsPerformance.reach,
      total_engagement: '',
      followers_gained: '',
      leads_generated: adsPerformance.leads,
      leads_escalated: totalEscalations,
      best_content: '',
      biggest_opportunity: '',
      overall_rating: overallHealth,
    };

    return res.json({
      content_distribution: contentDistribution,
      ads_performance: adsPerformance,
      lead_generation: leadGeneration,
      performance_summary: performanceSummary,
      internal_review: {
        health_score: overallHealth,
        satisfaction_score: '',
        team_notes: `${journalEntries.length} journal entries submitted. ${healthSummary.on_track} days on track, ${healthSummary.attention_needed} days attention needed, ${healthSummary.critical} critical days.`,
        improvement_actions: '',
      },
      _meta: {
        posts_planned: totalPosts,
        posts_published: publishedPosts,
        ads_reports_found: adsData.length,
        journal_entries: journalEntries.length,
        escalations: totalEscalations,
      },
    });
  } catch (err) {
    console.error('Monthly report auto-populate error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── DELETE ──────────────────────────────────────────────────────────────────
exports.remove = async (req, res) => {
  try {
    const [existing] = await db.query('SELECT * FROM smm_monthly_reports WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ message: 'Report not found' });

    if (!req.user.is_admin && existing[0].created_by !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    await db.query('DELETE FROM smm_monthly_reports WHERE id = ?', [req.params.id]);
    res.emitSocket('monthly-report:deleted', { id: parseInt(req.params.id) });
    return res.json({ message: 'Report deleted' });
  } catch (err) {
    console.error('Monthly report delete error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
