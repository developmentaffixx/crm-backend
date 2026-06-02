const db = require('../config/db');
const { autoGeneratePayroll } = require('../jobs/payrollCron');

// ─── Shared helper: generate payroll ID code ──────────────────────────────────
async function generatePayrollIdCode(payYear, payMonth, employeeId) {
  const payYY = String(payYear).slice(-2);
  const payMM = String(payMonth).padStart(2, '0');
  const [empRows] = await db.query('SELECT emp_code, is_admin FROM users WHERE id = ?', [employeeId]);
  const empCode = (empRows.length > 0 && empRows[0].emp_code)
    ? empRows[0].emp_code
    : (empRows[0]?.is_admin ? 'DOUBT' : `AFID${String(employeeId).padStart(3, '0')}`);
  const prefix = `PAY-${payYY}${payMM}-${empCode}`;
  const [lastRows] = await db.query(
    `SELECT payroll_id_code FROM payroll WHERE payroll_id_code LIKE ? ORDER BY id DESC LIMIT 1`,
    [`${prefix}-%`]
  );
  let seq = 1;
  if (lastRows.length > 0 && lastRows[0].payroll_id_code) {
    const parts = lastRows[0].payroll_id_code.split('-');
    seq = parseInt(parts[parts.length - 1], 10) + 1;
  }
  return `${prefix}-${String(seq).padStart(3, '0')}`;
}

// ─── GET /api/payroll ─────────────────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    const { month, year, status, search } = req.query;
    let where = 'p.deleted = 0';
    const params = [];

    if (month)  { where += ' AND p.pay_month = ?'; params.push(parseInt(month)); }
    if (year)   { where += ' AND p.pay_year = ?';  params.push(parseInt(year)); }
    if (status) { where += ' AND p.status = ?';    params.push(status); }
    if (search) {
      where += ' AND (CONCAT(u.first_name, " ", u.last_name) LIKE ? OR u.department LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s);
    }

    const [rows] = await db.query(
      `SELECT p.*,
              CONCAT(u.first_name, ' ', u.last_name) AS employee_name,
              u.department,
              u.designation,
              CONCAT(c.first_name, ' ', c.last_name) AS created_by_name
       FROM payroll p
       LEFT JOIN users u ON u.id = p.employee_id
       LEFT JOIN users c ON c.id = p.created_by
       WHERE ${where}
       ORDER BY p.pay_year DESC, p.pay_month DESC, u.first_name ASC`,
      params
    );

    const summary = {
      total_count:      rows.length,
      total_gross:      rows.reduce((s, r) => s + parseFloat(r.gross_salary    || 0), 0),
      total_deductions: rows.reduce((s, r) => s + parseFloat(r.total_deductions|| 0), 0),
      total_net:        rows.reduce((s, r) => s + parseFloat(r.net_salary      || 0), 0),
      total_lop:        rows.reduce((s, r) => s + parseFloat(r.lop_deduction   || 0), 0),
      paid_count:       rows.filter(r => r.status === 'Paid').length,
      draft_count:      rows.filter(r => r.status === 'Draft').length,
      auto_count:       rows.filter(r => r.auto_generated).length,
    };

    return res.json({ payroll: rows, summary });
  } catch (err) {
    console.error('Payroll list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── GET /api/payroll/:id ─────────────────────────────────────────────────────
exports.getOne = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT p.*,
              CONCAT(u.first_name, ' ', u.last_name) AS employee_name,
              u.department, u.designation, u.email AS employee_email,
              CONCAT(c.first_name, ' ', c.last_name) AS created_by_name
       FROM payroll p
       LEFT JOIN users u ON u.id = p.employee_id
       LEFT JOIN users c ON c.id = p.created_by
       WHERE p.id = ? AND p.deleted = 0`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Payroll record not found' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('Payroll getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── POST /api/payroll ────────────────────────────────────────────────────────
exports.create = async (req, res) => {
  try {
    const {
      employee_id, pay_month, pay_year,
      basic_salary, hra, allowances,
      pf_deduction, esi_deduction, professional_tax, other_deductions,
      lop_days, lop_deduction,
      working_days, days_present,
      payment_mode, payment_date, status, notes,
    } = req.body;

    if (!employee_id || !pay_month || !pay_year) {
      return res.status(400).json({ message: 'Employee, month, and year are required' });
    }

    const [existing] = await db.query(
      'SELECT id FROM payroll WHERE employee_id = ? AND pay_month = ? AND pay_year = ? AND deleted = 0',
      [employee_id, pay_month, pay_year]
    );
    if (existing.length > 0) {
      return res.status(400).json({ message: 'Payroll already exists for this employee in the selected month' });
    }

    const basic    = parseFloat(basic_salary   || 0);
    const hraAmt   = parseFloat(hra            || 0);
    const allowAmt = parseFloat(allowances     || 0);
    const pfAmt    = parseFloat(pf_deduction   || 0);
    const esiAmt   = parseFloat(esi_deduction  || 0);
    const ptAmt    = parseFloat(professional_tax || 0);
    const otherAmt = parseFloat(other_deductions || 0);
    const lopDays  = parseFloat(lop_days       || 0);
    const lopDed   = parseFloat(lop_deduction  || 0);

    const gross_salary     = parseFloat((basic + hraAmt + allowAmt).toFixed(2));
    const total_deductions = parseFloat((pfAmt + esiAmt + ptAmt + otherAmt).toFixed(2));
    const net_salary       = parseFloat((gross_salary - total_deductions).toFixed(2));

    const payroll_id_code = await generatePayrollIdCode(pay_year, pay_month, employee_id);

    const [result] = await db.query(
      `INSERT INTO payroll (
        payroll_id_code, employee_id, pay_month, pay_year,
        basic_salary, hra, allowances,
        working_days, days_present, lop_days, lop_deduction,
        gross_salary, pf_deduction, esi_deduction, professional_tax, other_deductions,
        total_deductions, net_salary,
        payment_mode, payment_date, status, notes, auto_generated, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        payroll_id_code,
        employee_id, pay_month, pay_year,
        basic, hraAmt, allowAmt,
        working_days || 0, days_present || 0, lopDays, lopDed,
        gross_salary, pfAmt, esiAmt, ptAmt, otherAmt,
        total_deductions, net_salary,
        payment_mode || 'Bank',
        payment_date || null,
        status || 'Draft',
        notes || null,
        req.user.id,
      ]
    );

    const [created] = await db.query(
      `SELECT p.*, CONCAT(u.first_name, ' ', u.last_name) AS employee_name,
              u.department, u.designation
       FROM payroll p LEFT JOIN users u ON u.id = p.employee_id WHERE p.id = ?`,
      [result.insertId]
    );
    res.emitSocket('payroll:created', created[0]);
    return res.status(201).json(created[0]);
  } catch (err) {
    console.error('Payroll create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── PUT /api/payroll/:id ─────────────────────────────────────────────────────
exports.update = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM payroll WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Payroll record not found' });

    const ex = rows[0];
    const {
      basic_salary, hra, allowances,
      pf_deduction, esi_deduction, professional_tax, other_deductions,
      lop_days, lop_deduction, working_days, days_present,
      payment_mode, payment_date, status, notes,
    } = req.body;

    const basic    = basic_salary    !== undefined ? parseFloat(basic_salary)    : parseFloat(ex.basic_salary);
    const hraAmt   = hra             !== undefined ? parseFloat(hra)             : parseFloat(ex.hra);
    const allowAmt = allowances      !== undefined ? parseFloat(allowances)      : parseFloat(ex.allowances);
    const pfAmt    = pf_deduction    !== undefined ? parseFloat(pf_deduction)    : parseFloat(ex.pf_deduction);
    const esiAmt   = esi_deduction   !== undefined ? parseFloat(esi_deduction)   : parseFloat(ex.esi_deduction);
    const ptAmt    = professional_tax!== undefined ? parseFloat(professional_tax): parseFloat(ex.professional_tax);
    const otherAmt = other_deductions!== undefined ? parseFloat(other_deductions): parseFloat(ex.other_deductions);
    const lopDays  = lop_days        !== undefined ? parseFloat(lop_days)        : parseFloat(ex.lop_days || 0);
    const lopDed   = lop_deduction   !== undefined ? parseFloat(lop_deduction)   : parseFloat(ex.lop_deduction || 0);
    const wDays    = working_days    !== undefined ? parseInt(working_days)      : (ex.working_days || 0);
    const dPresent = days_present    !== undefined ? parseInt(days_present)      : (ex.days_present || 0);

    const gross_salary     = parseFloat((basic + hraAmt + allowAmt).toFixed(2));
    const total_deductions = parseFloat((pfAmt + esiAmt + ptAmt + otherAmt).toFixed(2));
    const net_salary       = parseFloat((gross_salary - total_deductions).toFixed(2));

    await db.query(
      `UPDATE payroll SET
        basic_salary = ?, hra = ?, allowances = ?,
        working_days = ?, days_present = ?, lop_days = ?, lop_deduction = ?,
        gross_salary = ?, pf_deduction = ?, esi_deduction = ?, professional_tax = ?, other_deductions = ?,
        total_deductions = ?, net_salary = ?,
        payment_mode = ?, payment_date = ?, status = ?, notes = ?
       WHERE id = ?`,
      [
        basic, hraAmt, allowAmt,
        wDays, dPresent, lopDays, lopDed,
        gross_salary, pfAmt, esiAmt, ptAmt, otherAmt,
        total_deductions, net_salary,
        payment_mode  || ex.payment_mode,
        payment_date  !== undefined ? (payment_date || null) : ex.payment_date,
        status        || ex.status,
        notes         !== undefined ? notes : ex.notes,
        req.params.id,
      ]
    );

    const [updated] = await db.query(
      `SELECT p.*, CONCAT(u.first_name, ' ', u.last_name) AS employee_name,
              u.department, u.designation
       FROM payroll p LEFT JOIN users u ON u.id = p.employee_id WHERE p.id = ?`,
      [req.params.id]
    );
    res.emitSocket('payroll:updated', updated[0]);
    return res.json(updated[0]);
  } catch (err) {
    console.error('Payroll update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── PUT /api/payroll/:id/mark-paid ───────────────────────────────────────────
exports.markPaid = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM payroll WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Payroll record not found' });

    const { payment_date, payment_mode } = req.body;
    await db.query(
      `UPDATE payroll SET status = 'Paid', payment_date = ?, payment_mode = ? WHERE id = ?`,
      [payment_date || new Date().toISOString().split('T')[0], payment_mode || rows[0].payment_mode, req.params.id]
    );

    const [updated] = await db.query(
      `SELECT p.*, CONCAT(u.first_name, ' ', u.last_name) AS employee_name,
              u.department, u.designation
       FROM payroll p LEFT JOIN users u ON u.id = p.employee_id WHERE p.id = ?`,
      [req.params.id]
    );
    res.emitSocket('payroll:updated', updated[0]);
    return res.json(updated[0]);
  } catch (err) {
    console.error('Payroll markPaid error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── DELETE /api/payroll/:id ──────────────────────────────────────────────────
exports.remove = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM payroll WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Payroll record not found' });

    await db.query('UPDATE payroll SET deleted = 1 WHERE id = ?', [req.params.id]);
    res.emitSocket('payroll:deleted', { id: req.params.id });
    return res.json({ message: 'Payroll record deleted' });
  } catch (err) {
    console.error('Payroll delete error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── POST /api/payroll/generate (manual bulk generate) ───────────────────────
exports.generate = async (req, res) => {
  try {
    const { pay_month, pay_year } = req.body;
    if (!pay_month || !pay_year) {
      return res.status(400).json({ message: 'Month and year are required' });
    }
    // Reuse the same cron logic for manual trigger
    await autoGeneratePayroll(parseInt(pay_month), parseInt(pay_year));

    // Return updated counts from cron log
    const [logRows] = await db.query(
      `SELECT * FROM payroll_cron_log WHERE pay_month = ? AND pay_year = ? ORDER BY id DESC LIMIT 1`,
      [pay_month, pay_year]
    );
    const log = logRows[0] || {};
    return res.json({
      message: `Payroll generated: ${log.created_count || 0} created, ${log.skipped_count || 0} skipped`,
      created: log.created_count || 0,
      skipped: log.skipped_count || 0,
    });
  } catch (err) {
    console.error('Payroll generate error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── GET /api/payroll/cron-logs ───────────────────────────────────────────────
// Returns last 10 cron run logs so HR can see when auto-generate ran
exports.cronLogs = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT * FROM payroll_cron_log ORDER BY id DESC LIMIT 10`
    );
    return res.json({ logs: rows });
  } catch (err) {
    console.error('Cron logs error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── POST /api/payroll/:id/payslip-pdf ───────────────────────────────────────
exports.generatePayslipPdf = async (req, res) => {
  const puppeteer = require('puppeteer');
  const path      = require('path');
  const fs        = require('fs');

  try {
    // ── Fetch payroll record ──────────────────────────────────────────────────
    const [rows] = await db.query(
      `SELECT p.*,
              CONCAT(u.first_name, ' ', u.last_name) AS employee_name,
              u.department, u.designation, u.emp_code, u.email AS employee_email,
              u.date_of_joining
       FROM payroll p
       LEFT JOIN users u ON u.id = p.employee_id
       WHERE p.id = ? AND p.deleted = 0`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Payroll record not found' });
    const p = rows[0];

    // ── Fetch company settings ────────────────────────────────────────────────
    const [companies] = await db.query('SELECT * FROM company_settings LIMIT 1');
    const company = companies[0] || {};

    // Convert logo to base64
    const toBase64 = (filePath) => {
      try {
        if (!filePath) return '';
        const absPath = path.join(__dirname, '../../', filePath);
        if (!fs.existsSync(absPath)) return '';
        const buffer = fs.readFileSync(absPath);
        const ext  = path.extname(filePath).toLowerCase();
        const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' }[ext] || 'image/png';
        return `data:${mime};base64,${buffer.toString('base64')}`;
      } catch { return ''; }
    };
    const logoBase64 = toBase64(company.logo_url);

    // ── Helpers ───────────────────────────────────────────────────────────────
    const MONTH_NAMES = ['', 'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];
    const fmt = (v) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtDate = (d) => {
      if (!d) return '—';
      const dt = new Date(d);
      return `${String(dt.getDate()).padStart(2, '0')}-${String(dt.getMonth() + 1).padStart(2, '0')}-${dt.getFullYear()}`;
    };
    function numberToWords(num) {
      if (!num || num === 0) return 'Zero Only';
      const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
      const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
      function convert(n) {
        if (n < 20) return ones[n];
        if (n < 100) return tens[Math.floor(n/10)]+(n%10?' '+ones[n%10]:'');
        if (n < 1000) return ones[Math.floor(n/100)]+' Hundred'+(n%100?' '+convert(n%100):'');
        if (n < 100000) return convert(Math.floor(n/1000))+' Thousand'+(n%1000?' '+convert(n%1000):'');
        if (n < 10000000) return convert(Math.floor(n/100000))+' Lakh'+(n%100000?' '+convert(n%100000):'');
        return convert(Math.floor(n/10000000))+' Crore'+(n%10000000?' '+convert(n%10000000):'');
      }
      const intPart = Math.floor(num);
      const decPart = Math.round((num - intPart) * 100);
      let result = 'Rs. ' + convert(intPart);
      if (decPart > 0) result += ' and ' + convert(decPart) + ' Paise';
      return result + ' Only';
    }

    const gross      = parseFloat(p.gross_salary     || 0);
    const deductions = parseFloat(p.total_deductions || 0);
    const net        = parseFloat(p.net_salary       || 0);
    const lopDed     = parseFloat(p.lop_deduction    || 0);
    const lopDays    = parseFloat(p.lop_days         || 0);
    const paidLeaveUsed = parseFloat(p.paid_leave_used    || 0);
    const paidLeaveBal  = parseFloat(p.paid_leave_balance || 0);

    const companyAddress = [company.address_line1, company.address_line2, company.city, company.state, company.zip_code]
      .filter(Boolean).join(', ');
    const companyContact = [
      company.phone ? `Mobile : ${company.phone}` : '',
      company.email ? `Email : ${company.email}` : '',
    ].filter(Boolean).join(' | ');

    // ── Build HTML (invoice-style) ────────────────────────────────────────────
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>Payslip - ${p.employee_name} - ${MONTH_NAMES[p.pay_month]} ${p.pay_year}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  @page { margin:0; size:A4; }
  body { font-family:'Segoe UI',Arial,sans-serif; font-size:11px; color:#222; background:#fff; }
  .page { width:210mm; min-height:297mm; padding:12mm; }
  .invoice-border { border:1.5px solid #222; }
  .header-row { text-align:center; padding:8px; border-bottom:1px solid #222; }
  .header-row h3 { font-size:14px; letter-spacing:2px; }
  .header-row .subtitle { font-size:9px; color:#666; margin-top:2px; }
  .company-row { display:flex; align-items:center; padding:12px 16px; border-bottom:1px solid #222; gap:16px; }
  .company-row .logo { width:60px; height:60px; object-fit:contain; flex-shrink:0; }
  .company-row .logo-ph { width:60px; height:60px; background:#f0f0f0; border-radius:6px; flex-shrink:0; }
  .company-row h2 { font-size:20px; font-weight:800; text-transform:uppercase; margin:0 0 4px 0; }
  .company-row p { font-size:10px; color:#444; margin:2px 0; }
  .details-section { border-bottom:1px solid #222; padding:8px 12px; }
  .details-section .row { display:flex; margin-bottom:3px; }
  .details-section .row .label { width:140px; font-weight:600; }
  .col-header { background:#f0f0f0; padding:4px 12px; font-weight:700; font-size:10px; text-transform:uppercase; border-bottom:1px solid #222; }
  .two-col-grid { display:grid; grid-template-columns:1fr 1fr; border-bottom:1px solid #222; }
  .two-col-grid .col { padding:8px 12px; }
  .two-col-grid .col:first-child { border-right:1px solid #222; }
  .two-col-grid .col .row { display:flex; margin-bottom:3px; font-size:10px; }
  .two-col-grid .col .row .label { width:120px; font-weight:600; color:#444; }
  .att-section { border-bottom:1px solid #222; }
  .att-grid { display:grid; grid-template-columns:repeat(4,1fr); }
  .att-cell { padding:8px 12px; text-align:center; border-right:1px solid #ddd; }
  .att-cell:last-child { border-right:none; }
  .att-cell .val { font-size:18px; font-weight:800; }
  .att-cell .lbl { font-size:9px; color:#666; margin-top:2px; }
  table.salary { width:100%; border-collapse:collapse; }
  table.salary th, table.salary td { border:1px solid #222; padding:6px 10px; font-size:10px; }
  table.salary th { background:#f0f0f0; font-weight:700; text-transform:uppercase; font-size:9px; }
  table.salary .subtotal-row td { background:#f8f8f8; font-weight:600; }
  table.salary .total-row td { background:#f0f0f0; font-weight:800; font-size:12px; }
  .amount-words { border-top:1px solid #222; padding:8px 12px; font-style:italic; font-weight:600; font-size:11px; }
  .footer-grid { display:grid; grid-template-columns:1fr 1fr 1fr; border-top:1px solid #222; }
  .footer-grid .cell { padding:10px 12px; }
  .footer-grid .cell:not(:last-child) { border-right:1px solid #222; }
  .footer-grid .cell-title { font-weight:700; font-size:10px; margin-bottom:6px; }
  .footer-grid .cell p { font-size:9px; color:#555; margin-bottom:3px; }
  .sign-block { display:flex; flex-direction:column; justify-content:space-between; height:100%; }
  .sign-block .company-for { font-weight:700; font-size:10px; text-align:right; }
  .sign-block .sign-line { border-top:1px solid #666; padding-top:4px; text-align:center; font-size:10px; color:#666; margin-top:50px; }
  .invoice-footer { border-top:1px solid #222; text-align:center; padding:6px; font-size:9px; color:#666; font-style:italic; }
</style></head>
<body><div class="page"><div class="invoice-border">

  <div class="header-row">
    <h3>SALARY SLIP</h3>
    <p class="subtitle">${MONTH_NAMES[p.pay_month]} ${p.pay_year} &nbsp;|&nbsp; ${p.status === 'Paid' ? 'PAID' : 'DRAFT'}</p>
  </div>

  <div class="company-row">
    ${logoBase64 ? `<img src="${logoBase64}" class="logo" alt="Logo"/>` : `<div class="logo-ph"></div>`}
    <div>
      <h2>${company.company_name || 'COMPANY NAME'}</h2>
      <p>${companyAddress || ''}</p>
      <p>${companyContact || ''}</p>
      ${company.website ? `<p>${company.website}</p>` : ''}
    </div>
  </div>

  <div class="details-section">
    <div class="row"><span class="label">Payslip ID</span><span>: ${p.payroll_id_code || '—'}</span></div>
    <div class="row"><span class="label">Pay Period</span><span>: ${MONTH_NAMES[p.pay_month]} ${p.pay_year}</span></div>
    <div class="row"><span class="label">Payment Mode</span><span>: ${p.payment_mode || '—'}</span></div>
    ${p.payment_date ? `<div class="row"><span class="label">Payment Date</span><span>: ${fmtDate(p.payment_date)}</span></div>` : ''}
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;">
    <div class="col-header" style="border-right:1px solid #222;">Employee Details</div>
    <div class="col-header">Employment Info</div>
  </div>
  <div class="two-col-grid">
    <div class="col">
      <div class="row"><span class="label">Name</span><span>: ${p.employee_name || '—'}</span></div>
      <div class="row"><span class="label">Employee ID</span><span>: ${p.emp_code || '—'}</span></div>
      <div class="row"><span class="label">Designation</span><span>: ${p.designation || '—'}</span></div>
      <div class="row"><span class="label">Department</span><span>: ${p.department || '—'}</span></div>
      ${p.employee_email ? `<div class="row"><span class="label">Email</span><span>: ${p.employee_email}</span></div>` : ''}
    </div>
    <div class="col">
      <div class="row"><span class="label">Date of Joining</span><span>: ${fmtDate(p.date_of_joining)}</span></div>
      <div class="row"><span class="label">Employment Status</span><span>: ${p.is_probation ? 'Probation' : 'Confirmed'}</span></div>
      ${!p.is_probation ? `<div class="row"><span class="label">Leave Balance</span><span>: ${paidLeaveBal} day(s)</span></div>` : ''}
      ${paidLeaveUsed > 0 ? `<div class="row"><span class="label">Paid Leave Used</span><span>: ${paidLeaveUsed} day(s)</span></div>` : ''}
      ${parseFloat(p.per_day_salary||0)>0 ? `
      <div class="row"><span class="label">Per Day Salary</span><span>: &#8377;${fmt(p.per_day_salary)}</span></div>
      <div class="row"><span class="label">Per Hour Salary</span><span>: &#8377;${fmt(p.per_hour_salary)}</span></div>` : ''}
    </div>
  </div>

  ${p.working_days > 0 ? `
  <div class="att-section">
    <div class="col-header">Attendance Summary</div>
    <div class="att-grid">
      <div class="att-cell"><div class="val">${p.working_days}</div><div class="lbl">Working Days</div></div>
      <div class="att-cell"><div class="val" style="color:#16a34a;">${p.days_present}</div><div class="lbl">Days Present</div></div>
      <div class="att-cell"><div class="val" style="color:#2563eb;">${paidLeaveUsed}</div><div class="lbl">Paid Leave Used</div></div>
      <div class="att-cell"><div class="val" style="color:#dc2626;">${lopDays}</div><div class="lbl">LOP Days</div></div>
    </div>
  </div>` : ''}

  <table class="salary">
    <thead>
      <tr>
        <th style="text-align:left;width:38%;">Earnings</th>
        <th style="text-align:right;width:18%;">Amount (&#8377;)</th>
        <th style="text-align:left;width:30%;">Deductions</th>
        <th style="text-align:right;width:14%;">Amount (&#8377;)</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Basic Salary</td><td style="text-align:right;">&#8377;${fmt(p.basic_salary)}</td>
        ${lopDed>0 ? `<td style="color:#c0392b;">Loss of Pay (${lopDays} days)</td><td style="text-align:right;color:#c0392b;">&#8377;${fmt(lopDed)}</td>`
                   : `<td>Provident Fund (PF)</td><td style="text-align:right;">&#8377;${fmt(p.pf_deduction)}</td>`}
      </tr>
      <tr>
        <td>House Rent Allowance (HRA)</td><td style="text-align:right;">&#8377;${fmt(p.hra)}</td>
        ${lopDed>0 ? `<td>Provident Fund (PF)</td><td style="text-align:right;">&#8377;${fmt(p.pf_deduction)}</td>`
                   : `<td>ESI</td><td style="text-align:right;">&#8377;${fmt(p.esi_deduction)}</td>`}
      </tr>
      <tr>
        <td>Allowances</td><td style="text-align:right;">&#8377;${fmt(p.allowances)}</td>
        ${lopDed>0 ? `<td>ESI</td><td style="text-align:right;">&#8377;${fmt(p.esi_deduction)}</td>`
                   : `<td>Professional Tax</td><td style="text-align:right;">&#8377;${fmt(p.professional_tax)}</td>`}
      </tr>
      ${lopDed>0 ? `<tr><td></td><td></td><td>Professional Tax</td><td style="text-align:right;">&#8377;${fmt(p.professional_tax)}</td></tr>` : ''}
      ${parseFloat(p.other_deductions||0)>0 ? `<tr><td></td><td></td><td>Other Deductions</td><td style="text-align:right;">&#8377;${fmt(p.other_deductions)}</td></tr>` : ''}
      <tr class="subtotal-row">
        <td>Gross Salary</td><td style="text-align:right;">&#8377;${fmt(gross)}</td>
        <td>Total Deductions</td><td style="text-align:right;">&#8377;${fmt(deductions)}</td>
      </tr>
      <tr class="total-row">
        <td colspan="2" style="text-align:center;">NET PAY &nbsp; &#8377;${fmt(net)}</td>
        <td colspan="2" style="text-align:center;font-size:10px;font-weight:600;color:#555;">${numberToWords(net)}</td>
      </tr>
    </tbody>
  </table>

  <div class="footer-grid">
    <div class="cell">
      <p class="cell-title">NOTE</p>
      ${p.notes ? `<p>${p.notes}</p>` : `<p>This is a computer-generated payslip.</p><p style="margin-top:4px;">For queries, contact HR.</p>`}
    </div>
    <div class="cell" style="display:flex;flex-direction:column;align-items:center;justify-content:center;">
      <p class="cell-title" style="text-align:center;">STATUS</p>
      <div style="margin-top:8px;padding:6px 20px;border:2px solid ${p.status==='Paid'?'#16a34a':'#d97706'};border-radius:4px;color:${p.status==='Paid'?'#16a34a':'#d97706'};font-weight:800;font-size:14px;letter-spacing:2px;">
        ${p.status==='Paid'?'PAID':'DRAFT'}
      </div>
      ${p.payment_date ? `<p style="font-size:9px;color:#666;margin-top:6px;">Paid on: ${fmtDate(p.payment_date)}</p>` : ''}
    </div>
    <div class="cell">
      <div class="sign-block">
        <p class="company-for">For ${company.company_name || 'Company Name'}</p>
        <div class="sign-line">Authorised Signatory</div>
      </div>
    </div>
  </div>

  <div class="invoice-footer">Payslip Generated by ${company.company_name || 'CRM'} &nbsp;|&nbsp; ${p.payroll_id_code || ''}</div>

</div></div></body></html>`;

    // ── Generate PDF with Puppeteer ───────────────────────────────────────────
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });

    await browser.close();

    // ── Save & return URL ─────────────────────────────────────────────────────
    const uploadsDir = path.join(__dirname, '../../uploads/documents');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

    const filename = `payslip_${p.payroll_id_code || req.params.id}_${Date.now()}.pdf`;
    const filepath = path.join(uploadsDir, filename);
    fs.writeFileSync(filepath, pdfBuffer);

    return res.json({ url: `/uploads/documents/${filename}`, filename });
  } catch (err) {
    console.error('Payslip PDF error:', err);
    return res.status(500).json({ message: 'Failed to generate payslip PDF: ' + err.message });
  }
};

// ─── POST /api/payroll/payslip-range-pdf ─────────────────────────────────────
// Body: { employee_id, from_month, from_year, to_month, to_year }
exports.generatePayslipRangePdf = async (req, res) => {
  const puppeteer = require('puppeteer');
  const path      = require('path');
  const fs        = require('fs');

  try {
    const { employee_id, from_month, from_year, to_month, to_year } = req.body;
    if (!employee_id || !from_month || !from_year || !to_month || !to_year) {
      return res.status(400).json({ message: 'employee_id, from_month, from_year, to_month, to_year are required' });
    }

    // Build list of (month, year) pairs in range
    const months = [];
    let y = parseInt(from_year), m = parseInt(from_month);
    const endY = parseInt(to_year), endM = parseInt(to_month);
    while (y < endY || (y === endY && m <= endM)) {
      months.push({ month: m, year: y });
      m++; if (m > 12) { m = 1; y++; }
    }
    if (months.length === 0) return res.status(400).json({ message: 'Invalid date range' });
    if (months.length > 24)  return res.status(400).json({ message: 'Range cannot exceed 24 months' });

    // Fetch all payroll records for this employee in range
    const placeholders = months.map(() => '(pay_month = ? AND pay_year = ?)').join(' OR ');
    const qParams = [parseInt(employee_id), ...months.flatMap(mo => [mo.month, mo.year])];
    const [rows] = await db.query(
      `SELECT p.*,
              CONCAT(u.first_name, ' ', u.last_name) AS employee_name,
              u.department, u.designation, u.emp_code, u.email AS employee_email,
              u.date_of_joining
       FROM payroll p
       LEFT JOIN users u ON u.id = p.employee_id
       WHERE p.employee_id = ? AND p.deleted = 0 AND (${placeholders})
       ORDER BY p.pay_year ASC, p.pay_month ASC`,
      qParams
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'No payroll records found for this employee in the selected range' });
    }

    // Fetch company settings
    const [companies] = await db.query('SELECT * FROM company_settings LIMIT 1');
    const company = companies[0] || {};
    const toBase64 = (fp) => {
      try {
        if (!fp) return '';
        const abs = path.join(__dirname, '../../', fp);
        if (!fs.existsSync(abs)) return '';
        const buf = fs.readFileSync(abs);
        const ext = path.extname(fp).toLowerCase();
        const mime = {'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.webp':'image/webp'}[ext]||'image/png';
        return `data:${mime};base64,${buf.toString('base64')}`;
      } catch { return ''; }
    };
    const logoBase64 = toBase64(company.logo_url);

    const MONTH_NAMES = ['','January','February','March','April','May','June','July','August','September','October','November','December'];
    const fmt = (v) => Number(v||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
    const fmtDate = (d) => { if(!d)return'—'; const dt=new Date(d); return `${String(dt.getDate()).padStart(2,'0')}-${String(dt.getMonth()+1).padStart(2,'0')}-${dt.getFullYear()}`; };
    function ntw(num) {
      if(!num||num===0)return'Zero Only';
      const o=['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
      const t=['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
      function c(n){if(n<20)return o[n];if(n<100)return t[Math.floor(n/10)]+(n%10?' '+o[n%10]:'');if(n<1000)return o[Math.floor(n/100)]+' Hundred'+(n%100?' '+c(n%100):'');if(n<100000)return c(Math.floor(n/1000))+' Thousand'+(n%1000?' '+c(n%1000):'');if(n<10000000)return c(Math.floor(n/100000))+' Lakh'+(n%100000?' '+c(n%100000):'');return c(Math.floor(n/10000000))+' Crore'+(n%10000000?' '+c(n%10000000):'');}
      const i=Math.floor(num),d=Math.round((num-i)*100);
      return 'Rs. '+c(i)+(d>0?' and '+c(d)+' Paise':'')+' Only';
    }

    const companyAddress = [company.address_line1,company.address_line2,company.city,company.state,company.zip_code].filter(Boolean).join(', ');
    const companyContact = [company.phone?`Mobile : ${company.phone}`:'',company.email?`Email : ${company.email}`:''].filter(Boolean).join(' | ');

    const buildPage = (p, isFirst) => {
      const gross=parseFloat(p.gross_salary||0), ded=parseFloat(p.total_deductions||0), net=parseFloat(p.net_salary||0);
      const lopDed=parseFloat(p.lop_deduction||0), lopDays=parseFloat(p.lop_days||0);
      const plUsed=parseFloat(p.paid_leave_used||0), plBal=parseFloat(p.paid_leave_balance||0);
      return `<div class="page${isFirst?'':' page-break'}"><div class="invoice-border">
  <div class="header-row"><h3>SALARY SLIP</h3><p class="subtitle">${MONTH_NAMES[p.pay_month]} ${p.pay_year} &nbsp;|&nbsp; ${p.status==='Paid'?'PAID':'DRAFT'}</p></div>
  <div class="company-row">${logoBase64?`<img src="${logoBase64}" class="logo" alt="Logo"/>`:`<div class="logo-ph"></div>`}<div><h2>${company.company_name||'COMPANY NAME'}</h2><p>${companyAddress||''}</p><p>${companyContact||''}</p>${company.website?`<p>${company.website}</p>`:''}</div></div>
  <div class="details-section">
    <div class="row"><span class="label">Payslip ID</span><span>: ${p.payroll_id_code||'—'}</span></div>
    <div class="row"><span class="label">Pay Period</span><span>: ${MONTH_NAMES[p.pay_month]} ${p.pay_year}</span></div>
    <div class="row"><span class="label">Payment Mode</span><span>: ${p.payment_mode||'—'}</span></div>
    ${p.payment_date?`<div class="row"><span class="label">Payment Date</span><span>: ${fmtDate(p.payment_date)}</span></div>`:''}
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;"><div class="col-header" style="border-right:1px solid #222;">Employee Details</div><div class="col-header">Employment Info</div></div>
  <div class="two-col-grid">
    <div class="col">
      <div class="row"><span class="label">Name</span><span>: ${p.employee_name||'—'}</span></div>
      <div class="row"><span class="label">Employee ID</span><span>: ${p.emp_code||'—'}</span></div>
      <div class="row"><span class="label">Designation</span><span>: ${p.designation||'—'}</span></div>
      <div class="row"><span class="label">Department</span><span>: ${p.department||'—'}</span></div>
      ${p.employee_email?`<div class="row"><span class="label">Email</span><span>: ${p.employee_email}</span></div>`:''}
    </div>
    <div class="col">
      <div class="row"><span class="label">Date of Joining</span><span>: ${fmtDate(p.date_of_joining)}</span></div>
      <div class="row"><span class="label">Employment Status</span><span>: ${p.is_probation?'Probation':'Confirmed'}</span></div>
      ${!p.is_probation?`<div class="row"><span class="label">Leave Balance</span><span>: ${plBal} day(s)</span></div>`:''}
      ${plUsed>0?`<div class="row"><span class="label">Paid Leave Used</span><span>: ${plUsed} day(s)</span></div>`:''}
      ${parseFloat(p.per_day_salary||0)>0?`<div class="row"><span class="label">Per Day Salary</span><span>: &#8377;${fmt(p.per_day_salary)}</span></div><div class="row"><span class="label">Per Hour Salary</span><span>: &#8377;${fmt(p.per_hour_salary)}</span></div>`:''}
    </div>
  </div>
  ${p.working_days>0?`<div class="att-section"><div class="col-header">Attendance Summary</div><div class="att-grid"><div class="att-cell"><div class="val">${p.working_days}</div><div class="lbl">Working Days</div></div><div class="att-cell"><div class="val" style="color:#16a34a;">${p.days_present}</div><div class="lbl">Days Present</div></div><div class="att-cell"><div class="val" style="color:#2563eb;">${plUsed}</div><div class="lbl">Paid Leave Used</div></div><div class="att-cell"><div class="val" style="color:#dc2626;">${lopDays}</div><div class="lbl">LOP Days</div></div></div></div>`:''}
  <table class="salary"><thead><tr><th style="text-align:left;width:38%;">Earnings</th><th style="text-align:right;width:18%;">Amount (&#8377;)</th><th style="text-align:left;width:30%;">Deductions</th><th style="text-align:right;width:14%;">Amount (&#8377;)</th></tr></thead>
  <tbody>
    <tr><td>Basic Salary</td><td style="text-align:right;">&#8377;${fmt(p.basic_salary)}</td>${lopDed>0?`<td style="color:#c0392b;">Loss of Pay (${lopDays} days)</td><td style="text-align:right;color:#c0392b;">&#8377;${fmt(lopDed)}</td>`:`<td>Provident Fund (PF)</td><td style="text-align:right;">&#8377;${fmt(p.pf_deduction)}</td>`}</tr>
    <tr><td>HRA</td><td style="text-align:right;">&#8377;${fmt(p.hra)}</td>${lopDed>0?`<td>Provident Fund (PF)</td><td style="text-align:right;">&#8377;${fmt(p.pf_deduction)}</td>`:`<td>ESI</td><td style="text-align:right;">&#8377;${fmt(p.esi_deduction)}</td>`}</tr>
    <tr><td>Allowances</td><td style="text-align:right;">&#8377;${fmt(p.allowances)}</td>${lopDed>0?`<td>ESI</td><td style="text-align:right;">&#8377;${fmt(p.esi_deduction)}</td>`:`<td>Professional Tax</td><td style="text-align:right;">&#8377;${fmt(p.professional_tax)}</td>`}</tr>
    ${lopDed>0?`<tr><td></td><td></td><td>Professional Tax</td><td style="text-align:right;">&#8377;${fmt(p.professional_tax)}</td></tr>`:''}
    ${parseFloat(p.other_deductions||0)>0?`<tr><td></td><td></td><td>Other Deductions</td><td style="text-align:right;">&#8377;${fmt(p.other_deductions)}</td></tr>`:''}
    <tr class="subtotal-row"><td>Gross Salary</td><td style="text-align:right;">&#8377;${fmt(gross)}</td><td>Total Deductions</td><td style="text-align:right;">&#8377;${fmt(ded)}</td></tr>
    <tr class="total-row"><td colspan="2" style="text-align:center;">NET PAY &nbsp; &#8377;${fmt(net)}</td><td colspan="2" style="text-align:center;font-size:10px;font-weight:600;color:#555;">${ntw(net)}</td></tr>
  </tbody></table>
  <div class="footer-grid">
    <div class="cell"><p class="cell-title">NOTE</p>${p.notes?`<p>${p.notes}</p>`:`<p>Computer-generated payslip. Contact HR for queries.</p>`}</div>
    <div class="cell" style="display:flex;flex-direction:column;align-items:center;justify-content:center;"><p class="cell-title" style="text-align:center;">STATUS</p><div style="margin-top:8px;padding:6px 20px;border:2px solid ${p.status==='Paid'?'#16a34a':'#d97706'};border-radius:4px;color:${p.status==='Paid'?'#16a34a':'#d97706'};font-weight:800;font-size:14px;letter-spacing:2px;">${p.status==='Paid'?'PAID':'DRAFT'}</div>${p.payment_date?`<p style="font-size:9px;color:#666;margin-top:6px;">Paid on: ${fmtDate(p.payment_date)}</p>`:''}</div>
    <div class="cell"><div class="sign-block"><p class="company-for">For ${company.company_name||'Company Name'}</p><div class="sign-line">Authorised Signatory</div></div></div>
  </div>
  <div class="invoice-footer">Payslip Generated by ${company.company_name||'CRM'} &nbsp;|&nbsp; ${p.payroll_id_code||''}</div>
</div></div>`;
    };

    const pagesHtml = rows.map((p, i) => buildPage(p, i === 0)).join('\n');
    const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box;}@page{margin:0;size:A4;}
  body{font-family:'Segoe UI',Arial,sans-serif;font-size:11px;color:#222;background:#fff;}
  .page{width:210mm;min-height:297mm;padding:12mm;}.page-break{page-break-before:always;}
  .invoice-border{border:1.5px solid #222;}.header-row{text-align:center;padding:8px;border-bottom:1px solid #222;}
  .header-row h3{font-size:14px;letter-spacing:2px;}.header-row .subtitle{font-size:9px;color:#666;margin-top:2px;}
  .company-row{display:flex;align-items:center;padding:12px 16px;border-bottom:1px solid #222;gap:16px;}
  .company-row .logo{width:60px;height:60px;object-fit:contain;flex-shrink:0;}
  .company-row .logo-ph{width:60px;height:60px;background:#f0f0f0;border-radius:6px;flex-shrink:0;}
  .company-row h2{font-size:20px;font-weight:800;text-transform:uppercase;margin:0 0 4px 0;}
  .company-row p{font-size:10px;color:#444;margin:2px 0;}
  .details-section{border-bottom:1px solid #222;padding:8px 12px;}
  .details-section .row{display:flex;margin-bottom:3px;}.details-section .row .label{width:140px;font-weight:600;}
  .col-header{background:#f0f0f0;padding:4px 12px;font-weight:700;font-size:10px;text-transform:uppercase;border-bottom:1px solid #222;}
  .two-col-grid{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid #222;}
  .two-col-grid .col{padding:8px 12px;}.two-col-grid .col:first-child{border-right:1px solid #222;}
  .two-col-grid .col .row{display:flex;margin-bottom:3px;font-size:10px;}
  .two-col-grid .col .row .label{width:120px;font-weight:600;color:#444;}
  .att-section{border-bottom:1px solid #222;}.att-grid{display:grid;grid-template-columns:repeat(4,1fr);}
  .att-cell{padding:8px 12px;text-align:center;border-right:1px solid #ddd;}.att-cell:last-child{border-right:none;}
  .att-cell .val{font-size:18px;font-weight:800;}.att-cell .lbl{font-size:9px;color:#666;margin-top:2px;}
  table.salary{width:100%;border-collapse:collapse;}
  table.salary th,table.salary td{border:1px solid #222;padding:6px 10px;font-size:10px;}
  table.salary th{background:#f0f0f0;font-weight:700;text-transform:uppercase;font-size:9px;}
  table.salary .subtotal-row td{background:#f8f8f8;font-weight:600;}
  table.salary .total-row td{background:#f0f0f0;font-weight:800;font-size:12px;}
  .footer-grid{display:grid;grid-template-columns:1fr 1fr 1fr;border-top:1px solid #222;}
  .footer-grid .cell{padding:10px 12px;}.footer-grid .cell:not(:last-child){border-right:1px solid #222;}
  .footer-grid .cell-title{font-weight:700;font-size:10px;margin-bottom:6px;}
  .footer-grid .cell p{font-size:9px;color:#555;margin-bottom:3px;}
  .sign-block{display:flex;flex-direction:column;justify-content:space-between;height:100%;}
  .sign-block .company-for{font-weight:700;font-size:10px;text-align:right;}
  .sign-block .sign-line{border-top:1px solid #666;padding-top:4px;text-align:center;font-size:10px;color:#666;margin-top:50px;}
  .invoice-footer{border-top:1px solid #222;text-align:center;padding:6px;font-size:9px;color:#666;font-style:italic;}
</style></head><body>${pagesHtml}</body></html>`;

    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page    = await browser.newPage();
    await page.setContent(fullHtml, { waitUntil: 'domcontentloaded' });
    const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true, margin: { top:'0', right:'0', bottom:'0', left:'0' } });
    await browser.close();

    const uploadsDir = path.join(__dirname, '../../uploads/documents');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    const empCode  = rows[0].emp_code || `EMP${String(employee_id).padStart(3,'0')}`;
    const filename = `payslips_${empCode}_${from_month}${from_year}_to_${to_month}${to_year}_${Date.now()}.pdf`;
    fs.writeFileSync(path.join(uploadsDir, filename), pdfBuffer);

    return res.json({ url: `/uploads/documents/${filename}`, filename, count: rows.length, message: `${rows.length} payslip(s) generated` });
  } catch (err) {
    console.error('Payslip range PDF error:', err);
    return res.status(500).json({ message: 'Failed to generate payslip range PDF: ' + err.message });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// SALARY STRUCTURES
// ═══════════════════════════════════════════════════════════════════════════════

exports.listStructures = async (req, res) => {
  try {
    const { search } = req.query;
    let where = 'ss.deleted = 0';
    const params = [];
    if (search) {
      where += ' AND (CONCAT(u.first_name, " ", u.last_name) LIKE ? OR u.department LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s);
    }
    const [rows] = await db.query(
      `SELECT ss.*,
              CONCAT(u.first_name, ' ', u.last_name) AS employee_name,
              u.department, u.designation
       FROM salary_structures ss
       LEFT JOIN users u ON u.id = ss.employee_id
       WHERE ${where}
       ORDER BY u.first_name ASC, ss.effective_from DESC`,
      params
    );
    return res.json({ structures: rows });
  } catch (err) {
    console.error('Salary structures list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.getStructure = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT ss.*, CONCAT(u.first_name, ' ', u.last_name) AS employee_name,
              u.department, u.designation
       FROM salary_structures ss
       LEFT JOIN users u ON u.id = ss.employee_id
       WHERE ss.id = ? AND ss.deleted = 0`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Salary structure not found' });
    return res.json(rows[0]);
  } catch (err) {
    console.error('Salary structure getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.createStructure = async (req, res) => {
  try {
    const {
      employee_id, basic_salary, hra, allowances,
      pf_deduction, esi_deduction, professional_tax, other_deductions, effective_from,
      probation_start_date, probation_end_date, employment_status,
      hike_amount, post_probation_salary, per_day_salary, per_hour_salary,
      working_days_per_month, working_hours_per_day,
    } = req.body;

    if (!employee_id || !basic_salary) {
      return res.status(400).json({ message: 'Employee and basic salary are required' });
    }

    const [result] = await db.query(
      `INSERT INTO salary_structures (
        employee_id, basic_salary, hra, allowances,
        pf_deduction, esi_deduction, professional_tax, other_deductions, effective_from,
        probation_start_date, probation_end_date, employment_status,
        hike_amount, post_probation_salary, per_day_salary, per_hour_salary,
        working_days_per_month, working_hours_per_day, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        employee_id,
        parseFloat(basic_salary  || 0),
        parseFloat(hra           || 0),
        parseFloat(allowances    || 0),
        parseFloat(pf_deduction  || 0),
        parseFloat(esi_deduction || 0),
        parseFloat(professional_tax  || 0),
        parseFloat(other_deductions  || 0),
        effective_from || new Date().toISOString().split('T')[0],
        probation_start_date || null,
        probation_end_date || null,
        employment_status || 'probation',
        parseFloat(hike_amount || 0),
        parseFloat(post_probation_salary || 0),
        parseFloat(per_day_salary || 0),
        parseFloat(per_hour_salary || 0),
        parseInt(working_days_per_month) || 30,
        parseInt(working_hours_per_day) || 8,
        req.user.id,
      ]
    );

    // Also update the users table employment fields
    if (employment_status || probation_end_date) {
      await db.query(
        `UPDATE users SET employment_status = ?, probation_end_date = ? WHERE id = ?`,
        [employment_status || 'probation', probation_end_date || null, employee_id]
      );
    }

    const [created] = await db.query(
      `SELECT ss.*, CONCAT(u.first_name, ' ', u.last_name) AS employee_name, u.department, u.designation
       FROM salary_structures ss LEFT JOIN users u ON u.id = ss.employee_id WHERE ss.id = ?`,
      [result.insertId]
    );
    return res.status(201).json(created[0]);
  } catch (err) {
    console.error('Salary structure create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.updateStructure = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM salary_structures WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Salary structure not found' });

    const ex = rows[0];
    const {
      basic_salary, hra, allowances,
      pf_deduction, esi_deduction, professional_tax, other_deductions, effective_from,
      probation_start_date, probation_end_date, employment_status,
      hike_amount, post_probation_salary, per_day_salary, per_hour_salary,
      working_days_per_month, working_hours_per_day,
    } = req.body;

    await db.query(
      `UPDATE salary_structures SET
        basic_salary = ?, hra = ?, allowances = ?,
        pf_deduction = ?, esi_deduction = ?, professional_tax = ?, other_deductions = ?,
        effective_from = ?,
        probation_start_date = ?, probation_end_date = ?, employment_status = ?,
        hike_amount = ?, post_probation_salary = ?, per_day_salary = ?, per_hour_salary = ?,
        working_days_per_month = ?, working_hours_per_day = ?
       WHERE id = ?`,
      [
        basic_salary    !== undefined ? parseFloat(basic_salary)    : ex.basic_salary,
        hra             !== undefined ? parseFloat(hra)             : ex.hra,
        allowances      !== undefined ? parseFloat(allowances)      : ex.allowances,
        pf_deduction    !== undefined ? parseFloat(pf_deduction)    : ex.pf_deduction,
        esi_deduction   !== undefined ? parseFloat(esi_deduction)   : ex.esi_deduction,
        professional_tax!== undefined ? parseFloat(professional_tax): ex.professional_tax,
        other_deductions!== undefined ? parseFloat(other_deductions): ex.other_deductions,
        effective_from  || ex.effective_from,
        probation_start_date !== undefined ? (probation_start_date || null) : ex.probation_start_date,
        probation_end_date   !== undefined ? (probation_end_date || null)   : ex.probation_end_date,
        employment_status    || ex.employment_status || 'probation',
        hike_amount          !== undefined ? parseFloat(hike_amount)          : (ex.hike_amount || 0),
        post_probation_salary!== undefined ? parseFloat(post_probation_salary): (ex.post_probation_salary || 0),
        per_day_salary       !== undefined ? parseFloat(per_day_salary)       : (ex.per_day_salary || 0),
        per_hour_salary      !== undefined ? parseFloat(per_hour_salary)      : (ex.per_hour_salary || 0),
        working_days_per_month !== undefined ? parseInt(working_days_per_month) : (ex.working_days_per_month || 30),
        working_hours_per_day  !== undefined ? parseInt(working_hours_per_day)  : (ex.working_hours_per_day || 8),
        req.params.id,
      ]
    );

    // Also update users table employment fields
    const empStatus = employment_status || ex.employment_status;
    const probEnd   = probation_end_date !== undefined ? (probation_end_date || null) : ex.probation_end_date;
    await db.query(
      `UPDATE users SET employment_status = ?, probation_end_date = ? WHERE id = ?`,
      [empStatus, probEnd, ex.employee_id]
    );

    const [updated] = await db.query(
      `SELECT ss.*, CONCAT(u.first_name, ' ', u.last_name) AS employee_name, u.department, u.designation
       FROM salary_structures ss LEFT JOIN users u ON u.id = ss.employee_id WHERE ss.id = ?`,
      [req.params.id]
    );
    return res.json(updated[0]);
  } catch (err) {
    console.error('Salary structure update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.removeStructure = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM salary_structures WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Salary structure not found' });

    await db.query('UPDATE salary_structures SET deleted = 1 WHERE id = ?', [req.params.id]);
    return res.json({ message: 'Salary structure deleted' });
  } catch (err) {
    console.error('Salary structure delete error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
