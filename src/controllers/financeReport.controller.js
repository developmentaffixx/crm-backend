const db = require('../config/db');

/**
 * GET /api/reports/finance
 * Advanced Finance Analytics Report
 * Query params: startDate, endDate, mode (overview|revenue|expenses|payroll|cashflow|profitability)
 */
exports.getFinanceReport = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    // ─── Date Filters ─────────────────────────────────────────────────────────
    let invoiceDateFilter = '';
    const invoiceDateParams = [];
    if (startDate && endDate) {
      invoiceDateFilter = 'AND i.bill_date BETWEEN ? AND ?';
      invoiceDateParams.push(startDate, endDate);
    } else if (startDate) {
      invoiceDateFilter = 'AND i.bill_date >= ?';
      invoiceDateParams.push(startDate);
    } else if (endDate) {
      invoiceDateFilter = 'AND i.bill_date <= ?';
      invoiceDateParams.push(endDate);
    }

    let paymentDateFilter = '';
    const paymentDateParams = [];
    if (startDate && endDate) {
      paymentDateFilter = 'AND p.payment_date BETWEEN ? AND ?';
      paymentDateParams.push(startDate, endDate);
    } else if (startDate) {
      paymentDateFilter = 'AND p.payment_date >= ?';
      paymentDateParams.push(startDate);
    } else if (endDate) {
      paymentDateFilter = 'AND p.payment_date <= ?';
      paymentDateParams.push(endDate);
    }

    let expenseDateFilter = '';
    const expenseDateParams = [];
    if (startDate && endDate) {
      expenseDateFilter = 'AND e.expense_date BETWEEN ? AND ?';
      expenseDateParams.push(startDate, endDate);
    } else if (startDate) {
      expenseDateFilter = 'AND e.expense_date >= ?';
      expenseDateParams.push(startDate);
    } else if (endDate) {
      expenseDateFilter = 'AND e.expense_date <= ?';
      expenseDateParams.push(endDate);
    }

    let capitalDateFilter = '';
    const capitalDateParams = [];
    if (startDate && endDate) {
      capitalDateFilter = 'AND c.capital_date BETWEEN ? AND ?';
      capitalDateParams.push(startDate, endDate);
    } else if (startDate) {
      capitalDateFilter = 'AND c.capital_date >= ?';
      capitalDateParams.push(startDate);
    } else if (endDate) {
      capitalDateFilter = 'AND c.capital_date <= ?';
      capitalDateParams.push(endDate);
    }

    let payrollFilter = '';
    const payrollParams = [];
    if (startDate) {
      const sYear = new Date(startDate).getFullYear();
      const sMonth = new Date(startDate).getMonth() + 1;
      payrollFilter += ' AND (p.pay_year > ? OR (p.pay_year = ? AND p.pay_month >= ?))';
      payrollParams.push(sYear, sYear, sMonth);
    }
    if (endDate) {
      const eYear = new Date(endDate).getFullYear();
      const eMonth = new Date(endDate).getMonth() + 1;
      payrollFilter += ' AND (p.pay_year < ? OR (p.pay_year = ? AND p.pay_month <= ?))';
      payrollParams.push(eYear, eYear, eMonth);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // 1. FINANCIAL OVERVIEW KPIs
    // ═══════════════════════════════════════════════════════════════════════════
    const [revenueKpi] = await db.query(
      `SELECT 
        COUNT(*) AS total_invoices,
        COALESCE(SUM(i.total_amount), 0) AS total_invoiced,
        COALESCE(SUM(i.paid_amount), 0) AS total_collected,
        COALESCE(SUM(i.balance_amount), 0) AS total_outstanding,
        COALESCE(AVG(i.total_amount), 0) AS avg_invoice_value,
        SUM(CASE WHEN i.status = 'Paid' THEN 1 ELSE 0 END) AS paid_count,
        SUM(CASE WHEN i.status = 'Partial' THEN 1 ELSE 0 END) AS partial_count,
        SUM(CASE WHEN i.status = 'Overdue' THEN 1 ELSE 0 END) AS overdue_count,
        SUM(CASE WHEN i.status = 'New' THEN 1 ELSE 0 END) AS new_count,
        ROUND(SUM(i.paid_amount) * 100.0 / NULLIF(SUM(i.total_amount), 0), 1) AS collection_rate
       FROM invoices i
       WHERE i.deleted = 0 ${invoiceDateFilter}`,
      [...invoiceDateParams]
    );

    const [expenseKpi] = await db.query(
      `SELECT 
        COUNT(*) AS total_expenses,
        COALESCE(SUM(e.amount), 0) AS total_expense_amount,
        COALESCE(AVG(e.amount), 0) AS avg_expense_amount,
        SUM(CASE WHEN e.expense_type = 'client' THEN e.amount ELSE 0 END) AS client_expenses,
        SUM(CASE WHEN e.expense_type = 'team_member' THEN e.amount ELSE 0 END) AS team_expenses,
        SUM(CASE WHEN e.expense_type = 'company' THEN e.amount ELSE 0 END) AS company_expenses
       FROM expenses e
       WHERE e.deleted = 0 ${expenseDateFilter}`,
      [...expenseDateParams]
    );

    const [capitalKpi] = await db.query(
      `SELECT 
        COUNT(*) AS total_investments,
        COALESCE(SUM(c.amount), 0) AS total_capital,
        SUM(CASE WHEN c.source = 'Founder' THEN c.amount ELSE 0 END) AS founder_capital,
        SUM(CASE WHEN c.source = 'Partner' THEN c.amount ELSE 0 END) AS partner_capital,
        SUM(CASE WHEN c.source = 'Loan' THEN c.amount ELSE 0 END) AS loan_capital,
        SUM(CASE WHEN c.source = 'Other' THEN c.amount ELSE 0 END) AS other_capital
       FROM capital c
       WHERE c.deleted = 0 ${capitalDateFilter}`,
      [...capitalDateParams]
    );

    const [payrollKpi] = await db.query(
      `SELECT 
        COUNT(*) AS total_payslips,
        SUM(CASE WHEN p.status = 'Paid' THEN 1 ELSE 0 END) AS paid_payslips,
        COALESCE(SUM(p.gross_salary), 0) AS total_gross_salary,
        COALESCE(SUM(p.net_salary), 0) AS total_net_salary,
        COALESCE(SUM(p.total_deductions), 0) AS total_deductions,
        COALESCE(AVG(p.net_salary), 0) AS avg_net_salary,
        COUNT(DISTINCT p.employee_id) AS employees_paid
       FROM payroll p
       WHERE p.deleted = 0 AND p.status = 'Paid' ${payrollFilter}`,
      [...payrollParams]
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // 2. PROFIT & LOSS STATEMENT
    // ═══════════════════════════════════════════════════════════════════════════
    const totalIncome = parseFloat(revenueKpi[0].total_collected || 0);
    const totalExpenses = parseFloat(expenseKpi[0].total_expense_amount || 0);
    const totalPayrollCost = parseFloat(payrollKpi[0].total_net_salary || 0);
    const totalCapital = parseFloat(capitalKpi[0].total_capital || 0);
    const grossProfit = totalIncome - totalExpenses;
    const netProfit = grossProfit - totalPayrollCost;
    const profitMargin = totalIncome > 0 ? ((netProfit / totalIncome) * 100).toFixed(1) : 0;
    const operatingExpenseRatio = totalIncome > 0 ? (((totalExpenses + totalPayrollCost) / totalIncome) * 100).toFixed(1) : 0;
    const burnRate = totalExpenses + totalPayrollCost;
    const runway = burnRate > 0 ? ((totalCapital + totalIncome) / burnRate).toFixed(1) : 0;

    const profitAndLoss = {
      total_income: totalIncome,
      total_expenses: totalExpenses,
      total_payroll_cost: totalPayrollCost,
      total_capital: totalCapital,
      gross_profit: grossProfit,
      net_profit: netProfit,
      profit_margin: parseFloat(profitMargin),
      operating_expense_ratio: parseFloat(operatingExpenseRatio),
      burn_rate: burnRate,
      runway_months: parseFloat(runway),
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // 3. REVENUE TREND (Monthly)
    // ═══════════════════════════════════════════════════════════════════════════
    const [revenueTrend] = await db.query(
      `SELECT 
        DATE_FORMAT(i.bill_date, '%Y-%m') AS month,
        COUNT(*) AS invoice_count,
        ROUND(SUM(i.total_amount), 2) AS invoiced,
        ROUND(SUM(i.paid_amount), 2) AS collected,
        ROUND(SUM(i.balance_amount), 2) AS outstanding,
        ROUND(AVG(i.total_amount), 2) AS avg_value
       FROM invoices i
       WHERE i.deleted = 0 ${invoiceDateFilter}
       GROUP BY DATE_FORMAT(i.bill_date, '%Y-%m')
       ORDER BY month ASC
       LIMIT 24`,
      [...invoiceDateParams]
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // 4. EXPENSE TREND (Monthly)
    // ═══════════════════════════════════════════════════════════════════════════
    const [expenseTrend] = await db.query(
      `SELECT 
        DATE_FORMAT(e.expense_date, '%Y-%m') AS month,
        COUNT(*) AS expense_count,
        ROUND(SUM(e.amount), 2) AS total_amount,
        ROUND(SUM(CASE WHEN e.expense_type = 'client' THEN e.amount ELSE 0 END), 2) AS client_amount,
        ROUND(SUM(CASE WHEN e.expense_type = 'team_member' THEN e.amount ELSE 0 END), 2) AS team_amount,
        ROUND(SUM(CASE WHEN e.expense_type = 'company' THEN e.amount ELSE 0 END), 2) AS company_amount
       FROM expenses e
       WHERE e.deleted = 0 ${expenseDateFilter}
       GROUP BY DATE_FORMAT(e.expense_date, '%Y-%m')
       ORDER BY month ASC
       LIMIT 24`,
      [...expenseDateParams]
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // 5. CASH FLOW ANALYSIS (Monthly: Money In vs Money Out)
    // ═══════════════════════════════════════════════════════════════════════════
    const [cashFlowIn] = await db.query(
      `SELECT 
        DATE_FORMAT(p.payment_date, '%Y-%m') AS month,
        ROUND(SUM(p.amount), 2) AS amount
       FROM invoice_payments p
       WHERE 1=1 ${paymentDateFilter}
       GROUP BY DATE_FORMAT(p.payment_date, '%Y-%m')
       ORDER BY month ASC
       LIMIT 24`,
      [...paymentDateParams]
    );

    const [cashFlowCapital] = await db.query(
      `SELECT 
        DATE_FORMAT(c.capital_date, '%Y-%m') AS month,
        ROUND(SUM(c.amount), 2) AS amount
       FROM capital c
       WHERE c.deleted = 0 ${capitalDateFilter}
       GROUP BY DATE_FORMAT(c.capital_date, '%Y-%m')
       ORDER BY month ASC
       LIMIT 24`,
      [...capitalDateParams]
    );

    const [cashFlowExpenses] = await db.query(
      `SELECT 
        DATE_FORMAT(e.expense_date, '%Y-%m') AS month,
        ROUND(SUM(e.amount), 2) AS amount
       FROM expenses e
       WHERE e.deleted = 0 ${expenseDateFilter}
       GROUP BY DATE_FORMAT(e.expense_date, '%Y-%m')
       ORDER BY month ASC
       LIMIT 24`,
      [...expenseDateParams]
    );

    const [cashFlowPayroll] = await db.query(
      `SELECT 
        CONCAT(p.pay_year, '-', LPAD(p.pay_month, 2, '0')) AS month,
        ROUND(SUM(p.net_salary), 2) AS amount
       FROM payroll p
       WHERE p.deleted = 0 AND p.status = 'Paid' ${payrollFilter}
       GROUP BY p.pay_year, p.pay_month
       ORDER BY p.pay_year ASC, p.pay_month ASC
       LIMIT 24`,
      [...payrollParams]
    );

    // Merge cash flow into unified monthly view
    const cashFlowMonths = new Set();
    cashFlowIn.forEach(r => cashFlowMonths.add(r.month));
    cashFlowCapital.forEach(r => cashFlowMonths.add(r.month));
    cashFlowExpenses.forEach(r => cashFlowMonths.add(r.month));
    cashFlowPayroll.forEach(r => cashFlowMonths.add(r.month));

    const cashFlow = Array.from(cashFlowMonths).sort().map(month => {
      const inflow = parseFloat((cashFlowIn.find(r => r.month === month) || {}).amount || 0)
        + parseFloat((cashFlowCapital.find(r => r.month === month) || {}).amount || 0);
      const outflow = parseFloat((cashFlowExpenses.find(r => r.month === month) || {}).amount || 0)
        + parseFloat((cashFlowPayroll.find(r => r.month === month) || {}).amount || 0);
      return {
        month,
        inflow: Math.round(inflow * 100) / 100,
        outflow: Math.round(outflow * 100) / 100,
        net: Math.round((inflow - outflow) * 100) / 100,
        payments_received: parseFloat((cashFlowIn.find(r => r.month === month) || {}).amount || 0),
        capital_infused: parseFloat((cashFlowCapital.find(r => r.month === month) || {}).amount || 0),
        expenses_paid: parseFloat((cashFlowExpenses.find(r => r.month === month) || {}).amount || 0),
        payroll_paid: parseFloat((cashFlowPayroll.find(r => r.month === month) || {}).amount || 0),
      };
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // 6. EXPENSE BREAKDOWN BY CATEGORY
    // ═══════════════════════════════════════════════════════════════════════════
    const [expenseByCategory] = await db.query(
      `SELECT 
        e.category,
        COUNT(*) AS count,
        ROUND(SUM(e.amount), 2) AS total_amount,
        ROUND(AVG(e.amount), 2) AS avg_amount,
        ROUND(SUM(e.amount) * 100.0 / NULLIF((SELECT SUM(amount) FROM expenses WHERE deleted = 0 ${expenseDateFilter.replace(/e\./g, '')}), 0), 1) AS percentage
       FROM expenses e
       WHERE e.deleted = 0 ${expenseDateFilter}
       GROUP BY e.category
       ORDER BY total_amount DESC`,
      [...expenseDateParams, ...expenseDateParams]
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // 7. EXPENSE BY PAYMENT MODE
    // ═══════════════════════════════════════════════════════════════════════════
    const [expenseByPaymentMode] = await db.query(
      `SELECT 
        e.payment_mode,
        COUNT(*) AS count,
        ROUND(SUM(e.amount), 2) AS total_amount
       FROM expenses e
       WHERE e.deleted = 0 ${expenseDateFilter}
       GROUP BY e.payment_mode
       ORDER BY total_amount DESC`,
      [...expenseDateParams]
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // 8. TOP VENDORS BY SPEND
    // ═══════════════════════════════════════════════════════════════════════════
    const [topVendors] = await db.query(
      `SELECT 
        e.vendor_name,
        COUNT(*) AS transaction_count,
        ROUND(SUM(e.amount), 2) AS total_spent,
        ROUND(AVG(e.amount), 2) AS avg_transaction,
        MIN(e.expense_date) AS first_transaction,
        MAX(e.expense_date) AS last_transaction
       FROM expenses e
       WHERE e.deleted = 0 ${expenseDateFilter}
       GROUP BY e.vendor_name
       ORDER BY total_spent DESC
       LIMIT 15`,
      [...expenseDateParams]
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // 9. TOP REVENUE CLIENTS
    // ═══════════════════════════════════════════════════════════════════════════
    const [topRevenueClients] = await db.query(
      `SELECT 
        l.id AS client_id,
        l.name AS client_name,
        l.business_name,
        COUNT(i.id) AS invoice_count,
        ROUND(SUM(i.total_amount), 2) AS total_invoiced,
        ROUND(SUM(i.paid_amount), 2) AS total_paid,
        ROUND(SUM(i.balance_amount), 2) AS outstanding,
        ROUND(SUM(i.paid_amount) * 100.0 / NULLIF(SUM(i.total_amount), 0), 1) AS payment_rate,
        ROUND(AVG(i.total_amount), 2) AS avg_invoice_value
       FROM invoices i
       JOIN leads l ON l.id = i.lead_id
       WHERE i.deleted = 0 ${invoiceDateFilter}
       GROUP BY l.id, l.name, l.business_name
       ORDER BY total_paid DESC
       LIMIT 15`,
      [...invoiceDateParams]
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // 10. CLIENT PROFITABILITY (Revenue - Expenses per client)
    // ═══════════════════════════════════════════════════════════════════════════
    const [clientProfitability] = await db.query(
      `SELECT 
        l.id AS client_id,
        l.name AS client_name,
        l.business_name,
        COALESCE(rev.total_paid, 0) AS revenue,
        COALESCE(exp.total_spent, 0) AS expenses,
        ROUND(COALESCE(rev.total_paid, 0) - COALESCE(exp.total_spent, 0), 2) AS profit,
        ROUND((COALESCE(rev.total_paid, 0) - COALESCE(exp.total_spent, 0)) * 100.0 / NULLIF(COALESCE(rev.total_paid, 0), 0), 1) AS margin_pct
       FROM leads l
       LEFT JOIN (
         SELECT lead_id, SUM(paid_amount) AS total_paid
         FROM invoices WHERE deleted = 0 ${invoiceDateFilter.replace(/i\./g, '')}
         GROUP BY lead_id
       ) rev ON rev.lead_id = l.id
       LEFT JOIN (
         SELECT client_id, SUM(amount) AS total_spent
         FROM expenses WHERE deleted = 0 ${expenseDateFilter.replace(/e\./g, '')}
         GROUP BY client_id
       ) exp ON exp.client_id = l.id
       WHERE l.deleted = 0 AND (rev.total_paid > 0 OR exp.total_spent > 0)
       ORDER BY profit DESC
       LIMIT 20`,
      [...invoiceDateParams, ...expenseDateParams]
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // 11. INVOICE AGING ANALYSIS (Outstanding by age buckets)
    // ═══════════════════════════════════════════════════════════════════════════
    const [invoiceAging] = await db.query(
      `SELECT 
        SUM(CASE WHEN DATEDIFF(CURDATE(), i.due_date) <= 0 THEN i.balance_amount ELSE 0 END) AS not_yet_due,
        SUM(CASE WHEN DATEDIFF(CURDATE(), i.due_date) BETWEEN 1 AND 30 THEN i.balance_amount ELSE 0 END) AS days_1_30,
        SUM(CASE WHEN DATEDIFF(CURDATE(), i.due_date) BETWEEN 31 AND 60 THEN i.balance_amount ELSE 0 END) AS days_31_60,
        SUM(CASE WHEN DATEDIFF(CURDATE(), i.due_date) BETWEEN 61 AND 90 THEN i.balance_amount ELSE 0 END) AS days_61_90,
        SUM(CASE WHEN DATEDIFF(CURDATE(), i.due_date) > 90 THEN i.balance_amount ELSE 0 END) AS days_over_90,
        COUNT(CASE WHEN DATEDIFF(CURDATE(), i.due_date) > 0 AND i.balance_amount > 0 THEN 1 END) AS overdue_invoice_count,
        ROUND(AVG(CASE WHEN i.status = 'Paid' THEN DATEDIFF(
          (SELECT MAX(p2.payment_date) FROM invoice_payments p2 WHERE p2.invoice_id = i.id),
          i.bill_date
        ) END), 0) AS avg_days_to_payment
       FROM invoices i
       WHERE i.deleted = 0 AND i.balance_amount > 0`,
      []
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // 12. OVERDUE INVOICES DETAIL
    // ═══════════════════════════════════════════════════════════════════════════
    const [overdueInvoices] = await db.query(
      `SELECT 
        i.id,
        i.invoice_number,
        l.name AS client_name,
        l.business_name,
        i.total_amount,
        i.paid_amount,
        i.balance_amount,
        i.due_date,
        DATEDIFF(CURDATE(), i.due_date) AS days_overdue
       FROM invoices i
       LEFT JOIN leads l ON l.id = i.lead_id
       WHERE i.deleted = 0 AND i.balance_amount > 0 AND i.due_date < CURDATE()
       ORDER BY days_overdue DESC
       LIMIT 20`,
      []
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // 13. PAYMENT COLLECTION TREND (actual payments received)
    // ═══════════════════════════════════════════════════════════════════════════
    const [paymentTrend] = await db.query(
      `SELECT 
        DATE_FORMAT(p.payment_date, '%Y-%m') AS month,
        COUNT(*) AS payment_count,
        ROUND(SUM(p.amount), 2) AS total_collected,
        ROUND(AVG(p.amount), 2) AS avg_payment,
        SUM(CASE WHEN p.payment_method = 'Cash' THEN p.amount ELSE 0 END) AS cash_amount,
        SUM(CASE WHEN p.payment_method = 'Bank' THEN p.amount ELSE 0 END) AS bank_amount,
        SUM(CASE WHEN p.payment_method = 'UPI' THEN p.amount ELSE 0 END) AS upi_amount
       FROM invoice_payments p
       WHERE 1=1 ${paymentDateFilter}
       GROUP BY DATE_FORMAT(p.payment_date, '%Y-%m')
       ORDER BY month ASC
       LIMIT 24`,
      [...paymentDateParams]
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // 14. PAYMENT METHOD DISTRIBUTION
    // ═══════════════════════════════════════════════════════════════════════════
    const [paymentMethodDist] = await db.query(
      `SELECT 
        p.payment_method,
        COUNT(*) AS count,
        ROUND(SUM(p.amount), 2) AS total_amount,
        ROUND(SUM(p.amount) * 100.0 / NULLIF((SELECT SUM(amount) FROM invoice_payments WHERE 1=1 ${paymentDateFilter.replace(/p\./g, '')}), 0), 1) AS percentage
       FROM invoice_payments p
       WHERE 1=1 ${paymentDateFilter}
       GROUP BY p.payment_method
       ORDER BY total_amount DESC`,
      [...paymentDateParams, ...paymentDateParams]
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // 15. PAYROLL TREND (Monthly)
    // ═══════════════════════════════════════════════════════════════════════════
    const [payrollTrend] = await db.query(
      `SELECT 
        CONCAT(p.pay_year, '-', LPAD(p.pay_month, 2, '0')) AS month,
        COUNT(*) AS employees_paid,
        ROUND(SUM(p.gross_salary), 2) AS total_gross,
        ROUND(SUM(p.net_salary), 2) AS total_net,
        ROUND(SUM(p.total_deductions), 2) AS total_deductions,
        ROUND(SUM(p.pf_deduction), 2) AS pf_total,
        ROUND(SUM(p.esi_deduction), 2) AS esi_total,
        ROUND(SUM(p.professional_tax), 2) AS pt_total,
        ROUND(AVG(p.net_salary), 2) AS avg_salary
       FROM payroll p
       WHERE p.deleted = 0 AND p.status = 'Paid' ${payrollFilter}
       GROUP BY p.pay_year, p.pay_month
       ORDER BY p.pay_year ASC, p.pay_month ASC
       LIMIT 24`,
      [...payrollParams]
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // 16. PAYROLL DEDUCTIONS BREAKDOWN
    // ═══════════════════════════════════════════════════════════════════════════
    const [payrollDeductions] = await db.query(
      `SELECT 
        ROUND(SUM(p.pf_deduction), 2) AS total_pf,
        ROUND(SUM(p.esi_deduction), 2) AS total_esi,
        ROUND(SUM(p.professional_tax), 2) AS total_professional_tax,
        ROUND(SUM(p.other_deductions), 2) AS total_other_deductions,
        ROUND(SUM(p.total_deductions), 2) AS grand_total_deductions
       FROM payroll p
       WHERE p.deleted = 0 AND p.status = 'Paid' ${payrollFilter}`,
      [...payrollParams]
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // 17. TOP SALARY EARNERS
    // ═══════════════════════════════════════════════════════════════════════════
    const [topEarners] = await db.query(
      `SELECT 
        p.employee_id,
        CONCAT(u.first_name, ' ', u.last_name) AS name,
        u.email,
        COUNT(*) AS months_paid,
        ROUND(AVG(p.net_salary), 2) AS avg_monthly_salary,
        ROUND(SUM(p.net_salary), 2) AS total_earned,
        ROUND(SUM(p.total_deductions), 2) AS total_deductions
       FROM payroll p
       JOIN users u ON u.id = p.employee_id
       WHERE p.deleted = 0 AND p.status = 'Paid' ${payrollFilter}
       GROUP BY p.employee_id, u.first_name, u.last_name, u.email
       ORDER BY total_earned DESC
       LIMIT 15`,
      [...payrollParams]
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // 18. CAPITAL INVESTMENT TREND
    // ═══════════════════════════════════════════════════════════════════════════
    const [capitalTrend] = await db.query(
      `SELECT 
        DATE_FORMAT(c.capital_date, '%Y-%m') AS month,
        COUNT(*) AS investment_count,
        ROUND(SUM(c.amount), 2) AS total_amount,
        SUM(CASE WHEN c.source = 'Founder' THEN c.amount ELSE 0 END) AS founder,
        SUM(CASE WHEN c.source = 'Partner' THEN c.amount ELSE 0 END) AS partner,
        SUM(CASE WHEN c.source = 'Loan' THEN c.amount ELSE 0 END) AS loan,
        SUM(CASE WHEN c.source = 'Other' THEN c.amount ELSE 0 END) AS other
       FROM capital c
       WHERE c.deleted = 0 ${capitalDateFilter}
       GROUP BY DATE_FORMAT(c.capital_date, '%Y-%m')
       ORDER BY month ASC
       LIMIT 24`,
      [...capitalDateParams]
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // 19. MONTHLY P&L TREND (Revenue vs Total Costs)
    // ═══════════════════════════════════════════════════════════════════════════
    const [monthlyPnL] = await db.query(
      `SELECT 
        months.month,
        COALESCE(rev.collected, 0) AS revenue,
        COALESCE(exp.total, 0) AS expenses,
        COALESCE(pay.total_net, 0) AS payroll_cost,
        ROUND(COALESCE(rev.collected, 0) - COALESCE(exp.total, 0) - COALESCE(pay.total_net, 0), 2) AS net_profit
       FROM (
         SELECT DISTINCT DATE_FORMAT(bill_date, '%Y-%m') AS month FROM invoices WHERE deleted = 0
         UNION SELECT DISTINCT DATE_FORMAT(expense_date, '%Y-%m') FROM expenses WHERE deleted = 0
         UNION SELECT DISTINCT CONCAT(pay_year, '-', LPAD(pay_month, 2, '0')) FROM payroll WHERE deleted = 0
       ) months
       LEFT JOIN (
         SELECT DATE_FORMAT(bill_date, '%Y-%m') AS month, SUM(paid_amount) AS collected
         FROM invoices WHERE deleted = 0 GROUP BY DATE_FORMAT(bill_date, '%Y-%m')
       ) rev ON rev.month = months.month
       LEFT JOIN (
         SELECT DATE_FORMAT(expense_date, '%Y-%m') AS month, SUM(amount) AS total
         FROM expenses WHERE deleted = 0 GROUP BY DATE_FORMAT(expense_date, '%Y-%m')
       ) exp ON exp.month = months.month
       LEFT JOIN (
         SELECT CONCAT(pay_year, '-', LPAD(pay_month, 2, '0')) AS month, SUM(net_salary) AS total_net
         FROM payroll WHERE deleted = 0 AND status = 'Paid' GROUP BY pay_year, pay_month
       ) pay ON pay.month = months.month
       ORDER BY months.month ASC
       LIMIT 24`,
      []
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // 20. REVENUE BY SERVICE (from invoice items)
    // ═══════════════════════════════════════════════════════════════════════════
    const [revenueByService] = await db.query(
      `SELECT 
        COALESCE(s.name, ii.description, 'Unnamed Service') AS service_name,
        COUNT(*) AS line_item_count,
        ROUND(SUM(ii.amount), 2) AS total_revenue,
        ROUND(AVG(ii.rate), 2) AS avg_rate,
        SUM(ii.quantity) AS total_quantity
       FROM invoice_items ii
       LEFT JOIN services s ON s.id = ii.service_id
       JOIN invoices i ON i.id = ii.invoice_id
       WHERE i.deleted = 0 ${invoiceDateFilter}
       GROUP BY COALESCE(s.name, ii.description)
       ORDER BY total_revenue DESC
       LIMIT 15`,
      [...invoiceDateParams]
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // 21. EXPENSE GROWTH RATE (Month-over-Month)
    // ═══════════════════════════════════════════════════════════════════════════
    const [expenseGrowth] = await db.query(
      `SELECT 
        curr.month,
        curr.total AS current_month_total,
        prev.total AS previous_month_total,
        ROUND(((curr.total - COALESCE(prev.total, 0)) / NULLIF(COALESCE(prev.total, 0), 0)) * 100, 1) AS growth_rate
       FROM (
         SELECT DATE_FORMAT(expense_date, '%Y-%m') AS month, SUM(amount) AS total
         FROM expenses WHERE deleted = 0 ${expenseDateFilter.replace(/e\./g, '')}
         GROUP BY DATE_FORMAT(expense_date, '%Y-%m')
       ) curr
       LEFT JOIN (
         SELECT DATE_FORMAT(expense_date, '%Y-%m') AS month, SUM(amount) AS total
         FROM expenses WHERE deleted = 0
         GROUP BY DATE_FORMAT(expense_date, '%Y-%m')
       ) prev ON prev.month = DATE_FORMAT(DATE_SUB(STR_TO_DATE(CONCAT(curr.month, '-01'), '%Y-%m-%d'), INTERVAL -1 MONTH), '%Y-%m')
       ORDER BY curr.month ASC
       LIMIT 12`,
      [...expenseDateParams]
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // 22. REVENUE GROWTH RATE (Month-over-Month)
    // ═══════════════════════════════════════════════════════════════════════════
    const [revenueGrowth] = await db.query(
      `SELECT 
        curr.month,
        curr.total AS current_month_total,
        prev.total AS previous_month_total,
        ROUND(((curr.total - COALESCE(prev.total, 0)) / NULLIF(COALESCE(prev.total, 0), 0)) * 100, 1) AS growth_rate
       FROM (
         SELECT DATE_FORMAT(bill_date, '%Y-%m') AS month, SUM(paid_amount) AS total
         FROM invoices WHERE deleted = 0 ${invoiceDateFilter.replace(/i\./g, '')}
         GROUP BY DATE_FORMAT(bill_date, '%Y-%m')
       ) curr
       LEFT JOIN (
         SELECT DATE_FORMAT(bill_date, '%Y-%m') AS month, SUM(paid_amount) AS total
         FROM invoices WHERE deleted = 0
         GROUP BY DATE_FORMAT(bill_date, '%Y-%m')
       ) prev ON prev.month = DATE_FORMAT(DATE_SUB(STR_TO_DATE(CONCAT(curr.month, '-01'), '%Y-%m-%d'), INTERVAL -1 MONTH), '%Y-%m')
       ORDER BY curr.month ASC
       LIMIT 12`,
      [...invoiceDateParams]
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // 23. DAILY REVENUE HEATMAP (last 90 days)
    // ═══════════════════════════════════════════════════════════════════════════
    const [revenueHeatmap] = await db.query(
      `SELECT 
        DATE_FORMAT(p.payment_date, '%Y-%m-%d') AS date,
        COUNT(*) AS payment_count,
        ROUND(SUM(p.amount), 2) AS total_collected
       FROM invoice_payments p
       WHERE p.payment_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
       GROUP BY p.payment_date
       ORDER BY p.payment_date DESC`,
      []
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // 24. EXPENSE HEATMAP (last 90 days)
    // ═══════════════════════════════════════════════════════════════════════════
    const [expenseHeatmap] = await db.query(
      `SELECT 
        DATE_FORMAT(e.expense_date, '%Y-%m-%d') AS date,
        COUNT(*) AS expense_count,
        ROUND(SUM(e.amount), 2) AS total_spent
       FROM expenses e
       WHERE e.deleted = 0 AND e.expense_date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
       GROUP BY e.expense_date
       ORDER BY e.expense_date DESC`,
      []
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // 25. FINANCIAL HEALTH SCORE (Composite)
    // ═══════════════════════════════════════════════════════════════════════════
    const collectionRate = parseFloat(revenueKpi[0].collection_rate || 0);
    const overdueRatio = revenueKpi[0].total_invoices > 0
      ? (revenueKpi[0].overdue_count / revenueKpi[0].total_invoices) * 100 : 0;
    const profitMarginScore = Math.min(Math.max(parseFloat(profitMargin), 0), 100);
    const expenseControlScore = totalIncome > 0
      ? Math.max(0, 100 - parseFloat(operatingExpenseRatio)) : 50;

    const financialHealthScore = Math.round(
      (collectionRate * 0.3) +
      (Math.max(0, 100 - overdueRatio) * 0.2) +
      (profitMarginScore * 0.3) +
      (expenseControlScore * 0.2)
    );

    const financialHealth = {
      overall_score: Math.min(financialHealthScore, 100),
      collection_efficiency: Math.round(collectionRate),
      overdue_risk: Math.round(overdueRatio),
      profit_margin_score: Math.round(profitMarginScore),
      expense_control_score: Math.round(expenseControlScore),
      rating: financialHealthScore >= 80 ? 'Excellent' :
              financialHealthScore >= 60 ? 'Good' :
              financialHealthScore >= 40 ? 'Fair' : 'Needs Attention',
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // 26. YEAR-OVER-YEAR COMPARISON
    // ═══════════════════════════════════════════════════════════════════════════
    const [yoyComparison] = await db.query(
      `SELECT 
        YEAR(i.bill_date) AS year,
        ROUND(SUM(i.total_amount), 2) AS total_invoiced,
        ROUND(SUM(i.paid_amount), 2) AS total_collected,
        COUNT(*) AS invoice_count,
        ROUND(AVG(i.total_amount), 2) AS avg_invoice_value
       FROM invoices i
       WHERE i.deleted = 0
       GROUP BY YEAR(i.bill_date)
       ORDER BY year DESC
       LIMIT 5`,
      []
    );

    const [yoyExpenses] = await db.query(
      `SELECT 
        YEAR(e.expense_date) AS year,
        ROUND(SUM(e.amount), 2) AS total_expenses,
        COUNT(*) AS expense_count,
        ROUND(AVG(e.amount), 2) AS avg_expense
       FROM expenses e
       WHERE e.deleted = 0
       GROUP BY YEAR(e.expense_date)
       ORDER BY year DESC
       LIMIT 5`,
      []
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // 27. INVOICE CONVERSION FUNNEL
    // ═══════════════════════════════════════════════════════════════════════════
    const [invoiceFunnel] = await db.query(
      `SELECT 
        COUNT(*) AS total_created,
        SUM(CASE WHEN i.status IN ('Partial', 'Paid') THEN 1 ELSE 0 END) AS payment_started,
        SUM(CASE WHEN i.status = 'Paid' THEN 1 ELSE 0 END) AS fully_paid,
        SUM(CASE WHEN i.status = 'Overdue' THEN 1 ELSE 0 END) AS overdue,
        ROUND(SUM(CASE WHEN i.status = 'Paid' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 1) AS full_payment_rate,
        ROUND(AVG(CASE WHEN i.status = 'Paid' THEN DATEDIFF(
          (SELECT MAX(p3.payment_date) FROM invoice_payments p3 WHERE p3.invoice_id = i.id),
          i.bill_date
        ) END), 0) AS avg_days_to_full_payment
       FROM invoices i
       WHERE i.deleted = 0 ${invoiceDateFilter}`,
      [...invoiceDateParams]
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // 28. WEEKLY FINANCIAL SNAPSHOT (last 12 weeks)
    // ═══════════════════════════════════════════════════════════════════════════
    const [weeklySnapshot] = await db.query(
      `SELECT 
        weeks.week_num,
        weeks.week_start,
        COALESCE(rev.collected, 0) AS revenue,
        COALESCE(exp.spent, 0) AS expenses,
        ROUND(COALESCE(rev.collected, 0) - COALESCE(exp.spent, 0), 2) AS net
       FROM (
         SELECT YEARWEEK(payment_date, 1) AS week_num, MIN(payment_date) AS week_start
         FROM invoice_payments WHERE payment_date >= DATE_SUB(CURDATE(), INTERVAL 12 WEEK)
         GROUP BY YEARWEEK(payment_date, 1)
         UNION
         SELECT YEARWEEK(expense_date, 1), MIN(expense_date)
         FROM expenses WHERE deleted = 0 AND expense_date >= DATE_SUB(CURDATE(), INTERVAL 12 WEEK)
         GROUP BY YEARWEEK(expense_date, 1)
       ) weeks
       LEFT JOIN (
         SELECT YEARWEEK(payment_date, 1) AS week_num, SUM(amount) AS collected
         FROM invoice_payments WHERE payment_date >= DATE_SUB(CURDATE(), INTERVAL 12 WEEK)
         GROUP BY YEARWEEK(payment_date, 1)
       ) rev ON rev.week_num = weeks.week_num
       LEFT JOIN (
         SELECT YEARWEEK(expense_date, 1) AS week_num, SUM(amount) AS spent
         FROM expenses WHERE deleted = 0 AND expense_date >= DATE_SUB(CURDATE(), INTERVAL 12 WEEK)
         GROUP BY YEARWEEK(expense_date, 1)
       ) exp ON exp.week_num = weeks.week_num
       ORDER BY weeks.week_num ASC`,
      []
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // 29. REIMBURSEMENT FINANCIAL IMPACT
    // ═══════════════════════════════════════════════════════════════════════════
    const [reimbursementImpact] = await db.query(
      `SELECT 
        COUNT(*) AS total_claims,
        ROUND(SUM(r.amount), 2) AS total_claimed,
        ROUND(SUM(CASE WHEN r.status IN ('approved', 'paid') THEN r.amount ELSE 0 END), 2) AS total_approved,
        ROUND(SUM(CASE WHEN r.status = 'paid' THEN r.amount ELSE 0 END), 2) AS total_disbursed,
        ROUND(SUM(CASE WHEN r.status = 'pending' THEN r.amount ELSE 0 END), 2) AS pending_liability,
        COUNT(DISTINCT r.user_id) AS employees_claiming
       FROM reimbursements r
       WHERE r.deleted = 0 ${expenseDateFilter.replace(/e\./g, 'r.').replace(/expense_date/g, 'expense_date')}`,
      [...expenseDateParams]
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // 30. COST PER EMPLOYEE (Total costs / headcount)
    // ═══════════════════════════════════════════════════════════════════════════
    const [costPerEmployee] = await db.query(
      `SELECT 
        COUNT(DISTINCT p.employee_id) AS headcount,
        ROUND(SUM(p.net_salary) / NULLIF(COUNT(DISTINCT CONCAT(p.pay_year, '-', p.pay_month)), 0), 2) AS avg_monthly_payroll,
        ROUND(SUM(p.net_salary) / NULLIF(COUNT(DISTINCT p.employee_id), 0), 2) AS total_cost_per_employee,
        ROUND(SUM(p.net_salary) / NULLIF(COUNT(DISTINCT p.employee_id) * COUNT(DISTINCT CONCAT(p.pay_year, '-', p.pay_month)), 0), 2) AS monthly_cost_per_employee
       FROM payroll p
       WHERE p.deleted = 0 AND p.status = 'Paid' ${payrollFilter}`,
      [...payrollParams]
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // RESPONSE
    // ═══════════════════════════════════════════════════════════════════════════
    return res.json({
      overview: {
        revenue: revenueKpi[0],
        expenses: expenseKpi[0],
        capital: capitalKpi[0],
        payroll: payrollKpi[0],
      },
      profitAndLoss,
      financialHealth,
      revenue: {
        trend: revenueTrend,
        growth: revenueGrowth,
        byService: revenueByService,
        topClients: topRevenueClients,
        heatmap: revenueHeatmap,
        funnel: invoiceFunnel[0],
      },
      expenses: {
        trend: expenseTrend,
        growth: expenseGrowth,
        byCategory: expenseByCategory,
        byPaymentMode: expenseByPaymentMode,
        topVendors,
        heatmap: expenseHeatmap,
      },
      cashFlow,
      invoiceAging: invoiceAging[0],
      overdueInvoices,
      payments: {
        trend: paymentTrend,
        methodDistribution: paymentMethodDist,
      },
      payroll: {
        trend: payrollTrend,
        deductions: payrollDeductions[0],
        topEarners,
        costPerEmployee: costPerEmployee[0],
      },
      capital: {
        trend: capitalTrend,
      },
      clientProfitability,
      monthlyPnL,
      yearOverYear: {
        revenue: yoyComparison,
        expenses: yoyExpenses,
      },
      weeklySnapshot,
      reimbursementImpact: reimbursementImpact[0],
    });
  } catch (err) {
    console.error('Finance report error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
