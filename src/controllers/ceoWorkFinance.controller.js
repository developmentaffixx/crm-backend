const db = require('../config/db');

const num = (v) => parseFloat(v || 0) || 0;
const int = (v) => parseInt(v || 0, 10) || 0;

/** Runs a query; a missing table/column returns null instead of failing the whole response. */
async function safeQuery(sql, params = []) {
  try {
    const [rows] = await db.query(sql, params);
    return rows;
  } catch (err) {
    console.error('CEO work/finance query failed:', err.message, sql.slice(0, 100).replace(/\s+/g, ' '));
    return null;
  }
}

const TASK_OPEN = "t.deleted = 0 AND t.is_active = 1 AND t.status <> 'done'";
const TICKET_OPEN = "tk.deleted = 0 AND tk.status NOT IN ('resolved', 'closed')";

async function taskSummary() {
  const [counts, list] = await Promise.all([
    safeQuery(
      `SELECT COUNT(*) AS open_count,
              COALESCE(SUM(t.deadline < CURDATE()), 0) AS overdue,
              COALESCE(SUM(t.deadline = CURDATE()), 0) AS due_today,
              (SELECT COUNT(*) FROM tasks d WHERE d.deleted = 0 AND d.is_active = 1 AND d.status = 'done'
                 AND d.updated_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)) AS done_week
         FROM tasks t WHERE ${TASK_OPEN}`
    ),
    safeQuery(
      `SELECT t.id, t.task_id_code AS code, t.title, t.priority, t.deadline AS due_date,
              DATEDIFF(CURDATE(), t.deadline) AS days_overdue,
              CONCAT(u.first_name, ' ', u.last_name) AS assignee
         FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to
        WHERE ${TASK_OPEN} AND t.deadline < CURDATE()
        ORDER BY FIELD(t.priority, 'high', 'medium', 'low'), t.deadline ASC
        LIMIT 8`
    ),
  ]);
  const c = counts?.[0] || {};
  return {
    open: int(c.open_count), overdue: int(c.overdue), due_today: int(c.due_today), done_week: int(c.done_week),
    list: list || [],
  };
}

async function ticketSummary() {
  const [counts, list] = await Promise.all([
    safeQuery(
      `SELECT COUNT(*) AS open_count,
              COALESCE(SUM(tk.priority = 'critical'), 0) AS critical,
              COALESCE(SUM(tk.due_date < CURDATE()), 0)  AS overdue,
              COALESCE(SUM(tk.due_date = CURDATE()), 0)  AS due_today,
              (SELECT COUNT(*) FROM tickets d WHERE d.deleted = 0 AND d.status IN ('resolved', 'closed')
                 AND d.updated_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)) AS resolved_week
         FROM tickets tk WHERE ${TICKET_OPEN}`
    ),
    safeQuery(
      `SELECT tk.id, tk.ticket_id_code AS code, tk.title, tk.priority, tk.status, tk.due_date,
              CASE WHEN tk.due_date < CURDATE() THEN DATEDIFF(CURDATE(), tk.due_date) ELSE NULL END AS days_overdue,
              CONCAT(u.first_name, ' ', u.last_name) AS assignee
         FROM tickets tk LEFT JOIN users u ON u.id = tk.assigned_to
        WHERE ${TICKET_OPEN} AND (tk.priority = 'critical' OR tk.due_date < CURDATE())
        ORDER BY FIELD(tk.priority, 'critical', 'high', 'medium', 'low'), tk.due_date ASC
        LIMIT 8`
    ),
  ]);
  const c = counts?.[0] || {};
  return {
    open: int(c.open_count), critical: int(c.critical), overdue: int(c.overdue),
    due_today: int(c.due_today), resolved_week: int(c.resolved_week),
    list: list || [],
  };
}

/** One row per team: head, members, open / overdue work, open reminders, today's attendance. */
async function departmentSummary() {
  const [teams, tasks, tickets, reminders, present, leave] = await Promise.all([
    safeQuery(
      `SELECT t.id AS team_id, t.name AS team_name,
              (SELECT tm.user_id FROM team_members tm WHERE tm.team_id = t.id AND tm.role = 'head' LIMIT 1) AS head_id,
              (SELECT CONCAT(u.first_name, ' ', u.last_name) FROM team_members tm JOIN users u ON u.id = tm.user_id
                WHERE tm.team_id = t.id AND tm.role = 'head' LIMIT 1) AS head_name,
              (SELECT COUNT(*) FROM team_members tm JOIN users u ON u.id = tm.user_id AND u.is_active = 1 AND u.deleted = 0
                WHERE tm.team_id = t.id) AS members
         FROM teams t WHERE t.deleted = 0 ORDER BY t.name`
    ),
    safeQuery(
      `SELECT tm.team_id, COUNT(*) AS open_count, COALESCE(SUM(t.deadline < CURDATE()), 0) AS overdue
         FROM tasks t JOIN team_members tm ON tm.user_id = t.assigned_to
        WHERE ${TASK_OPEN} GROUP BY tm.team_id`
    ),
    safeQuery(
      `SELECT tm.team_id, COUNT(*) AS open_count, COALESCE(SUM(tk.due_date < CURDATE()), 0) AS overdue
         FROM tickets tk JOIN team_members tm ON tm.user_id = tk.assigned_to
        WHERE ${TICKET_OPEN} GROUP BY tm.team_id`
    ),
    safeQuery(
      `SELECT r.team_id, COUNT(*) AS open_count,
              COALESCE(SUM(r.due_at IS NOT NULL AND r.due_at < NOW()), 0) AS overdue
         FROM ceo_reminders r
        WHERE r.deleted = 0 AND r.status IN ('pending', 'viewed', 'acknowledged', 'in_progress')
        GROUP BY r.team_id`
    ),
    safeQuery(
      `SELECT tm.team_id, COUNT(*) AS present,
              COALESCE(SUM(a.clock_in_status = 'late'), 0) AS late
         FROM attendance a
         JOIN team_members tm ON tm.user_id = a.user_id
         JOIN users u ON u.id = a.user_id AND u.is_active = 1 AND u.deleted = 0
        WHERE a.date = CURDATE() GROUP BY tm.team_id`
    ),
    safeQuery(
      `SELECT tm.team_id, COUNT(DISTINCT l.user_id) AS on_leave
         FROM leaves l
         JOIN team_members tm ON tm.user_id = l.user_id
         JOIN users u ON u.id = l.user_id AND u.is_active = 1 AND u.deleted = 0
        WHERE l.status = 'approved' AND l.deleted = 0 AND CURDATE() BETWEEN l.from_date AND l.to_date
        GROUP BY tm.team_id`
    ),
  ]);
  const by = (rows) => new Map((rows || []).map((r) => [Number(r.team_id), r]));
  const tMap = by(tasks), kMap = by(tickets), rMap = by(reminders), pMap = by(present), lMap = by(leave);

  return (teams || []).map((t) => {
    const id = Number(t.team_id);
    const members = int(t.members);
    const presentN = int(pMap.get(id)?.present);
    const onLeave = int(lMap.get(id)?.on_leave);
    return {
      team_id: id,
      team_name: t.team_name,
      head_name: t.head_name || null,
      members,
      open_tasks: int(tMap.get(id)?.open_count),
      overdue_tasks: int(tMap.get(id)?.overdue),
      open_tickets: int(kMap.get(id)?.open_count),
      overdue_tickets: int(kMap.get(id)?.overdue),
      open_reminders: int(rMap.get(id)?.open_count),
      overdue_reminders: int(rMap.get(id)?.overdue),
      present_today: presentN,
      late_today: int(pMap.get(id)?.late),
      on_leave_today: onLeave,
      absent_today: Math.max(0, members - presentN - onLeave),
    };
  });
}

// GET /api/ceo-dashboard/work
exports.getWork = async (req, res) => {
  try {
    const [tasks, tickets, departments] = await Promise.all([taskSummary(), ticketSummary(), departmentSummary()]);
    return res.json({ tasks, tickets, departments });
  } catch (err) {
    console.error('CEO work error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// GET /api/ceo-dashboard/finance
// Month-to-date figures vs the same days last month, plus receivables ageing,
// expense breakdown, payroll and the biggest overdue invoices.
exports.getFinance = async (req, res) => {
  try {
    const per = (await safeQuery(
      `SELECT DATE_FORMAT(CURDATE(), '%Y-%m-01') AS m_start, CURDATE() AS m_end,
              DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-01') AS p_start,
              DATE_SUB(CURDATE(), INTERVAL 1 MONTH) AS p_end,
              YEAR(CURDATE()) AS y, MONTH(CURDATE()) AS m`
    ))?.[0];
    if (!per) return res.status(500).json({ message: 'Server error' });
    const { m_start, m_end, p_start, p_end, y, m } = per;

    const [inv, aging, expTotals, expCats, reimb, payroll, capital, overdueList] = await Promise.all([
      safeQuery(
        `SELECT COALESCE(SUM(CASE WHEN bill_date BETWEEN ? AND ? THEN total_amount END), 0) AS invoiced,
                COALESCE(SUM(CASE WHEN bill_date BETWEEN ? AND ? THEN paid_amount  END), 0) AS collected,
                COALESCE(SUM(CASE WHEN bill_date BETWEEN ? AND ? THEN paid_amount  END), 0) AS collected_prev
           FROM invoices WHERE deleted = 0`,
        [m_start, m_end, m_start, m_end, p_start, p_end]
      ),
      safeQuery(
        `SELECT COALESCE(SUM(balance_amount), 0) AS total,
                COALESCE(SUM(CASE WHEN due_date >= CURDATE() THEN balance_amount END), 0) AS not_due,
                COALESCE(SUM(CASE WHEN due_date >= CURDATE() AND due_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN balance_amount END), 0) AS due_30,
                COALESCE(SUM(CASE WHEN due_date < CURDATE() AND DATEDIFF(CURDATE(), due_date) <= 30 THEN balance_amount END), 0) AS d0_30,
                COALESCE(SUM(CASE WHEN due_date < CURDATE() AND DATEDIFF(CURDATE(), due_date) BETWEEN 31 AND 60 THEN balance_amount END), 0) AS d31_60,
                COALESCE(SUM(CASE WHEN due_date < CURDATE() AND DATEDIFF(CURDATE(), due_date) BETWEEN 61 AND 90 THEN balance_amount END), 0) AS d61_90,
                COALESCE(SUM(CASE WHEN due_date < CURDATE() AND DATEDIFF(CURDATE(), due_date) > 90 THEN balance_amount END), 0) AS d90_plus,
                COALESCE(SUM(due_date < CURDATE()), 0) AS overdue_count
           FROM invoices WHERE deleted = 0 AND balance_amount > 0`
      ),
      safeQuery(
        `SELECT COALESCE(SUM(CASE WHEN expense_date BETWEEN ? AND ? THEN amount END), 0) AS cur,
                COALESCE(SUM(CASE WHEN expense_date BETWEEN ? AND ? THEN amount END), 0) AS prev
           FROM expenses WHERE deleted = 0`,
        [m_start, m_end, p_start, p_end]
      ),
      safeQuery(
        `SELECT COALESCE(NULLIF(category, ''), 'Uncategorised') AS category, ROUND(SUM(amount), 2) AS total
           FROM expenses WHERE deleted = 0 AND expense_date BETWEEN ? AND ?
          GROUP BY COALESCE(NULLIF(category, ''), 'Uncategorised')
          ORDER BY total DESC LIMIT 5`,
        [m_start, m_end]
      ),
      safeQuery(
        `SELECT COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS cnt
           FROM reimbursements WHERE deleted = 0 AND status IN ('pending', 'approved')`
      ),
      safeQuery(
        `SELECT COALESCE(SUM(CASE WHEN status = 'Paid' THEN net_salary END), 0) AS paid,
                COALESCE(SUM(CASE WHEN status <> 'Paid' THEN net_salary END), 0) AS unpaid,
                COALESCE(SUM(status <> 'Paid'), 0) AS unpaid_count
           FROM payroll WHERE deleted = 0 AND pay_year = ? AND pay_month = ?`,
        [y, m]
      ),
      safeQuery(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM capital WHERE deleted = 0 AND capital_date BETWEEN ? AND ?`,
        [m_start, m_end]
      ),
      safeQuery(
        `SELECT i.id, i.invoice_number, COALESCE(l.business_name, l.name, 'Unknown client') AS client_name,
                i.balance_amount, i.due_date, DATEDIFF(CURDATE(), i.due_date) AS days_overdue
           FROM invoices i LEFT JOIN leads l ON l.id = i.lead_id
          WHERE i.deleted = 0 AND i.balance_amount > 0 AND i.due_date < CURDATE()
          ORDER BY i.balance_amount DESC LIMIT 5`
      ),
    ]);

    const i = inv?.[0] || {};
    const a = aging?.[0] || {};
    const e = expTotals?.[0] || {};
    const p = payroll?.[0] || {};
    const invoiced = num(i.invoiced);
    const collected = num(i.collected);
    const expenses = num(e.cur);
    const salaries = num(p.paid);
    const profit = Math.round((collected - expenses - salaries) * 100) / 100;

    return res.json({
      month: {
        invoiced, collected,
        collection_rate: invoiced > 0 ? Math.round((collected / invoiced) * 100) : null,
        expenses, expenses_prev: num(e.prev),
        salaries, profit,
        profit_margin: collected > 0 ? Math.round((profit / collected) * 100) : null,
        capital_in: num(capital?.[0]?.total),
        collected_prev: num(i.collected_prev),
      },
      receivables: {
        total: num(a.total), not_due: num(a.not_due), due_next_30: num(a.due_30),
        overdue_count: int(a.overdue_count),
        buckets: [
          { label: '0-30 days', amount: num(a.d0_30) },
          { label: '31-60 days', amount: num(a.d31_60) },
          { label: '61-90 days', amount: num(a.d61_90) },
          { label: '90+ days', amount: num(a.d90_plus) },
        ],
        overdue_invoices: overdueList || [],
      },
      expense_categories: expCats || [],
      payables: {
        payroll_unpaid: num(p.unpaid), payroll_unpaid_count: int(p.unpaid_count),
        reimbursements_pending: num(reimb?.[0]?.amount), reimbursements_count: int(reimb?.[0]?.cnt),
      },
    });
  } catch (err) {
    console.error('CEO finance error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
