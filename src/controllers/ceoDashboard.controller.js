const db = require('../config/db');

/**
 * GET /api/ceo-dashboard/overview
 *
 * Executive snapshot for the CEO. Month-to-date (MTD) figures are compared with
 * the SAME period of last month (1st → same day), so the % change is fair.
 *
 * Sections:
 *   period        — date boundaries used
 *   kpis          — headline business numbers with previous-period values
 *   sales         — leads / clients / quotations / win rate
 *   operations    — projects, tasks, tickets
 *   people        — headcount & today's attendance
 *   attention     — things that need the CEO's eye (overdue, pending approvals)
 *   monthly_trend — last 6 months revenue / expenses / payroll / net profit
 *
 * Every query is wrapped so a missing table/column returns zeros instead of
 * failing the whole dashboard.
 */
exports.getOverview = async (req, res) => {
  async function safeQuery(sql, params = []) {
    try {
      const [rows] = await db.query(sql, params);
      return rows;
    } catch (err) {
      console.error('CEO Dashboard query failed:', err.message, sql.slice(0, 120));
      return null;
    }
  }
  const num = (v) => parseFloat(v || 0) || 0;
  const int = (v) => parseInt(v || 0, 10) || 0;

  try {
    // ── Period boundaries (from the DB clock, consistent with other dashboards) ──
    const periodRows = await safeQuery(
      `SELECT
         DATE_FORMAT(CURDATE(), '%Y-%m-01')                               AS m_start,
         CURDATE()                                                        AS m_end,
         DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-01')   AS p_start,
         DATE_SUB(CURDATE(), INTERVAL 1 MONTH)                            AS p_end,
         YEAR(CURDATE())                                                  AS cur_year,
         MONTH(CURDATE())                                                 AS cur_month,
         YEAR(DATE_SUB(CURDATE(), INTERVAL 1 MONTH))                      AS prev_year,
         MONTH(DATE_SUB(CURDATE(), INTERVAL 1 MONTH))                     AS prev_month`
    );
    const p = periodRows?.[0];
    if (!p) return res.status(500).json({ message: 'Server error: could not resolve period' });
    const { m_start, m_end, p_start, p_end, cur_year, cur_month, prev_year, prev_month } = p;

    // ═════════════════════════════════════════════════════════════════════════
    // 1. REVENUE (invoices by bill_date — same basis as Finance dashboard)
    // ═════════════════════════════════════════════════════════════════════════
    const revRows = await safeQuery(
      `SELECT
         COALESCE(SUM(CASE WHEN bill_date BETWEEN ? AND ? THEN total_amount END), 0) AS invoiced_cur,
         COALESCE(SUM(CASE WHEN bill_date BETWEEN ? AND ? THEN paid_amount  END), 0) AS collected_cur,
         COALESCE(SUM(CASE WHEN bill_date BETWEEN ? AND ? THEN total_amount END), 0) AS invoiced_prev,
         COALESCE(SUM(CASE WHEN bill_date BETWEEN ? AND ? THEN paid_amount  END), 0) AS collected_prev
       FROM invoices
       WHERE deleted = 0`,
      [m_start, m_end, m_start, m_end, p_start, p_end, p_start, p_end]
    );
    const rev = revRows?.[0] || {};

    const outstandingRows = await safeQuery(
      `SELECT
         COALESCE(SUM(balance_amount), 0)                                               AS outstanding,
         COALESCE(SUM(CASE WHEN due_date < CURDATE() THEN balance_amount END), 0)        AS overdue_amount,
         SUM(CASE WHEN due_date < CURDATE() THEN 1 ELSE 0 END)                           AS overdue_count
       FROM invoices
       WHERE deleted = 0 AND balance_amount > 0`
    );
    const out = outstandingRows?.[0] || {};

    // ═════════════════════════════════════════════════════════════════════════
    // 2. EXPENSES + PAYROLL
    // ═════════════════════════════════════════════════════════════════════════
    const expRows = await safeQuery(
      `SELECT
         COALESCE(SUM(CASE WHEN expense_date BETWEEN ? AND ? THEN amount END), 0) AS exp_cur,
         COALESCE(SUM(CASE WHEN expense_date BETWEEN ? AND ? THEN amount END), 0) AS exp_prev
       FROM expenses
       WHERE deleted = 0`,
      [m_start, m_end, p_start, p_end]
    );
    const exp = expRows?.[0] || {};

    // Payroll is monthly, so compare full current month vs full previous month
    const payRows = await safeQuery(
      `SELECT
         COALESCE(SUM(CASE WHEN pay_year = ? AND pay_month = ? THEN net_salary END), 0) AS pay_cur,
         COALESCE(SUM(CASE WHEN pay_year = ? AND pay_month = ? THEN net_salary END), 0) AS pay_prev
       FROM payroll
       WHERE deleted = 0 AND status = 'Paid'`,
      [cur_year, cur_month, prev_year, prev_month]
    );
    const pay = payRows?.[0] || {};

    const collectedCur  = num(rev.collected_cur);
    const collectedPrev = num(rev.collected_prev);
    const expCur  = num(exp.exp_cur);
    const expPrev = num(exp.exp_prev);
    const payCur  = num(pay.pay_cur);
    const payPrev = num(pay.pay_prev);
    const netCur  = Math.round((collectedCur - expCur - payCur) * 100) / 100;
    const netPrev = Math.round((collectedPrev - expPrev - payPrev) * 100) / 100;

    // ═════════════════════════════════════════════════════════════════════════
    // 3. SALES — leads, clients, quotations, win rate
    // ═════════════════════════════════════════════════════════════════════════
    const leadRows = await safeQuery(
      `SELECT
         COUNT(*)                                                                    AS total_leads,
         SUM(CASE WHEN DATE(created_at) BETWEEN ? AND ? THEN 1 ELSE 0 END)           AS new_cur,
         SUM(CASE WHEN DATE(created_at) BETWEEN ? AND ? THEN 1 ELSE 0 END)           AS new_prev,
         SUM(CASE WHEN status = 'Won' OR lead_stage = 'Won' THEN 1 ELSE 0 END)       AS total_clients,
         SUM(CASE WHEN (status = 'Won' OR lead_stage = 'Won')
                   AND DATE(converted_at) BETWEEN ? AND ? THEN 1 ELSE 0 END)         AS won_cur,
         SUM(CASE WHEN (status = 'Won' OR lead_stage = 'Won')
                   AND DATE(converted_at) BETWEEN ? AND ? THEN 1 ELSE 0 END)         AS won_prev,
         SUM(CASE WHEN status IN ('Won', 'Converted') THEN 1 ELSE 0 END)             AS won_all,
         SUM(CASE WHEN status = 'Lost' THEN 1 ELSE 0 END)                            AS lost_all
       FROM leads
       WHERE deleted = 0`,
      [m_start, m_end, p_start, p_end, m_start, m_end, p_start, p_end]
    );
    const ld = leadRows?.[0] || {};
    const wonAll = int(ld.won_all);
    const lostAll = int(ld.lost_all);
    const winRate = wonAll + lostAll > 0 ? Math.round((wonAll / (wonAll + lostAll)) * 100) : 0;

    const quoteRows = await safeQuery(
      `SELECT
         SUM(CASE WHEN status = 'Sent' THEN 1 ELSE 0 END)                                   AS sent_count,
         COALESCE(SUM(CASE WHEN status = 'Sent' THEN investment_amount END), 0)             AS sent_value,
         SUM(CASE WHEN status = 'Accepted' AND DATE(created_at) BETWEEN ? AND ? THEN 1 ELSE 0 END) AS accepted_cur,
         COALESCE(SUM(CASE WHEN status = 'Accepted' AND DATE(created_at) BETWEEN ? AND ? THEN investment_amount END), 0) AS accepted_value_cur
       FROM quotations
       WHERE deleted = 0`,
      [m_start, m_end, m_start, m_end]
    );
    const qt = quoteRows?.[0] || {};

    // ═════════════════════════════════════════════════════════════════════════
    // 4. OPERATIONS — projects, tasks, tickets
    // ═════════════════════════════════════════════════════════════════════════
    const projRows = await safeQuery(
      `SELECT
         SUM(CASE WHEN status IN ('open', 'in_progress') THEN 1 ELSE 0 END)                          AS active,
         SUM(CASE WHEN status IN ('open', 'in_progress') AND end_date < CURDATE() THEN 1 ELSE 0 END) AS delayed,
         SUM(CASE WHEN status IN ('completed', 'done', 'closed', 'inactive') THEN 1 ELSE 0 END)     AS completed,
         COUNT(*)                                                                                    AS total
       FROM projects
       WHERE deleted = 0`
    );
    const pr = projRows?.[0] || {};

    const taskRows = await safeQuery(
      `SELECT
         COUNT(*)                                                                    AS active,
         SUM(CASE WHEN deadline < CURDATE() AND status != 'done' THEN 1 ELSE 0 END)  AS overdue,
         SUM(CASE WHEN status = 'done' AND DATE(updated_at) BETWEEN ? AND ? THEN 1 ELSE 0 END) AS done_cur
       FROM tasks
       WHERE deleted = 0 AND is_active = 1`,
      [m_start, m_end]
    );
    const tk = taskRows?.[0] || {};

    const ticketRows = await safeQuery(
      `SELECT
         SUM(CASE WHEN status NOT IN ('resolved', 'closed') THEN 1 ELSE 0 END)                         AS open_count,
         SUM(CASE WHEN status NOT IN ('resolved', 'closed') AND priority = 'critical' THEN 1 ELSE 0 END) AS critical,
         SUM(CASE WHEN status NOT IN ('resolved', 'closed') AND due_date < CURDATE() THEN 1 ELSE 0 END) AS overdue
       FROM tickets
       WHERE deleted = 0`
    );
    const tc = ticketRows?.[0] || {};

    // ═════════════════════════════════════════════════════════════════════════
    // 5. PEOPLE — headcount and today's attendance (non-admin active users)
    // ═════════════════════════════════════════════════════════════════════════
    const headRows = await safeQuery(
      `SELECT COUNT(*) AS total FROM users WHERE is_active = 1 AND deleted = 0 AND is_admin = 0`
    );
    const attRows = await safeQuery(
      `SELECT
         COUNT(*)                                                    AS present,
         SUM(CASE WHEN a.clock_in_status = 'late' THEN 1 ELSE 0 END) AS late
       FROM attendance a
       JOIN users u ON u.id = a.user_id
       WHERE a.date = CURDATE() AND u.is_admin = 0 AND u.is_active = 1 AND u.deleted = 0`
    );
    const leaveRows = await safeQuery(
      `SELECT COUNT(DISTINCT l.user_id) AS on_leave
       FROM leaves l
       JOIN users u ON u.id = l.user_id
       WHERE l.status = 'approved' AND l.deleted = 0
         AND CURDATE() BETWEEN l.from_date AND l.to_date
         AND u.is_admin = 0 AND u.is_active = 1 AND u.deleted = 0`
    );
    const headcount = int(headRows?.[0]?.total);
    const present   = int(attRows?.[0]?.present);
    const onLeave   = int(leaveRows?.[0]?.on_leave);

    // ═════════════════════════════════════════════════════════════════════════
    // 6. NEEDS ATTENTION — pending approvals
    // ═════════════════════════════════════════════════════════════════════════
    const apprRows = await safeQuery(
      `SELECT
         (SELECT COUNT(*) FROM tasks          WHERE is_active = 0 AND deleted = 0)        AS tasks,
         (SELECT COUNT(*) FROM leaves         WHERE status = 'pending' AND deleted = 0)  AS leaves,
         (SELECT COUNT(*) FROM reimbursements WHERE status = 'pending' AND deleted = 0)  AS reimbursements`
    );
    const ap = apprRows?.[0] || {};

    // ═════════════════════════════════════════════════════════════════════════
    // 7. MONTHLY TREND — last 6 months (including current)
    // ═════════════════════════════════════════════════════════════════════════
    const trendRevenue = await safeQuery(
      `SELECT DATE_FORMAT(bill_date, '%Y-%m') AS month,
              COALESCE(SUM(paid_amount), 0)   AS revenue,
              COALESCE(SUM(total_amount), 0)  AS invoiced
       FROM invoices
       WHERE deleted = 0
         AND bill_date >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 5 MONTH), '%Y-%m-01')
       GROUP BY DATE_FORMAT(bill_date, '%Y-%m')`
    ) || [];
    const trendExpenses = await safeQuery(
      `SELECT DATE_FORMAT(expense_date, '%Y-%m') AS month, COALESCE(SUM(amount), 0) AS expenses
       FROM expenses
       WHERE deleted = 0
         AND expense_date >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 5 MONTH), '%Y-%m-01')
       GROUP BY DATE_FORMAT(expense_date, '%Y-%m')`
    ) || [];
    const trendPayroll = await safeQuery(
      `SELECT CONCAT(pay_year, '-', LPAD(pay_month, 2, '0')) AS month, COALESCE(SUM(net_salary), 0) AS payroll
       FROM payroll
       WHERE deleted = 0 AND status = 'Paid'
         AND STR_TO_DATE(CONCAT(pay_year, '-', LPAD(pay_month, 2, '0'), '-01'), '%Y-%m-%d')
             >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 5 MONTH), '%Y-%m-01')
       GROUP BY pay_year, pay_month`
    ) || [];

    // Build a continuous list of the last 6 months so empty months still appear
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Number(cur_year), Number(cur_month) - 1 - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    const byMonth = (rows, key) => Object.fromEntries(rows.map((r) => [r.month, num(r[key])]));
    const revMap = byMonth(trendRevenue, 'revenue');
    const invMap = byMonth(trendRevenue, 'invoiced');
    const expMap = byMonth(trendExpenses, 'expenses');
    const payMap = byMonth(trendPayroll, 'payroll');
    const monthly_trend = months.map((m) => {
      const revenue  = revMap[m] || 0;
      const expenses = expMap[m] || 0;
      const payroll  = payMap[m] || 0;
      return {
        month: m,
        revenue,
        invoiced: invMap[m] || 0,
        expenses,
        payroll,
        net_profit: Math.round((revenue - expenses - payroll) * 100) / 100,
      };
    });

    // ═════════════════════════════════════════════════════════════════════════
    // RESPONSE
    // ═════════════════════════════════════════════════════════════════════════
    return res.json({
      period: { m_start, m_end, p_start, p_end },
      kpis: {
        revenue:      { current: collectedCur, previous: collectedPrev },
        invoiced:     { current: num(rev.invoiced_cur), previous: num(rev.invoiced_prev) },
        expenses:     { current: expCur, previous: expPrev },
        payroll:      { current: payCur, previous: payPrev },
        net_profit:   { current: netCur, previous: netPrev },
        outstanding:  num(out.outstanding),
        overdue_amount: num(out.overdue_amount),
        overdue_invoices: int(out.overdue_count),
      },
      sales: {
        total_leads:   int(ld.total_leads),
        new_leads:     { current: int(ld.new_cur), previous: int(ld.new_prev) },
        total_clients: int(ld.total_clients),
        new_clients:   { current: int(ld.won_cur), previous: int(ld.won_prev) },
        win_rate:      winRate,
        quotations_sent:          int(qt.sent_count),
        quotations_sent_value:    num(qt.sent_value),
        quotations_accepted:      int(qt.accepted_cur),
        quotations_accepted_value: num(qt.accepted_value_cur),
      },
      operations: {
        projects: { active: int(pr.active), delayed: int(pr.delayed), completed: int(pr.completed), total: int(pr.total) },
        tasks:    { active: int(tk.active), overdue: int(tk.overdue), done_this_month: int(tk.done_cur) },
        tickets:  { open: int(tc.open_count), critical: int(tc.critical), overdue: int(tc.overdue) },
      },
      people: {
        headcount,
        present_today: present,
        late_today:    int(attRows?.[0]?.late),
        on_leave_today: onLeave,
        absent_today:  Math.max(0, headcount - present - onLeave),
      },
      attention: {
        pending_approvals: {
          tasks: int(ap.tasks),
          leaves: int(ap.leaves),
          reimbursements: int(ap.reimbursements),
          total: int(ap.tasks) + int(ap.leaves) + int(ap.reimbursements),
        },
      },
      monthly_trend,
    });
  } catch (err) {
    console.error('CEO Dashboard getOverview fatal error:', err);
    return res.status(500).json({ message: 'Server error: ' + err.message });
  }
};
