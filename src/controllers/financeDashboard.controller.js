const db = require('../config/db');

/**
 * GET /api/finance-dashboard/overview
 *
 * Query params:
 *   startDate  — 'YYYY-MM-DD'  (defaults to first day of current month)
 *   endDate    — 'YYYY-MM-DD'  (defaults to today)
 *
 * Sections returned:
 *   1. kpis              — top KPI cards
 *   2. income            — invoiced / collected / outstanding / capital inflow
 *   3. expense_status    — paid in range / by category / reimbursements
 *   4. invoice_pipeline  — count by invoice status (range-scoped)
 *   5. quotation_summary — count by quotation status (range-scoped)
 *   6. monthly_trend     — P&L per month across the selected range
 *   7. overdue_invoices  — top 10 overdue invoices
 *   8. upcoming_payables — pending reimbursements + active software licenses
 */
exports.getOverview = async (req, res) => {
  try {
    // ── Resolve date range ───────────────────────────────────────────────────
    const now = new Date();
    const defaultStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const defaultEnd   = now.toISOString().split('T')[0];

    const startDate = req.query.startDate || defaultStart;
    const endDate   = req.query.endDate   || defaultEnd;

    // Validate format
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRe.test(startDate) || !dateRe.test(endDate)) {
      return res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    // ── Safe query helper ────────────────────────────────────────────────────
    async function safeQuery(sql, params = []) {
      try {
        const [rows] = await db.query(sql, params);
        return rows;
      } catch (err) {
        console.error('Finance Dashboard query failed:', err.message, sql.slice(0, 120));
        return null;
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 1. REVENUE KPIs — scoped to date range via bill_date
    // ═══════════════════════════════════════════════════════════════════════════
    const revenueRows = await safeQuery(
      `SELECT
         COUNT(*)                                                                      AS total_invoices,
         COALESCE(SUM(i.total_amount),   0)                                           AS total_invoiced,
         COALESCE(SUM(i.paid_amount),    0)                                           AS total_collected,
         COALESCE(SUM(i.balance_amount), 0)                                           AS total_outstanding,
         SUM(CASE WHEN i.balance_amount > 0 AND i.due_date < CURDATE() THEN 1 ELSE 0 END) AS overdue_count
       FROM invoices i
       WHERE i.deleted = 0
         AND i.bill_date BETWEEN ? AND ?`,
      [startDate, endDate]
    );
    const rev = revenueRows?.[0] || {};

    // ═══════════════════════════════════════════════════════════════════════════
    // 2. EXPENSE KPIs — scoped by expense_date
    // ═══════════════════════════════════════════════════════════════════════════
    const expenseRows = await safeQuery(
      `SELECT
         COALESCE(SUM(e.amount), 0) AS total_expenses,
         COUNT(*)                   AS total_expense_count
       FROM expenses e
       WHERE e.deleted = 0
         AND e.expense_date BETWEEN ? AND ?`,
      [startDate, endDate]
    );
    const exp = expenseRows?.[0] || {};

    // ═══════════════════════════════════════════════════════════════════════════
    // 3. PAYROLL KPI — scoped by pay_year / pay_month covering the range
    // ═══════════════════════════════════════════════════════════════════════════
    const sYear = new Date(startDate).getFullYear();
    const sMonth = new Date(startDate).getMonth() + 1;
    const eYear = new Date(endDate).getFullYear();
    const eMonth = new Date(endDate).getMonth() + 1;

    const payrollRows = await safeQuery(
      `SELECT COALESCE(SUM(p.net_salary), 0) AS total_payroll
       FROM payroll p
       WHERE p.deleted = 0 AND p.status = 'Paid'
         AND (p.pay_year > ? OR (p.pay_year = ? AND p.pay_month >= ?))
         AND (p.pay_year < ? OR (p.pay_year = ? AND p.pay_month <= ?))`,
      [sYear, sYear, sMonth, eYear, eYear, eMonth]
    );
    const totalPayroll = parseFloat(payrollRows?.[0]?.total_payroll || 0);

    // ═══════════════════════════════════════════════════════════════════════════
    // 4. CAPITAL INFLOW — scoped by capital_date
    // ═══════════════════════════════════════════════════════════════════════════
    const capitalRows = await safeQuery(
      `SELECT COALESCE(SUM(c.amount), 0) AS total_capital
       FROM capital c
       WHERE c.deleted = 0
         AND c.capital_date BETWEEN ? AND ?`,
      [startDate, endDate]
    );
    const totalCapital = parseFloat(capitalRows?.[0]?.total_capital || 0);

    // ═══════════════════════════════════════════════════════════════════════════
    // 5. COMPUTED TOP-LEVEL KPIs
    // ═══════════════════════════════════════════════════════════════════════════
    const totalRevenue  = parseFloat(rev.total_collected || 0);
    const totalExpenses = parseFloat(exp.total_expenses  || 0);
    const netProfit     = totalRevenue - totalExpenses - totalPayroll;

    const kpis = {
      total_revenue:     totalRevenue,
      total_expenses:    totalExpenses,
      total_payroll:     totalPayroll,
      net_profit:        Math.round(netProfit * 100) / 100,
      total_invoiced:    parseFloat(rev.total_invoiced    || 0),
      total_outstanding: parseFloat(rev.total_outstanding || 0),
      total_invoices:    parseInt(rev.total_invoices      || 0),
      overdue_invoices:  parseInt(rev.overdue_count       || 0),
      capital_inflow:    totalCapital,
      expense_count:     parseInt(exp.total_expense_count || 0),
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // 6. INCOME BREAKDOWN
    // ═══════════════════════════════════════════════════════════════════════════
    const income = {
      invoiced:       kpis.total_invoiced,
      collected:      kpis.total_revenue,
      outstanding:    kpis.total_outstanding,
      capital_inflow: totalCapital,
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // 7. EXPENSE BY CATEGORY — range-scoped
    // ═══════════════════════════════════════════════════════════════════════════
    const expByCategoryRows = await safeQuery(
      `SELECT
         COALESCE(NULLIF(e.category, ''), 'Uncategorised') AS category,
         COUNT(*)                                          AS count,
         ROUND(SUM(e.amount), 2)                          AS total_amount
       FROM expenses e
       WHERE e.deleted = 0
         AND e.expense_date BETWEEN ? AND ?
       GROUP BY COALESCE(NULLIF(e.category, ''), 'Uncategorised')
       ORDER BY total_amount DESC
       LIMIT 8`,
      [startDate, endDate]
    ) || [];

    // Reimbursements are not date-range scoped (they are always "current pending")
    const reimbRows = await safeQuery(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'pending'  THEN amount ELSE 0 END), 0) AS pending_amount,
         COALESCE(SUM(CASE WHEN status = 'approved' THEN amount ELSE 0 END), 0) AS approved_amount,
         COUNT(CASE WHEN status IN ('pending','approved') THEN 1 END)            AS pending_count
       FROM reimbursements
       WHERE deleted = 0`
    );
    const reimb = reimbRows?.[0] || {};

    const expense_status = {
      paid_in_range:            totalExpenses,
      expense_by_category:      expByCategoryRows,
      reimbursements_pending:   parseFloat(reimb.pending_amount  || 0),
      reimbursements_approved:  parseFloat(reimb.approved_amount || 0),
      reimbursements_count:     parseInt(reimb.pending_count     || 0),
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // 8. INVOICE PIPELINE — scoped to range via bill_date
    // ═══════════════════════════════════════════════════════════════════════════
    const invoicePipelineRows = await safeQuery(
      `SELECT
         i.status,
         COUNT(*)                        AS count,
         ROUND(SUM(i.total_amount),   2) AS total_amount,
         ROUND(SUM(i.balance_amount), 2) AS balance_amount
       FROM invoices i
       WHERE i.deleted = 0
         AND i.bill_date BETWEEN ? AND ?
       GROUP BY i.status
       ORDER BY FIELD(i.status, 'New','Partial','Paid','Overdue')`,
      [startDate, endDate]
    ) || [];

    // ═══════════════════════════════════════════════════════════════════════════
    // 9. QUOTATION SUMMARY — scoped to range via created_at
    // ═══════════════════════════════════════════════════════════════════════════
    const quotationRows = await safeQuery(
      `SELECT
         status,
         COUNT(*)                          AS count,
         ROUND(SUM(investment_amount), 2)  AS total_value
       FROM quotations
       WHERE deleted = 0
         AND DATE(created_at) BETWEEN ? AND ?
       GROUP BY status
       ORDER BY FIELD(status, 'Draft','Sent','Accepted','Rejected')`,
      [startDate, endDate]
    ) || [];

    // ═══════════════════════════════════════════════════════════════════════════
    // 10. MONTHLY P&L TREND — across the selected range
    // ═══════════════════════════════════════════════════════════════════════════
    const monthlyTrendRows = await safeQuery(
      `SELECT
         months.month,
         COALESCE(r.collected, 0)  AS revenue,
         COALESCE(ex.total,    0)  AS expenses,
         COALESCE(py.total_net, 0) AS payroll,
         ROUND(
           COALESCE(r.collected, 0)
           - COALESCE(ex.total, 0)
           - COALESCE(py.total_net, 0),
         2) AS net_profit
       FROM (
         SELECT DISTINCT DATE_FORMAT(bill_date, '%Y-%m') AS month
         FROM invoices WHERE deleted = 0 AND bill_date BETWEEN ? AND ?
         UNION
         SELECT DISTINCT DATE_FORMAT(expense_date, '%Y-%m')
         FROM expenses WHERE deleted = 0 AND expense_date BETWEEN ? AND ?
       ) months
       LEFT JOIN (
         SELECT DATE_FORMAT(bill_date, '%Y-%m') AS month, SUM(paid_amount) AS collected
         FROM invoices WHERE deleted = 0 AND bill_date BETWEEN ? AND ?
         GROUP BY DATE_FORMAT(bill_date, '%Y-%m')
       ) r  ON r.month  = months.month
       LEFT JOIN (
         SELECT DATE_FORMAT(expense_date, '%Y-%m') AS month, SUM(amount) AS total
         FROM expenses WHERE deleted = 0 AND expense_date BETWEEN ? AND ?
         GROUP BY DATE_FORMAT(expense_date, '%Y-%m')
       ) ex ON ex.month = months.month
       LEFT JOIN (
         SELECT CONCAT(pay_year, '-', LPAD(pay_month, 2, '0')) AS month, SUM(net_salary) AS total_net
         FROM payroll WHERE deleted = 0 AND status = 'Paid'
           AND (pay_year > ? OR (pay_year = ? AND pay_month >= ?))
           AND (pay_year < ? OR (pay_year = ? AND pay_month <= ?))
         GROUP BY pay_year, pay_month
       ) py ON py.month = months.month
       ORDER BY months.month ASC`,
      [
        startDate, endDate,   // invoices union
        startDate, endDate,   // expenses union
        startDate, endDate,   // invoices join
        startDate, endDate,   // expenses join
        sYear, sYear, sMonth, eYear, eYear, eMonth, // payroll join
      ]
    ) || [];

    // ═══════════════════════════════════════════════════════════════════════════
    // 11. OVERDUE INVOICES — always current (not range-scoped, shows all unpaid)
    // ═══════════════════════════════════════════════════════════════════════════
    const overdueInvoices = await safeQuery(
      `SELECT
         i.id,
         i.invoice_number,
         COALESCE(l.business_name, l.name, 'Unknown Client') AS client_name,
         i.total_amount,
         i.paid_amount,
         i.balance_amount,
         i.due_date,
         DATEDIFF(CURDATE(), i.due_date) AS days_overdue
       FROM invoices i
       LEFT JOIN leads l ON l.id = i.lead_id
       WHERE i.deleted = 0
         AND i.balance_amount > 0
         AND i.due_date < CURDATE()
       ORDER BY days_overdue DESC
       LIMIT 10`
    ) || [];

    // ═══════════════════════════════════════════════════════════════════════════
    // 12. UPCOMING PAYABLES — always current pending
    // ═══════════════════════════════════════════════════════════════════════════
    const pendingReimbList = await safeQuery(
      `SELECT
         r.id,
         CONCAT(u.first_name, ' ', u.last_name) AS employee_name,
         u.avatar_url,
         r.category,
         r.amount,
         r.created_at
       FROM reimbursements r
       JOIN users u ON u.id = r.user_id
       WHERE r.deleted = 0 AND r.status = 'pending'
       ORDER BY r.created_at DESC
       LIMIT 10`
    ) || [];

    const softwareLicenses = await safeQuery(
      `SELECT id, software_name, vendor_name, cost, billing_cycle, renewal_date, status
       FROM software_licenses
       WHERE deleted = 0 AND status = 'Active'
       ORDER BY renewal_date ASC
       LIMIT 10`
    ) || [];

    const upcoming_payables = {
      reimbursements:               pendingReimbList,
      software_licenses:            softwareLicenses,
      total_reimbursement_pending:  parseFloat(reimb.pending_amount || 0),
      total_license_monthly:        softwareLicenses.reduce((s, l) => s + parseFloat(l.cost || 0), 0),
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // RESPONSE
    // ═══════════════════════════════════════════════════════════════════════════
    return res.json({
      scope: { startDate, endDate },
      kpis,
      income,
      expense_status,
      invoice_pipeline:  invoicePipelineRows,
      quotation_summary: quotationRows,
      monthly_trend:     monthlyTrendRows,
      overdue_invoices:  overdueInvoices,
      upcoming_payables,
    });
  } catch (err) {
    console.error('Finance Dashboard getOverview fatal error:', err);
    return res.status(500).json({ message: 'Server error: ' + err.message });
  }
};
