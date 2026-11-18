const db = require('../config/db');

/**
 * GET /api/sales-dashboard/overview
 *
 * Sales snapshot. Scope comes from the dashboard_sales submenu level:
 *   'own' -> only leads assigned to / created by the user, their meetings and follow-ups
 *   'all' -> whole team (also returns the per-salesperson leaderboard)
 *
 * Month-to-date figures are compared with the same period of last month.
 * Every query is wrapped so a missing table/column returns zeros instead of
 * failing the whole dashboard.
 */
exports.getOverview = async (req, res) => {
  async function safeQuery(sql, params = []) {
    try {
      const [rows] = await db.query(sql, params);
      return rows;
    } catch (err) {
      console.error('Sales Dashboard query failed:', err.message, sql.slice(0, 120));
      return null;
    }
  }
  const num = (v) => parseFloat(v || 0) || 0;
  const int = (v) => parseInt(v || 0, 10) || 0;

  try {
    const uid = req.user.id;
    const isAll = req.salesScope === 'all';

    // Scope fragments (all parameterised)
    const leadScope = isAll ? '' : ' AND (l.assigned_to = ? OR l.created_by = ?)';
    const leadScopeParams = isAll ? [] : [uid, uid];
    const meetScope = isAll ? '' : ' AND sm.created_by = ?';
    const meetScopeParams = isAll ? [] : [uid];

    const periodRows = await safeQuery(
      `SELECT
         DATE_FORMAT(CURDATE(), '%Y-%m-01')                               AS m_start,
         CURDATE()                                                        AS m_end,
         DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-01')   AS p_start,
         DATE_SUB(CURDATE(), INTERVAL 1 MONTH)                            AS p_end`
    );
    const { m_start, m_end, p_start, p_end } = periodRows?.[0] || {};

    // ── KPIs: leads ──────────────────────────────────────────────────────────
    const leadRows = await safeQuery(
      `SELECT
         COUNT(*)                                                                  AS total_leads,
         SUM(CASE WHEN DATE(l.created_at) BETWEEN ? AND ? THEN 1 ELSE 0 END)       AS new_cur,
         SUM(CASE WHEN DATE(l.created_at) BETWEEN ? AND ? THEN 1 ELSE 0 END)       AS new_prev,
         SUM(CASE WHEN (l.status = 'Won' OR l.lead_stage = 'Won')
                   AND DATE(l.converted_at) BETWEEN ? AND ? THEN 1 ELSE 0 END)     AS won_cur,
         SUM(CASE WHEN (l.status = 'Won' OR l.lead_stage = 'Won')
                   AND DATE(l.converted_at) BETWEEN ? AND ? THEN 1 ELSE 0 END)     AS won_prev,
         SUM(CASE WHEN l.status IN ('Won', 'Converted') THEN 1 ELSE 0 END)         AS won_all,
         SUM(CASE WHEN l.status = 'Lost' THEN 1 ELSE 0 END)                        AS lost_all
       FROM leads l
       WHERE l.deleted = 0${leadScope}`,
      [m_start, m_end, p_start, p_end, m_start, m_end, p_start, p_end, ...leadScopeParams]
    );
    const ld = leadRows?.[0] || {};
    const wonAll = int(ld.won_all);
    const lostAll = int(ld.lost_all);
    const conversionRate = wonAll + lostAll > 0 ? Math.round((wonAll / (wonAll + lostAll)) * 100) : 0;

    // ── KPIs: meetings ───────────────────────────────────────────────────────
    const meetKpiRows = await safeQuery(
      `SELECT
         SUM(sm.meeting_date BETWEEN ? AND ?) AS booked_cur,
         SUM(sm.meeting_date BETWEEN ? AND ?) AS booked_prev
       FROM sales_meetings sm
       WHERE sm.deleted = 0${meetScope}`,
      [m_start, m_end, p_start, p_end, ...meetScopeParams]
    );
    const mk = meetKpiRows?.[0] || {};

    // ── KPIs: revenue collected from invoices of in-scope leads ──────────────
    const revRows = await safeQuery(
      `SELECT
         COALESCE(SUM(CASE WHEN i.bill_date BETWEEN ? AND ? THEN i.paid_amount END), 0) AS collected_cur,
         COALESCE(SUM(CASE WHEN i.bill_date BETWEEN ? AND ? THEN i.paid_amount END), 0) AS collected_prev,
         COALESCE(SUM(i.balance_amount), 0)                                             AS outstanding
       FROM invoices i
       JOIN leads l ON l.id = i.lead_id
       WHERE i.deleted = 0${leadScope}`,
      [m_start, m_end, p_start, p_end, ...leadScopeParams]
    );
    const rv = revRows?.[0] || {};

    // ── Pipeline by stage ────────────────────────────────────────────────────
    const stageRows = await safeQuery(
      `SELECT COALESCE(NULLIF(l.lead_stage, ''), l.status, 'Unknown') AS stage,
              COUNT(*)                                                AS count,
              COALESCE(SUM(l.expected_revenue), 0)                    AS value
       FROM leads l
       WHERE l.deleted = 0${leadScope}
       GROUP BY stage
       ORDER BY count DESC`,
      leadScopeParams
    ) || [];

    // ── Meetings: counts + upcoming list ─────────────────────────────────────
    const meetCountRows = await safeQuery(
      `SELECT
         SUM(sm.meeting_date = CURDATE())                                             AS today,
         SUM(sm.meeting_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 6 DAY)) AS next_7_days,
         SUM(sm.pre_confirmed = 1)                                                    AS confirmed,
         COUNT(*)                                                                     AS upcoming
       FROM sales_meetings sm
       WHERE sm.deleted = 0 AND sm.outcome = 'pending' AND sm.meeting_date >= CURDATE()${meetScope}`,
      meetScopeParams
    );
    const mc = meetCountRows?.[0] || {};

    const upcomingMeetings = await safeQuery(
      `SELECT sm.id, sm.title, sm.meeting_date, sm.slot, sm.mode, sm.pre_confirmed,
              COALESCE(l.business_name, l.name) AS client_name,
              l.lead_stage,
              CONCAT(u.first_name, ' ', u.last_name) AS booked_by
         FROM sales_meetings sm
         LEFT JOIN leads l ON l.id = sm.lead_id
         LEFT JOIN users u ON u.id = sm.created_by
        WHERE sm.deleted = 0 AND sm.outcome = 'pending' AND sm.meeting_date >= CURDATE()${meetScope}
        ORDER BY sm.meeting_date ASC, FIELD(sm.slot, 'morning', 'afternoon', 'evening')
        LIMIT 10`,
      meetScopeParams
    ) || [];

    // ── Follow-ups: latest follow-up per open lead that has a scheduled date ──
    const followRows = await safeQuery(
      `SELECT f.id, f.lead_id, f.type, f.note, f.follow_up_date,
              COALESCE(l.business_name, l.name) AS lead_name,
              l.lead_stage,
              CONCAT(u.first_name, ' ', u.last_name) AS owner_name
         FROM lead_follow_ups f
         JOIN leads l ON l.id = f.lead_id
         LEFT JOIN users u ON u.id = COALESCE(l.assigned_to, l.created_by)
        WHERE l.deleted = 0
          AND COALESCE(l.status, '') NOT IN ('Won', 'Lost', 'Converted')
          AND COALESCE(l.lead_stage, '') NOT IN ('Won', 'Lost')
          AND f.follow_up_date IS NOT NULL
          AND f.follow_up_date < DATE_ADD(CURDATE(), INTERVAL 1 DAY)
          AND f.id = (SELECT MAX(f2.id) FROM lead_follow_ups f2 WHERE f2.lead_id = f.lead_id)${leadScope}
        ORDER BY f.follow_up_date ASC
        LIMIT 15`,
      leadScopeParams
    ) || [];
    const followUps = followRows.map((r) => ({
      ...r,
      is_overdue: new Date(r.follow_up_date) < new Date(new Date().setHours(0, 0, 0, 0)),
    }));

    // ── Lead sources (won deals) ─────────────────────────────────────────────
    const sources = await safeQuery(
      `SELECT COALESCE(NULLIF(l.source, ''), 'Unknown') AS source,
              COUNT(*)                                  AS leads,
              SUM(CASE WHEN l.status IN ('Won', 'Converted') OR l.lead_stage = 'Won' THEN 1 ELSE 0 END) AS won
         FROM leads l
        WHERE l.deleted = 0${leadScope}
        GROUP BY source
        ORDER BY leads DESC
        LIMIT 8`,
      leadScopeParams
    ) || [];

    // ── Leaderboard (team scope only) ────────────────────────────────────────
    let leaderboard = [];
    if (isAll) {
      leaderboard = await safeQuery(
        `SELECT u.id, CONCAT(u.first_name, ' ', u.last_name) AS name, u.avatar_url,
                COALESCE(ls.leads_cur, 0) AS leads_cur,
                COALESCE(ls.won_cur, 0)   AS won_cur,
                COALESCE(ms.meetings_cur, 0) AS meetings_cur
           FROM users u
           LEFT JOIN (
             SELECT COALESCE(assigned_to, created_by) AS owner_id,
                    SUM(DATE(created_at) BETWEEN ? AND ?) AS leads_cur,
                    SUM((status = 'Won' OR lead_stage = 'Won') AND DATE(converted_at) BETWEEN ? AND ?) AS won_cur
               FROM leads WHERE deleted = 0
              GROUP BY owner_id
           ) ls ON ls.owner_id = u.id
           LEFT JOIN (
             SELECT created_by, COUNT(*) AS meetings_cur
               FROM sales_meetings
              WHERE deleted = 0 AND meeting_date BETWEEN ? AND ?
              GROUP BY created_by
           ) ms ON ms.created_by = u.id
          WHERE u.deleted = 0 AND u.is_active = 1
            AND (COALESCE(ls.leads_cur, 0) + COALESCE(ls.won_cur, 0) + COALESCE(ms.meetings_cur, 0)) > 0
          ORDER BY won_cur DESC, meetings_cur DESC, leads_cur DESC
          LIMIT 10`,
        [m_start, m_end, m_start, m_end, m_start, m_end]
      ) || [];
    }

    res.json({
      scope: isAll ? 'all' : 'own',
      period: { m_start, m_end, p_start, p_end },
      kpis: {
        new_leads: { cur: int(ld.new_cur), prev: int(ld.new_prev) },
        meetings_booked: { cur: int(mk.booked_cur), prev: int(mk.booked_prev) },
        won_deals: { cur: int(ld.won_cur), prev: int(ld.won_prev) },
        revenue_collected: { cur: num(rv.collected_cur), prev: num(rv.collected_prev) },
        conversion_rate: conversionRate,
        total_leads: int(ld.total_leads),
        outstanding: num(rv.outstanding),
      },
      pipeline: stageRows.map((r) => ({ stage: r.stage, count: int(r.count), value: num(r.value) })),
      meetings: {
        today: int(mc.today),
        next_7_days: int(mc.next_7_days),
        confirmed: int(mc.confirmed),
        upcoming: int(mc.upcoming),
        list: upcomingMeetings,
      },
      follow_ups: followUps,
      sources: sources.map((r) => ({ source: r.source, leads: int(r.leads), won: int(r.won) })),
      leaderboard: leaderboard.map((r) => ({
        id: r.id,
        name: r.name,
        avatar_url: r.avatar_url,
        leads: int(r.leads_cur),
        won: int(r.won_cur),
        meetings: int(r.meetings_cur),
      })),
    });
  } catch (err) {
    console.error('Sales Dashboard error:', err);
    res.status(500).json({ message: 'Failed to load sales dashboard' });
  }
};
