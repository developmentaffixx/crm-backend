const db = require('../config/db');

/**
 * GET /api/reports/finance
 * Simplified Finance Report
 * Query params: startDate, endDate
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
    // 1. KPI: REVENUE
    // ═══════════════════════════════════════════════════════════════════════════
    const [revenueKpi] = await db.query(
      `SELECT 
        COUNT(*) AS total_invoices,
        COALESCE(SUM(i.total_amount), 0) AS total_invoiced,
        COALESCE(SUM(i.paid_amount), 0) AS total_collected,
        COALESCE(SUM(i.balance_amount), 0) AS total_outstanding,
        SUM(CASE WHEN i.status = 'Overdue' THEN 1 ELSE 0 END) AS overdue_count
       FROM invoices i
       WHERE i.deleted = 0 ${invoiceDateFilter}`,
      [...invoiceDateParams]
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // 2. KPI: EXPENSES
    // ═══════════════════════════════════════════════════════════════════════════
    const [expenseKpi] = await db.query(
      `SELECT 
        COUNT(*) AS total_expenses,
        COALESCE(SUM(e.amount), 0) AS total_expense_amount
       FROM expenses e
       WHERE e.deleted = 0 ${expenseDateFilter}`,
      [...expenseDateParams]
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // 3. KPI: CAPITAL
    // ═══════════════════════════════════════════════════════════════════════════
    const [capitalKpi] = await db.query(
      `SELECT 
        COALESCE(SUM(c.amount), 0) AS total_capital
       FROM capital c
       WHERE c.deleted = 0 ${capitalDateFilter}`,
      [...capitalDateParams]
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // 4. KPI: PAYROLL
    // ═══════════════════════════════════════════════════════════════════════════
    const [payrollKpi] = await db.query(
      `SELECT 
        COALESCE(SUM(p.net_salary), 0) AS total_net_salary,
        COUNT(DISTINCT p.employee_id) AS employees_paid
       FROM payroll p
       WHERE p.deleted = 0 AND p.status = 'Paid' ${payrollFilter}`,
      [...payrollParams]
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // 5. PROFIT & LOSS (computed)
    // ═══════════════════════════════════════════════════════════════════════════
    const totalRevenue = parseFloat(revenueKpi[0].total_collected || 0);
    const totalExpenses = parseFloat(expenseKpi[0].total_expense_amount || 0);
    const totalPayroll = parseFloat(payrollKpi[0].total_net_salary || 0);
    const totalCapital = parseFloat(capitalKpi[0].total_capital || 0);
    const netProfit = totalRevenue - totalExpenses - totalPayroll;

    // ═══════════════════════════════════════════════════════════════════════════
    // 6. MONTHLY P&L TREND
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
    // 7. CASH FLOW (Monthly inflow vs outflow)
    // ═══════════════════════════════════════════════════════════════════════════
    const [cashFlowIn] = await db.query(
      `SELECT 
        DATE_FORMAT(p.payment_date, '%Y-%m') AS month,
        ROUND(SUM(p.amount), 2) AS amount
       FROM invoice_payments p
       WHERE 1=1 ${paymentDateFilter}
       GROUP BY DATE_FORMAT(p.payment_date, '%Y-%m')
       ORDER BY month ASC LIMIT 24`,
      [...paymentDateParams]
    );

    const [cashFlowCapital] = await db.query(
      `SELECT 
        DATE_FORMAT(c.capital_date, '%Y-%m') AS month,
        ROUND(SUM(c.amount), 2) AS amount
       FROM capital c
       WHERE c.deleted = 0 ${capitalDateFilter}
       GROUP BY DATE_FORMAT(c.capital_date, '%Y-%m')
       ORDER BY month ASC LIMIT 24`,
      [...capitalDateParams]
    );

    const [cashFlowExpenses] = await db.query(
      `SELECT 
        DATE_FORMAT(e.expense_date, '%Y-%m') AS month,
        ROUND(SUM(e.amount), 2) AS amount
       FROM expenses e
       WHERE e.deleted = 0 ${expenseDateFilter}
       GROUP BY DATE_FORMAT(e.expense_date, '%Y-%m')
       ORDER BY month ASC LIMIT 24`,
      [...expenseDateParams]
    );

    const [cashFlowPayroll] = await db.query(
      `SELECT 
        CONCAT(p.pay_year, '-', LPAD(p.pay_month, 2, '0')) AS month,
        ROUND(SUM(p.net_salary), 2) AS amount
       FROM payroll p
       WHERE p.deleted = 0 AND p.status = 'Paid' ${payrollFilter}
       GROUP BY p.pay_year, p.pay_month
       ORDER BY p.pay_year ASC, p.pay_month ASC LIMIT 24`,
      [...payrollParams]
    );

    // Merge cash flow
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
      };
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // 8. EXPENSE BY CATEGORY (donut)
    // ═══════════════════════════════════════════════════════════════════════════
    const [expenseByCategory] = await db.query(
      `SELECT 
        e.category,
        COUNT(*) AS count,
        ROUND(SUM(e.amount), 2) AS total_amount
       FROM expenses e
       WHERE e.deleted = 0 ${expenseDateFilter}
       GROUP BY e.category
       ORDER BY total_amount DESC
       LIMIT 10`,
      [...expenseDateParams]
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // 9. TOP CLIENTS (revenue + outstanding)
    // ═══════════════════════════════════════════════════════════════════════════
    const [topClients] = await db.query(
      `SELECT 
        l.id AS client_id,
        l.name AS client_name,
        l.business_name,
        COUNT(i.id) AS invoice_count,
        ROUND(SUM(i.paid_amount), 2) AS total_paid,
        ROUND(SUM(i.balance_amount), 2) AS outstanding
       FROM invoices i
       JOIN leads l ON l.id = i.lead_id
       WHERE i.deleted = 0 ${invoiceDateFilter}
       GROUP BY l.id, l.name, l.business_name
       ORDER BY total_paid DESC
       LIMIT 10`,
      [...invoiceDateParams]
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // 10. INVOICE AGING (5 buckets)
    // ═══════════════════════════════════════════════════════════════════════════
    const [invoiceAging] = await db.query(
      `SELECT 
        SUM(CASE WHEN DATEDIFF(CURDATE(), i.due_date) <= 0 THEN i.balance_amount ELSE 0 END) AS not_yet_due,
        SUM(CASE WHEN DATEDIFF(CURDATE(), i.due_date) BETWEEN 1 AND 30 THEN i.balance_amount ELSE 0 END) AS days_1_30,
        SUM(CASE WHEN DATEDIFF(CURDATE(), i.due_date) BETWEEN 31 AND 60 THEN i.balance_amount ELSE 0 END) AS days_31_60,
        SUM(CASE WHEN DATEDIFF(CURDATE(), i.due_date) BETWEEN 61 AND 90 THEN i.balance_amount ELSE 0 END) AS days_61_90,
        SUM(CASE WHEN DATEDIFF(CURDATE(), i.due_date) > 90 THEN i.balance_amount ELSE 0 END) AS days_over_90,
        COUNT(CASE WHEN DATEDIFF(CURDATE(), i.due_date) > 0 AND i.balance_amount > 0 THEN 1 END) AS overdue_invoice_count
       FROM invoices i
       WHERE i.deleted = 0 AND i.balance_amount > 0`,
      []
    );

    // ═══════════════════════════════════════════════════════════════════════════
    // 11. OVERDUE INVOICES (table)
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
    // RESPONSE
    // ═══════════════════════════════════════════════════════════════════════════
    return res.json({
      kpis: {
        total_revenue: totalRevenue,
        total_expenses: totalExpenses,
        net_profit: netProfit,
        total_payroll: totalPayroll,
        total_capital: totalCapital,
        total_outstanding: parseFloat(revenueKpi[0].total_outstanding || 0),
        total_invoices: revenueKpi[0].total_invoices,
        overdue_count: revenueKpi[0].overdue_count,
        employees_paid: payrollKpi[0].employees_paid,
      },
      monthlyPnL,
      cashFlow,
      expenseByCategory,
      topClients,
      invoiceAging: invoiceAging[0],
      overdueInvoices,
    });
  } catch (err) {
    console.error('Finance report error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
