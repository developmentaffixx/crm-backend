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
         pas.platforms_managed,
         pas.commitment_reels,
         pas.commitment_static_posts,
         pas.commitment_stories,
         pas.commitment_content_calendar,
         pas.commitment_insight_report,
         pas.commitment_strategy_call,
         pas.shoot_sessions,
         pas.community_management_frequency,
         pas.ads_pre_ad_report,
         pas.ads_post_ad_report
       FROM project_allocation_sheets pas
       JOIN projects pr ON pr.id = pas.project_id
       LEFT JOIN project_services pps ON pps.id = pas.project_service_id
       LEFT JOIN services psv ON psv.id = pps.service_id
       LEFT JOIN leads l ON l.id = pr.client_id
       WHERE ${where}
         AND (pas.project_service_id IS NULL OR LOWER(psv.name) IN ('smm', 'social media marketing'))
       ORDER BY pr.title ASC`,
      params
    );

    // Parse JSON fields
    const result = rows.map(row => ({
      ...row,
      platforms_managed: row.platforms_managed ? (typeof row.platforms_managed === 'string' ? JSON.parse(row.platforms_managed) : row.platforms_managed) : [],
      shoot_sessions: row.shoot_sessions ? (typeof row.shoot_sessions === 'string' ? JSON.parse(row.shoot_sessions) : row.shoot_sessions) : [],
    }));

    return res.json(result);
  } catch (err) {
    console.error('Social overview getDeliverables error:', err.message, err.sql || '');
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// WORKFLOW BOARD
// GET /api/social-overview/board?month=YYYY-MM&service=smm|personal_branding&search=
//
// One row per active Project ▸ Service (SMM, Personal Branding) combining:
//   Calendar + Contents (post slots), Shoots, Ads and Daily Updates for the month,
//   measured against the Allocation Sheet commitment.
// ─────────────────────────────────────────────────────────────────────────────
const { todayIST, requiredServices, submittedKeys, toDateStr } = require('../helpers/dailyUpdate');

const SMM_NAMES = ['smm', 'social media marketing'];
const PB_NAMES = ['personal branding'];
const STAGES = ['open', 'assigned', 'submitted', 'smm_approved', 'approved', 'completed', 'rejected'];
const emptyStages = () => STAGES.reduce((o, s) => { o[s] = 0; return o; }, {});
const normStage = (s) => (STAGES.includes(s) ? s : 'open');
const DONE_STAGES = ['approved', 'completed'];
const SEVERITY_RANK = { high: 0, medium: 1, low: 2 };

function monthRange(monthYear) {
  const m = /^(\d{4})-(\d{2})$/.exec(monthYear || '');
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const yr = m ? parseInt(m[1], 10) : now.getUTCFullYear();
  const mo = m ? parseInt(m[2], 10) : now.getUTCMonth() + 1;
  const pad = (n) => String(n).padStart(2, '0');
  const last = new Date(Date.UTC(yr, mo, 0)).getUTCDate();
  return { month: `${yr}-${pad(mo)}`, from: `${yr}-${pad(mo)}-01`, to: `${yr}-${pad(mo)}-${pad(last)}` };
}

const parseJsonArr = (v) => {
  if (Array.isArray(v)) return v;
  if (!v) return [];
  try { const a = JSON.parse(v); return Array.isArray(a) ? a : []; } catch { return []; }
};

exports.getBoard = async (req, res) => {
  try {
    const { service, search } = req.query;
    const { month, from, to } = monthRange(req.query.month);
    const today = todayIST();
    const uid = Number(req.user.id);
    const seeAll = !!req.user.is_admin || Number(req.socialAccessLevel) >= 2;

    // ── 1. Project ▸ Service rows ───────────────────────────────────────────
    let names = [...SMM_NAMES, ...PB_NAMES];
    if (service === 'smm') names = SMM_NAMES;
    if (service === 'personal_branding') names = PB_NAMES;

    let where = `p.deleted = 0 AND p.status = 'active' AND ps.status IN ('active','paused') AND LOWER(s.name) IN (?)`;
    const params = [names];
    if (search) {
      where += ' AND (p.title LIKE ? OR COALESCE(l.business_name, "") LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (!seeAll) {
      where += ` AND (EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id = p.id AND pm.user_id = ?)
                   OR EXISTS (SELECT 1 FROM project_service_members psm WHERE psm.project_service_id = ps.id AND psm.user_id = ?))`;
      params.push(uid, uid);
    }

    const [svcRows] = await db.query(
      `SELECT ps.id AS project_service_id, ps.project_id, ps.status AS service_status,
              ps.start_date AS service_start, ps.end_date AS service_end,
              p.title AS project_title, COALESCE(p.project_type, 'external') AS project_type,
              l.business_name AS client_name, s.name AS service_name
       FROM project_services ps
       JOIN projects p ON p.id = ps.project_id
       JOIN services s ON s.id = ps.service_id
       LEFT JOIN leads l ON l.id = p.client_id
       WHERE ${where}
       ORDER BY p.title ASC, s.name ASC`,
      params
    );

    const empty = {
      month, from, to, today,
      summary: { projects: 0, on_track: 0, attention: 0, at_risk: 0, overdue: 0, pending_approvals: 0, daily_pending: 0, content_delivery_pct: null },
      pipeline: { content: { ...emptyStages(), total: 0 }, shoots: { ...emptyStages(), total: 0 }, ads: { ...emptyStages(), total: 0 } },
      attention: [], rows: [],
    };
    if (!svcRows.length) return res.json(empty);

    const isPB = (name) => PB_NAMES.includes(String(name || '').toLowerCase());
    const rowsById = new Map();
    const defaultByProject = new Map(); // project → service that owns legacy (service-less) records
    svcRows.forEach(r => {
      rowsById.set(Number(r.project_service_id), {
        ...r,
        key: Number(r.project_service_id),
        is_personal_branding: isPB(r.service_name),
        commitment: null,
        content: { total: 0, stages: emptyStages(), overdue: 0, reels: { planned: 0, delivered: 0 }, posts: { planned: 0, delivered: 0 } },
        shoots: { total: 0, stages: emptyStages(), overdue: 0, footage_missing: 0 },
        ads: { slots: 0, stages: emptyStages(), campaigns: 0, active: 0, pending_approval: 0, report_pending: 0, completed: 0, budget: 0, spent: 0 },
        daily: { entries: 0, days: 0, escalations: 0, critical: 0, attention: 0, required_today: 0, submitted_today: 0, pending_today: [] },
      });
      const pid = Number(r.project_id);
      const cur = defaultByProject.get(pid);
      if (!cur || (!isPB(r.service_name) && isPB(cur.service_name))) defaultByProject.set(pid, r);
    });
    const projectIds = [...new Set(svcRows.map(r => Number(r.project_id)))];
    const svcIds = [...rowsById.keys()];

    const rowFor = (projectId, psId) => {
      if (psId && rowsById.has(Number(psId))) return rowsById.get(Number(psId));
      const d = defaultByProject.get(Number(projectId));
      return d ? rowsById.get(Number(d.project_service_id)) : null;
    };

    const attention = [];
    const addAttn = (row, type, severity, title, detail, date, link) => {
      attention.push({
        type, severity, title, detail: detail || null,
        date: date ? toDateStr(date) : null,
        project_id: row.project_id, project_title: row.project_title,
        service_name: row.service_name, project_service_id: row.project_service_id, link,
      });
    };
    const safe = async (label, fn) => { try { return await fn(); } catch (e) { console.warn(`Social board ${label} warning:`, e.message); return []; } };

    // ── 2. Allocation sheets (commitments) ──────────────────────────────────
    const sheets = await safe('allocation', async () => (await db.query(
      `SELECT * FROM project_allocation_sheets WHERE project_id IN (?)`, [projectIds]
    ))[0]);
    sheets.forEach(sh => {
      const row = sh.project_service_id ? rowsById.get(Number(sh.project_service_id)) : null;
      if (!row) return;
      row.commitment = {
        reels: Number(sh.commitment_reels) || 0,
        posts: Number(sh.commitment_static_posts) || 0,
        stories: sh.commitment_stories || null,
        shoot_sessions: parseJsonArr(sh.shoot_sessions),
        community: sh.community_management_frequency || null,
        ads_pre_report: !!sh.ads_pre_ad_report,
        ads_post_report: !!sh.ads_post_ad_report,
      };
    });

    // ── 3. Content (calendar post slots) ────────────────────────────────────
    const posts = await safe('posts', async () => (await db.query(
      `SELECT cp.id, cp.post_no, cp.format, cp.topic, cp.posting_date, cp.slot_status,
              p.project_id, sc.project_service_id,
              CONCAT(u.first_name, ' ', u.last_name) AS assignee
       FROM content_calendar_posts cp
       JOIN content_calendar_plans p ON p.id = cp.plan_id AND p.deleted = 0
       LEFT JOIN service_cycles sc ON sc.id = p.cycle_id
       LEFT JOIN users u ON u.id = cp.assigned_to
       WHERE cp.posting_date BETWEEN ? AND ? AND p.project_id IN (?)
         AND (cp.status IS NULL OR cp.status <> 'cancelled')`,
      [from, to, projectIds]
    ))[0]);
    posts.forEach(po => {
      const row = rowFor(po.project_id, po.project_service_id);
      if (!row) return;
      const st = normStage(po.slot_status);
      const c = row.content;
      c.total += 1; c.stages[st] += 1;
      const isReel = po.format === 'reel';
      const bucket = isReel ? c.reels : c.posts;
      bucket.planned += 1;
      if (DONE_STAGES.includes(st)) bucket.delivered += 1;
      const pd = toDateStr(po.posting_date);
      const label = `${po.post_no || 'Post'} · ${String(po.topic || '').slice(0, 70) || po.format}`;
      if (pd && pd < today && !DONE_STAGES.includes(st)) {
        c.overdue += 1;
        addAttn(row, 'content_overdue', 'high', label, `Posting date passed · ${st.replace('_', ' ')}${po.assignee ? ` · ${po.assignee}` : ''}`, pd, '/social/write-content');
      } else if (st === 'rejected') {
        addAttn(row, 'content_rework', 'medium', label, `Sent back for rework${po.assignee ? ` · ${po.assignee}` : ''}`, pd, '/social/write-content');
      }
    });

    // ── 4. Shoots ───────────────────────────────────────────────────────────
    const shootSlots = await safe('shoot slots', async () => (await db.query(
      `SELECT cs.id, cs.shoot_date, cs.slot_status, p.project_id, sc.project_service_id
       FROM content_calendar_shoots cs
       JOIN content_calendar_plans p ON p.id = cs.plan_id AND p.deleted = 0
       LEFT JOIN service_cycles sc ON sc.id = p.cycle_id
       WHERE cs.shoot_date BETWEEN ? AND ? AND p.project_id IN (?)
         AND (cs.status IS NULL OR cs.status <> 'cancelled')`,
      [from, to, projectIds]
    ))[0]);
    shootSlots.forEach(sl => {
      const row = rowFor(sl.project_id, sl.project_service_id);
      if (!row) return;
      const st = normStage(sl.slot_status);
      row.shoots.total += 1; row.shoots.stages[st] += 1;
    });

    const shootRows = await safe('shoots', async () => (await db.query(
      `SELECT id, shoot_id_code, project_campaign_name, shoot_date, status, footage_drive_link, project_id, project_service_id
       FROM shoots
       WHERE deleted = 0 AND status <> 'draft' AND shoot_date BETWEEN ? AND ? AND project_id IN (?)`,
      [from, to, projectIds]
    ))[0]);
    shootRows.forEach(sh => {
      const row = rowFor(sh.project_id, sh.project_service_id);
      if (!row) return;
      const sd = toDateStr(sh.shoot_date);
      const label = `${sh.shoot_id_code || 'Shoot'}${sh.project_campaign_name && sh.project_campaign_name !== 'TBD' ? ` · ${sh.project_campaign_name}` : ''}`;
      if (sh.status === 'pending_approval') addAttn(row, 'shoot_approval', 'medium', label, 'Waiting for shoot approval', sd, '/social/shoots');
      else if (sh.status === 'pending_completion') addAttn(row, 'shoot_close', 'medium', label, 'Close request waiting for approval', sd, '/social/shoots');
      else if (sh.status === 'rejected') addAttn(row, 'shoot_rework', 'medium', label, 'Rejected, needs changes', sd, '/social/shoots');
      else if (sh.status === 'approved' && sd && sd < today) {
        row.shoots.overdue += 1;
        addAttn(row, 'shoot_overdue', 'high', label, 'Shoot date passed and not closed', sd, '/social/shoots');
      } else if (sh.status === 'completed' && !sh.footage_drive_link) {
        row.shoots.footage_missing += 1;
        addAttn(row, 'shoot_footage', 'low', label, 'Completed, footage link not added', sd, '/social/shoots');
      }
    });

    // ── 5. Ads (Personal Branding has no ads) ───────────────────────────────
    const adSlots = await safe('ad slots', async () => (await db.query(
      `SELECT ca.id, ca.start_date, ca.slot_status, p.project_id, sc.project_service_id
       FROM content_calendar_ads ca
       JOIN content_calendar_plans p ON p.id = ca.plan_id AND p.deleted = 0
       LEFT JOIN service_cycles sc ON sc.id = p.cycle_id
       WHERE ca.start_date BETWEEN ? AND ? AND p.project_id IN (?)
         AND (ca.ad_status IS NULL OR ca.ad_status <> 'cancelled')`,
      [from, to, projectIds]
    ))[0]);
    adSlots.forEach(sl => {
      const row = rowFor(sl.project_id, sl.project_service_id);
      if (!row || row.is_personal_branding) return;
      const st = normStage(sl.slot_status);
      row.ads.slots += 1; row.ads.stages[st] += 1;
    });

    const campaigns = await safe('campaigns', async () => (await db.query(
      `SELECT ac.id, ac.campaign_id_code, ac.campaign_name, ac.status, ac.budget, ac.start_date, ac.end_date,
              ac.project_id, acr.amount_spent
       FROM ad_campaigns ac
       LEFT JOIN ad_campaign_reports acr ON acr.campaign_id = ac.id
       WHERE ac.deleted = 0 AND ac.project_id IN (?) AND ac.status <> 'draft'
         AND ac.start_date IS NOT NULL AND ac.start_date <= ?
         AND COALESCE(ac.end_date, ac.start_date) >= ?`,
      [projectIds, to, from]
    ))[0]);
    campaigns.forEach(ac => {
      // Campaigns carry no service id: they belong to the project's SMM service
      const row = rowFor(ac.project_id, null);
      if (!row || row.is_personal_branding) return;
      const a = row.ads;
      a.campaigns += 1;
      a.budget += Number(ac.budget) || 0;
      a.spent += Number(ac.amount_spent) || 0;
      const label = `${ac.campaign_id_code || 'Campaign'} · ${ac.campaign_name || ''}`.trim();
      const ed = toDateStr(ac.end_date);
      if (ac.status === 'active') a.active += 1;
      if (ac.status === 'completed') a.completed += 1;
      if (ac.status === 'pending_approval') { a.pending_approval += 1; addAttn(row, 'ad_approval', 'medium', label, 'Campaign waiting for approval', ac.start_date, '/social/ads'); }
      else if (ac.status === 'report_pending') { a.report_pending += 1; addAttn(row, 'ad_report', 'medium', label, 'Closing report waiting for approval', ac.end_date, '/social/ads'); }
      else if (['approved', 'active', 'paused'].includes(ac.status) && ed && ed < today) {
        addAttn(row, 'ad_overdue', 'high', label, 'End date passed, closing report not submitted', ed, '/social/ads');
      }
    });

    // ── 6. Daily Updates ────────────────────────────────────────────────────
    const journals = await safe('daily', async () => (await db.query(
      `SELECT project_service_id, COUNT(*) AS entries, COUNT(DISTINCT journal_date) AS days,
              SUM(escalation_required = 'yes') AS escalations,
              SUM(health_status = 'critical') AS critical,
              SUM(health_status = 'attention_needed') AS attention
       FROM smm_daily_journal
       WHERE journal_date BETWEEN ? AND ? AND project_service_id IN (?)
       GROUP BY project_service_id`,
      [from, to, svcIds]
    ))[0]);
    journals.forEach(j => {
      const row = rowsById.get(Number(j.project_service_id));
      if (!row) return;
      row.daily.entries = Number(j.entries) || 0;
      row.daily.days = Number(j.days) || 0;
      row.daily.escalations = Number(j.escalations) || 0;
      row.daily.critical = Number(j.critical) || 0;
      row.daily.attention = Number(j.attention) || 0;
    });
    // "Submitted today" only makes sense for the current month
    if (today >= from && today <= to) {
      const required = await safe('daily required', () => requiredServices(null));
      const done = await submittedKeys(today, null);
      required.forEach(r => {
        const row = rowsById.get(Number(r.project_service_id));
        if (!row) return;
        row.daily.required_today += 1;
        if (done.has(`${Number(r.user_id)}:${Number(r.project_service_id)}`)) row.daily.submitted_today += 1;
        else {
          row.daily.pending_today.push(r.user_name);
          addAttn(row, 'daily_missing', 'medium', r.user_name, 'Daily Update not submitted today', today, '/social/daily-journal');
        }
      });
    }

    // ── 7. Per-row roll-up: stage % + health ────────────────────────────────
    const pipeline = { content: { ...emptyStages(), total: 0 }, shoots: { ...emptyStages(), total: 0 }, ads: { ...emptyStages(), total: 0 } };
    const pending = (st) => st.submitted + st.smm_approved;
    const summary = { projects: 0, on_track: 0, attention: 0, at_risk: 0, overdue: 0, pending_approvals: 0, daily_pending: 0, content_delivery_pct: null };
    let planned = 0, delivered = 0;

    // Month filter: keep a service only if it runs in the month or has activity in it
    const inMonth = (row) => {
      const sStart = toDateStr(row.service_start);
      const sEnd = toDateStr(row.service_end);
      const runs = (!sStart || sStart <= to) && (!sEnd || sEnd >= from);
      const activity = row.content.total + row.shoots.total + row.ads.slots + row.ads.campaigns + row.daily.entries > 0;
      return runs || activity;
    };
    const keep = new Set([...rowsById.values()].filter(inMonth).map(r => r.key));
    for (let i = attention.length - 1; i >= 0; i--) {
      if (!keep.has(attention[i].project_service_id)) attention.splice(i, 1);
    }

    const rows = [...rowsById.values()].filter(r => keep.has(r.key)).map(row => {
      const c = row.content;
      const delivered_n = c.reels.delivered + c.posts.delivered;
      const planned_n = c.reels.planned + c.posts.planned;
      c.delivered = delivered_n; c.planned = planned_n;
      c.pending_review = pending(c.stages);
      const commitReels = row.commitment?.reels || 0;
      const commitPosts = row.commitment?.posts || 0;
      c.commit_total = commitReels + commitPosts;
      c.commit_pct = c.commit_total ? Math.min(100, Math.round((delivered_n / c.commit_total) * 100)) : null;
      c.planned_pct = c.commit_total ? Math.min(100, Math.round((planned_n / c.commit_total) * 100)) : null;

      const sh = row.shoots;
      sh.pending_review = sh.stages.submitted + sh.stages.smm_approved;
      sh.done = sh.stages.completed;
      sh.commit_total = row.commitment?.shoot_sessions?.length || 0;

      const a = row.ads;
      a.pending_review = a.pending_approval + a.report_pending;

      const overdue = c.overdue + sh.overdue + attention.filter(x => x.type === 'ad_overdue' && x.project_service_id === row.project_service_id).length;
      row.overdue = overdue;
      const rework = c.stages.rejected + sh.stages.rejected;
      const pendingApprovals = c.pending_review + sh.pending_review + a.pending_review;
      row.pending_approvals = pendingApprovals;

      let health = 'on_track';
      if (overdue >= 3 || row.daily.escalations > 0 || row.daily.critical > 0) health = 'at_risk';
      else if (overdue > 0 || rework > 0 || row.daily.pending_today.length > 0 || row.daily.attention > 0) health = 'attention';
      row.health = health;

      summary.projects += 1;
      summary[health] += 1;
      summary.overdue += overdue;
      summary.pending_approvals += pendingApprovals;
      summary.daily_pending += row.daily.pending_today.length;
      planned += c.planned; delivered += c.delivered;
      STAGES.forEach(s => { pipeline.content[s] += c.stages[s]; pipeline.shoots[s] += sh.stages[s]; pipeline.ads[s] += a.stages[s]; });
      pipeline.content.total += c.total; pipeline.shoots.total += sh.total; pipeline.ads.total += a.slots;
      return row;
    });
    summary.content_delivery_pct = planned ? Math.round((delivered / planned) * 100) : null;

    attention.sort((x, y) =>
      (SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity]) ||
      String(x.date || '9999').localeCompare(String(y.date || '9999')));

    const order = { at_risk: 0, attention: 1, on_track: 2 };
    rows.sort((x, y) => order[x.health] - order[y.health] || String(x.project_title).localeCompare(String(y.project_title)));

    return res.json({
      month, from, to, today, summary, pipeline,
      attention: attention.slice(0, 300),
      attention_total: attention.length,
      rows,
    });
  } catch (err) {
    console.error('Social overview getBoard error:', err.message, err.sql || '');
    return res.status(500).json({ message: 'Server error', error: err.message });
  }
};
