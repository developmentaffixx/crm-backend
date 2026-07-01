const db = require('../config/db');

const FIXED_DAYS = 30;
const MONTH_NAMES = ['','January','February','March','April','May','June',
  'July','August','September','October','November','December'];

// ─── Helper: generate payroll code ───────────────────────────────────────────
async function generatePayrollCode(payYear, payMonth, employeeId) {
  const yy = String(payYear).slice(-2);
  const mm = String(payMonth).padStart(2, '0');
  const [empRows] = await db.query('SELECT emp_code FROM users WHERE id = ?', [employeeId]);
  const empCode = empRows[0]?.emp_code || `EMP${String(employeeId).padStart(3, '0')}`;
  const prefix = `PAY-${yy}${mm}-${empCode}`;
  const [last] = await db.query(
    `SELECT payroll_code FROM payroll WHERE payroll_code LIKE ? ORDER BY id DESC LIMIT 1`,
    [`${prefix}-%`]
  );
  let seq = 1;
  if (last.length > 0 && last[0].payroll_code) {
    const parts = last[0].payroll_code.split('-');
    seq = parseInt(parts[parts.length - 1], 10) + 1;
  }
  return `${prefix}-${String(seq).padStart(3, '0')}`;
}

// ─── Helper: working days (pro-rata for mid-month join/exit) ─────────────────
function calcWorkingDays(year, month, dateOfJoining, lastWorkingDate) {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd   = new Date(year, month, 0); // last day of month

  let startDay = 1;
  let endDay   = monthEnd.getDate();

  if (dateOfJoining) {
    const doj = new Date(dateOfJoining);
    if (doj.getFullYear() === year && doj.getMonth() + 1 === month) {
      startDay = doj.getDate();
    }
  }
  if (lastWorkingDate) {
    const lwd = new Date(lastWorkingDate);
    if (lwd.getFullYear() === year && lwd.getMonth() + 1 === month) {
      endDay = lwd.getDate();
    }
  }

  // Pro-rata out of 30
  const calendarDays = monthEnd.getDate();
  const workedDays   = endDay - startDay + 1;
  return Math.round((workedDays / calendarDays) * FIXED_DAYS);
}

// ─── Helper: get attendance days present ─────────────────────────────────────
async function getAttendance(employeeId, year, month, dateOfJoining, lastWorkingDate) {
  const mm       = String(month).padStart(2, '0');
  const monthEnd = new Date(year, month, 0);

  let startDate = `${year}-${mm}-01`;
  let endDate   = `${year}-${mm}-${String(monthEnd.getDate()).padStart(2, '0')}`;

  if (dateOfJoining) {
    const doj = new Date(dateOfJoining);
    if (doj.getFullYear() === year && doj.getMonth() + 1 === month) {
      startDate = dateOfJoining instanceof Date
        ? doj.toISOString().split('T')[0]
        : String(dateOfJoining).split('T')[0];
    }
  }
  if (lastWorkingDate) {
    const lwd = new Date(lastWorkingDate);
    if (lwd.getFullYear() === year && lwd.getMonth() + 1 === month) {
      endDate = lastWorkingDate instanceof Date
        ? lwd.toISOString().split('T')[0]
        : String(lastWorkingDate).split('T')[0];
    }
  }

  const [rows] = await db.query(
    `SELECT COUNT(*) AS days_present FROM attendance
     WHERE user_id = ? AND date >= ? AND date <= ? AND clock_out IS NOT NULL`,
    [employeeId, startDate, endDate]
  );
  return rows[0]?.days_present || 0;
}

// ─── Helper: calculate payroll figures ───────────────────────────────────────
function calcPayroll(workingDays, daysPresent, monthlySalary, employmentStatus) {
  const absentDays = Math.max(0, workingDays - daysPresent);
  const perDay     = parseFloat((monthlySalary / FIXED_DAYS).toFixed(2));

  // Pro-rata salary for the working days period
  const proRataSalary = parseFloat((workingDays * perDay).toFixed(2));

  let paidLeaveUsed = 0;
  let lopDays       = 0;

  if (employmentStatus === 'permanent' || employmentStatus === 'confirmed') {
    // 1 paid leave per month (lapse — no carryover)
    if (absentDays <= 1) {
      paidLeaveUsed = absentDays;
      lopDays       = 0;
    } else {
      paidLeaveUsed = 1;
      lopDays       = absentDays - 1;
    }
  } else {
    // Probation: all absent days = LOP
    paidLeaveUsed = 0;
    lopDays       = absentDays;
  }

  const lopDeduction = parseFloat((lopDays * perDay).toFixed(2));
  const baseSalary   = parseFloat((proRataSalary - lopDeduction).toFixed(2));

  return { perDay, proRataSalary, paidLeaveUsed, lopDays, lopDeduction, baseSalary, absentDays };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EMPLOYEE SALARY ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/payroll/salaries — list all employee salaries (latest per employee)
exports.listSalaries = async (req, res) => {
  try {
    const { search } = req.query;
    let where = 'u.deleted = 0 AND u.is_active = 1';
    const params = [];
    if (search) {
      where += ' AND (CONCAT(u.first_name," ",u.last_name) LIKE ? OR u.department LIKE ? OR u.designation LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    const [rows] = await db.query(
      `SELECT u.id AS employee_id,
              CONCAT(u.first_name,' ',u.last_name) AS employee_name,
              u.department, u.designation, u.emp_code,
              u.date_of_joining, u.last_working_date, u.employment_status,
              es.id AS salary_id, es.monthly_salary, es.effective_from
       FROM users u
       LEFT JOIN employee_salary es ON es.id = (
         SELECT id FROM employee_salary
         WHERE employee_id = u.id
         ORDER BY effective_from DESC LIMIT 1
       )
       WHERE ${where} AND u.is_admin = 0
       ORDER BY u.first_name ASC`,
      params
    );
    return res.json({ salaries: rows });
  } catch (err) {
    console.error('listSalaries error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// POST /api/payroll/salaries — set/update salary for an employee
exports.setSalary = async (req, res) => {
  try {
    const { employee_id, monthly_salary, effective_from, employment_status, last_working_date } = req.body;
    if (!employee_id || !monthly_salary) {
      return res.status(400).json({ message: 'employee_id and monthly_salary are required' });
    }
    const [result] = await db.query(
      `INSERT INTO employee_salary (employee_id, monthly_salary, effective_from, created_by)
       VALUES (?, ?, ?, ?)`,
      [employee_id, parseFloat(monthly_salary), effective_from || new Date().toISOString().split('T')[0], req.user.id]
    );
    // Always update employment_status and last_working_date on users table
    await db.query(
      `UPDATE users SET
         employment_status = ?,
         last_working_date = ?
       WHERE id = ?`,
      [employment_status || 'probation', last_working_date || null, employee_id]
    );
    const [created] = await db.query(
      `SELECT es.*, CONCAT(u.first_name,' ',u.last_name) AS employee_name
       FROM employee_salary es JOIN users u ON u.id = es.employee_id WHERE es.id = ?`,
      [result.insertId]
    );
    return res.status(201).json(created[0]);
  } catch (err) {
    console.error('setSalary error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// PUT /api/payroll/salaries/:id — update a salary record
exports.updateSalary = async (req, res) => {
  try {
    const { monthly_salary, effective_from, employment_status, last_working_date } = req.body;
    const [rows] = await db.query('SELECT * FROM employee_salary WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Salary record not found' });
    await db.query(
      `UPDATE employee_salary SET monthly_salary = ?, effective_from = ? WHERE id = ?`,
      [parseFloat(monthly_salary ?? rows[0].monthly_salary), effective_from || rows[0].effective_from, req.params.id]
    );
    // Always update employment_status and last_working_date if provided
    const newStatus  = employment_status  !== undefined ? employment_status  : null;
    const newLwd     = last_working_date  !== undefined ? (last_working_date || null) : null;
    if (newStatus !== null || last_working_date !== undefined) {
      const setParts = [];
      const setVals  = [];
      if (newStatus !== null)          { setParts.push('employment_status = ?'); setVals.push(newStatus); }
      if (last_working_date !== undefined) { setParts.push('last_working_date = ?'); setVals.push(newLwd); }
      if (setParts.length > 0) {
        setVals.push(rows[0].employee_id);
        await db.query(`UPDATE users SET ${setParts.join(', ')} WHERE id = ?`, setVals);
      }
    }
    const [updated] = await db.query(
      `SELECT es.*, CONCAT(u.first_name,' ',u.last_name) AS employee_name,
              u.employment_status, u.last_working_date
       FROM employee_salary es JOIN users u ON u.id = es.employee_id WHERE es.id = ?`,
      [req.params.id]
    );
    return res.json(updated[0]);
  } catch (err) {
    console.error('updateSalary error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// PAYROLL ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

// POST /api/payroll/generate — bulk generate payroll for a month
exports.generate = async (req, res) => {
  try {
    const { pay_month, pay_year } = req.body;
    if (!pay_month || !pay_year) {
      return res.status(400).json({ message: 'pay_month and pay_year are required' });
    }
    const month = parseInt(pay_month);
    const year  = parseInt(pay_year);
    const targetDate = `${year}-${String(month).padStart(2, '0')}-01`;

    // Get all active employees with salary
    const [employees] = await db.query(
      `SELECT u.id, u.emp_code, u.employment_status, u.date_of_joining, u.last_working_date,
              es.monthly_salary
       FROM users u
       INNER JOIN employee_salary es ON es.id = (
         SELECT id FROM employee_salary
         WHERE employee_id = u.id AND effective_from <= ?
         ORDER BY effective_from DESC LIMIT 1
       )
       WHERE u.deleted = 0 AND u.is_active = 1 AND u.is_admin = 0`,
      [targetDate]
    );

    // Check existing payroll for this month
    const [existing] = await db.query(
      'SELECT employee_id FROM payroll WHERE pay_month = ? AND pay_year = ? AND deleted = 0',
      [month, year]
    );
    const existingSet = new Set(existing.map(r => r.employee_id));

    let created = 0, skipped = 0;

    for (const emp of employees) {
      if (existingSet.has(emp.id)) { skipped++; continue; }

      // Skip if employee left before this month
      if (emp.last_working_date) {
        const lwd = new Date(emp.last_working_date);
        if (lwd < new Date(year, month - 1, 1)) { skipped++; continue; }
      }

      const workingDays  = calcWorkingDays(year, month, emp.date_of_joining, emp.last_working_date);
      const daysPresent  = await getAttendance(emp.id, year, month, emp.date_of_joining, emp.last_working_date);
      const empStatus    = (emp.employment_status === 'permanent' || emp.employment_status === 'confirmed') ? 'permanent' : 'probation';
      const { perDay, paidLeaveUsed, lopDays, lopDeduction, absentDays } = calcPayroll(workingDays, daysPresent, emp.monthly_salary, empStatus);

      const netSalary   = parseFloat((workingDays * perDay - lopDeduction).toFixed(2));
      const payrollCode = await generatePayrollCode(year, month, emp.id);

      await db.query(
        `INSERT INTO payroll (
           payroll_code, employee_id, pay_month, pay_year, employment_status,
           working_days, days_present, absent_days, paid_leave_used, lop_days,
           monthly_salary, per_day_salary, lop_deduction, bonus, advance_deduction, other_deduction, net_salary,
           payment_mode, status, auto_generated, created_by
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,0,?,'Bank','Draft',1,1)`,
        [payrollCode, emp.id, month, year, empStatus,
         workingDays, daysPresent, absentDays, paidLeaveUsed, lopDays,
         emp.monthly_salary, perDay, lopDeduction, netSalary]
      );
      created++;
    }

    return res.json({ message: `Payroll generated: ${created} created, ${skipped} skipped`, created, skipped });
  } catch (err) {
    console.error('generate error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// GET /api/payroll — list payroll records
exports.list = async (req, res) => {
  try {
    const { month, year, status, search } = req.query;
    let where = 'p.deleted = 0';
    const params = [];
    if (month)  { where += ' AND p.pay_month = ?'; params.push(parseInt(month)); }
    if (year)   { where += ' AND p.pay_year = ?';  params.push(parseInt(year)); }
    if (status) { where += ' AND p.status = ?';    params.push(status); }
    if (search) {
      where += ' AND (CONCAT(u.first_name," ",u.last_name) LIKE ? OR u.department LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    const [rows] = await db.query(
      `SELECT p.*,
              CONCAT(u.first_name,' ',u.last_name) AS employee_name,
              u.department, u.designation, u.emp_code
       FROM payroll p
       LEFT JOIN users u ON u.id = p.employee_id
       WHERE ${where}
       ORDER BY p.pay_year DESC, p.pay_month DESC, u.first_name ASC`,
      params
    );
    const summary = {
      total:        rows.length,
      total_net:    rows.reduce((s, r) => s + parseFloat(r.net_salary || 0), 0),
      total_lop:    rows.reduce((s, r) => s + parseFloat(r.lop_deduction || 0), 0),
      total_bonus:  rows.reduce((s, r) => s + parseFloat(r.bonus || 0), 0),
      paid_count:   rows.filter(r => r.status === 'Paid').length,
      draft_count:  rows.filter(r => r.status === 'Draft').length,
    };
    return res.json({ payroll: rows, summary });
  } catch (err) {
    console.error('list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// GET /api/payroll/:id
exports.getOne = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT p.*, CONCAT(u.first_name,' ',u.last_name) AS employee_name,
              u.department, u.designation, u.emp_code, u.email AS employee_email, u.date_of_joining
       FROM payroll p LEFT JOIN users u ON u.id = p.employee_id
       WHERE p.id = ? AND p.deleted = 0`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Payroll record not found' });
    return res.json(rows[0]);
  } catch (err) {
    return res.status(500).json({ message: 'Server error' });
  }
};

// PUT /api/payroll/:id — HR adjusts bonus, deductions, notes
exports.update = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM payroll WHERE id = ? AND deleted = 0', [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Payroll record not found' });
    const ex = rows[0];
    const { bonus, advance_deduction, other_deduction, notes, payment_mode } = req.body;

    const bonusAmt   = bonus            !== undefined ? parseFloat(bonus)            : parseFloat(ex.bonus);
    const advAmt     = advance_deduction!== undefined ? parseFloat(advance_deduction): parseFloat(ex.advance_deduction);
    const otherAmt   = other_deduction  !== undefined ? parseFloat(other_deduction)  : parseFloat(ex.other_deduction);

    // Recalculate net: (workingDays × perDay) - lopDeduction + bonus - advance - other
    const netSalary = parseFloat(
      (ex.working_days * ex.per_day_salary - parseFloat(ex.lop_deduction) + bonusAmt - advAmt - otherAmt).toFixed(2)
    );

    await db.query(
      `UPDATE payroll SET bonus=?, advance_deduction=?, other_deduction=?, net_salary=?, notes=?, payment_mode=? WHERE id=?`,
      [bonusAmt, advAmt, otherAmt, netSalary, notes ?? ex.notes, payment_mode || ex.payment_mode, req.params.id]
    );
    const [updated] = await db.query(
      `SELECT p.*, CONCAT(u.first_name,' ',u.last_name) AS employee_name, u.department, u.designation
       FROM payroll p LEFT JOIN users u ON u.id = p.employee_id WHERE p.id = ?`,
      [req.params.id]
    );
    res.emitSocket('payroll:updated', updated[0]);
    return res.json(updated[0]);
  } catch (err) {
    console.error('update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// PUT /api/payroll/:id/mark-paid
exports.markPaid = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM payroll WHERE id = ? AND deleted = 0', [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Payroll record not found' });
    const { payment_date, payment_mode } = req.body;
    await db.query(
      `UPDATE payroll SET status='Paid', payment_date=?, payment_mode=? WHERE id=?`,
      [payment_date || new Date().toISOString().split('T')[0], payment_mode || rows[0].payment_mode, req.params.id]
    );
    const [updated] = await db.query(
      `SELECT p.*, CONCAT(u.first_name,' ',u.last_name) AS employee_name, u.department, u.designation
       FROM payroll p LEFT JOIN users u ON u.id = p.employee_id WHERE p.id = ?`,
      [req.params.id]
    );
    res.emitSocket('payroll:updated', updated[0]);
    return res.json(updated[0]);
  } catch (err) {
    return res.status(500).json({ message: 'Server error' });
  }
};

// DELETE /api/payroll/:id — soft delete
exports.remove = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT id FROM payroll WHERE id = ? AND deleted = 0', [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Payroll record not found' });
    await db.query('UPDATE payroll SET deleted = 1 WHERE id = ?', [req.params.id]);
    res.emitSocket('payroll:deleted', { id: parseInt(req.params.id) });
    return res.json({ message: 'Payroll record deleted' });
  } catch (err) {
    return res.status(500).json({ message: 'Server error' });
  }
};

// POST /api/payroll/:id/payslip-pdf
exports.generatePayslipPdf = async (req, res) => {
  const puppeteer = require('puppeteer');
  const path      = require('path');
  const fs        = require('fs');
  try {
    const [rows] = await db.query(
      `SELECT p.*, CONCAT(u.first_name,' ',u.last_name) AS employee_name,
              u.department, u.designation, u.emp_code, u.email AS employee_email, u.date_of_joining
       FROM payroll p LEFT JOIN users u ON u.id = p.employee_id
       WHERE p.id = ? AND p.deleted = 0`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ message: 'Payroll record not found' });
    const p = rows[0];

    const [companies] = await db.query('SELECT * FROM company_settings LIMIT 1');
    const co = companies[0] || {};

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
    const logo = toBase64(co.logo_url);

    const fmt     = v => Number(v||0).toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2});
    const fmtDate = d => { if(!d) return '—'; const dt=new Date(d); return `${String(dt.getDate()).padStart(2,'0')}-${String(dt.getMonth()+1).padStart(2,'0')}-${dt.getFullYear()}`; };
    const coAddr  = [co.address_line1, co.address_line2, co.city, co.state, co.zip_code].filter(Boolean).join(', ');

    function numToWords(n) {
      if(!n||n===0) return 'Zero Only';
      const o=['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
      const t=['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
      function c(x){if(x<20)return o[x];if(x<100)return t[Math.floor(x/10)]+(x%10?' '+o[x%10]:'');if(x<1000)return o[Math.floor(x/100)]+' Hundred'+(x%100?' '+c(x%100):'');if(x<100000)return c(Math.floor(x/1000))+' Thousand'+(x%1000?' '+c(x%1000):'');if(x<10000000)return c(Math.floor(x/100000))+' Lakh'+(x%100000?' '+c(x%100000):'');return c(Math.floor(x/10000000))+' Crore'+(x%10000000?' '+c(x%10000000):'');}
      const i=Math.floor(n), d=Math.round((n-i)*100);
      return 'Rs. '+c(i)+(d>0?' and '+c(d)+' Paise':'')+' Only';
    }

    const net       = parseFloat(p.net_salary||0);
    const lop       = parseFloat(p.lop_deduction||0);
    const bonus     = parseFloat(p.bonus||0);
    const advance   = parseFloat(p.advance_deduction||0);
    const other     = parseFloat(p.other_deduction||0);
    const grossBase = parseFloat((p.working_days * p.per_day_salary).toFixed(2));

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Payslip</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
@page{margin:0;size:A4;}
body{font-family:'Segoe UI',Arial,sans-serif;font-size:11px;color:#222;background:#fff;}
.page{width:210mm;min-height:297mm;padding:12mm;}
.border{border:1.5px solid #222;}
.header{text-align:center;padding:8px;border-bottom:1px solid #222;}
.header h3{font-size:15px;letter-spacing:3px;font-weight:800;}
.header p{font-size:9px;color:#666;margin-top:2px;}
.co-row{display:flex;align-items:center;padding:12px 16px;border-bottom:1px solid #222;gap:14px;}
.co-row img,.co-row .logo-ph{width:56px;height:56px;object-fit:contain;flex-shrink:0;background:#f3f4f6;border-radius:6px;}
.co-row h2{font-size:18px;font-weight:800;text-transform:uppercase;}
.co-row p{font-size:10px;color:#555;margin-top:2px;}
.section{padding:8px 14px;border-bottom:1px solid #222;}
.section .row{display:flex;margin-bottom:3px;}
.section .row .lbl{width:140px;font-weight:600;color:#444;}
.two-col{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid #222;}
.two-col .col{padding:10px 14px;}
.two-col .col:first-child{border-right:1px solid #222;}
.two-col .col .row{display:flex;margin-bottom:4px;font-size:10px;}
.two-col .col .row .lbl{width:130px;font-weight:600;color:#555;}
.col-hdr{background:#f3f4f6;padding:4px 14px;font-weight:700;font-size:9px;text-transform:uppercase;border-bottom:1px solid #222;}
.att-grid{display:grid;grid-template-columns:repeat(5,1fr);border-bottom:1px solid #222;}
.att-cell{padding:10px;text-align:center;border-right:1px solid #eee;}
.att-cell:last-child{border-right:none;}
.att-cell .val{font-size:20px;font-weight:800;}
.att-cell .lbl{font-size:9px;color:#777;margin-top:2px;}
table{width:100%;border-collapse:collapse;}
table th,table td{border:1px solid #222;padding:6px 10px;font-size:10px;}
table th{background:#f3f4f6;font-weight:700;text-transform:uppercase;font-size:9px;}
.sub-row td{background:#f8f8f8;font-weight:600;}
.net-row td{background:#1e293b;color:#fff;font-weight:800;font-size:13px;}
.words{border-top:1px solid #222;padding:8px 14px;font-style:italic;font-size:11px;font-weight:600;}
.footer{display:grid;grid-template-columns:1fr 1fr 1fr;border-top:1px solid #222;}
.footer .cell{padding:10px 14px;}
.footer .cell:not(:last-child){border-right:1px solid #222;}
.footer .cell-title{font-weight:700;font-size:10px;margin-bottom:4px;}
.status-badge{display:inline-block;padding:5px 18px;border-radius:4px;font-weight:800;font-size:13px;letter-spacing:2px;}
.sign-line{border-top:1px solid #999;padding-top:4px;text-align:center;font-size:10px;color:#666;margin-top:48px;}
.bottom-bar{border-top:1px solid #222;text-align:center;padding:6px;font-size:9px;color:#888;font-style:italic;}
</style></head><body><div class="page"><div class="border">

<div class="header">
  <h3>SALARY SLIP</h3>
  <p>${MONTH_NAMES[p.pay_month]} ${p.pay_year} &nbsp;|&nbsp; ${p.status === 'Paid' ? 'PAID' : 'DRAFT'}</p>
</div>

<div class="co-row">
  ${logo ? `<img src="${logo}" alt="logo"/>` : `<div class="logo-ph"></div>`}
  <div>
    <h2>${co.company_name || 'COMPANY NAME'}</h2>
    <p>${coAddr || ''}</p>
    ${co.phone ? `<p>Mobile: ${co.phone}${co.email ? ' &nbsp;|&nbsp; Email: '+co.email : ''}</p>` : ''}
  </div>
</div>

<div class="section">
  <div class="row"><span class="lbl">Payslip ID</span><span>: ${p.payroll_code || '—'}</span></div>
  <div class="row"><span class="lbl">Pay Period</span><span>: ${MONTH_NAMES[p.pay_month]} ${p.pay_year}</span></div>
  <div class="row"><span class="lbl">Payment Mode</span><span>: ${p.payment_mode}</span></div>
  ${p.payment_date ? `<div class="row"><span class="lbl">Payment Date</span><span>: ${fmtDate(p.payment_date)}</span></div>` : ''}
</div>

<div style="display:grid;grid-template-columns:1fr 1fr;">
  <div class="col-hdr" style="border-right:1px solid #222;">Employee Details</div>
  <div class="col-hdr">Employment Info</div>
</div>
<div class="two-col">
  <div class="col">
    <div class="row"><span class="lbl">Name</span><span>: ${p.employee_name}</span></div>
    <div class="row"><span class="lbl">Employee ID</span><span>: ${p.emp_code || '—'}</span></div>
    <div class="row"><span class="lbl">Department</span><span>: ${p.department || '—'}</span></div>
    <div class="row"><span class="lbl">Designation</span><span>: ${p.designation || '—'}</span></div>
    ${p.employee_email ? `<div class="row"><span class="lbl">Email</span><span>: ${p.employee_email}</span></div>` : ''}
  </div>
  <div class="col">
    <div class="row"><span class="lbl">Date of Joining</span><span>: ${fmtDate(p.date_of_joining)}</span></div>
    <div class="row"><span class="lbl">Status</span><span>: ${p.employment_status === 'permanent' ? 'Permanent' : 'Probation'}</span></div>
    <div class="row"><span class="lbl">Monthly Salary</span><span>: &#8377;${fmt(p.monthly_salary)}</span></div>
    <div class="row"><span class="lbl">Per Day Salary</span><span>: &#8377;${fmt(p.per_day_salary)}</span></div>
  </div>
</div>

<div class="col-hdr">Attendance Summary</div>
<div class="att-grid">
  <div class="att-cell"><div class="val">${p.working_days}</div><div class="lbl">Working Days</div></div>
  <div class="att-cell"><div class="val" style="color:#16a34a;">${p.days_present}</div><div class="lbl">Days Present</div></div>
  <div class="att-cell"><div class="val" style="color:#dc2626;">${p.absent_days}</div><div class="lbl">Absent Days</div></div>
  <div class="att-cell"><div class="val" style="color:#2563eb;">${p.paid_leave_used}</div><div class="lbl">Paid Leave</div></div>
  <div class="att-cell"><div class="val" style="color:#d97706;">${p.lop_days}</div><div class="lbl">LOP Days</div></div>
</div>

<table>
  <thead><tr>
    <th style="text-align:left;width:40%;">Earnings</th>
    <th style="text-align:right;width:15%;">Amount (&#8377;)</th>
    <th style="text-align:left;width:30%;">Deductions</th>
    <th style="text-align:right;width:15%;">Amount (&#8377;)</th>
  </tr></thead>
  <tbody>
    <tr>
      <td>Salary (${p.working_days} days)</td><td style="text-align:right;">&#8377;${fmt(grossBase)}</td>
      <td style="color:#c0392b;">Loss of Pay (${p.lop_days} days)</td><td style="text-align:right;color:#c0392b;">&#8377;${fmt(lop)}</td>
    </tr>
    <tr>
      <td>Bonus</td><td style="text-align:right;color:#16a34a;">&#8377;${fmt(bonus)}</td>
      <td>Advance Deduction</td><td style="text-align:right;">&#8377;${fmt(advance)}</td>
    </tr>
    <tr>
      <td></td><td></td>
      <td>Other Deduction</td><td style="text-align:right;">&#8377;${fmt(other)}</td>
    </tr>
    <tr class="net-row">
      <td colspan="2" style="text-align:center;">NET PAY &nbsp; &#8377;${fmt(net)}</td>
      <td colspan="2" style="text-align:center;font-size:10px;font-weight:600;">${numToWords(net)}</td>
    </tr>
  </tbody>
</table>

<div class="footer">
  <div class="cell">
    <p class="cell-title">NOTE</p>
    <p style="font-size:9px;color:#666;">${p.notes || 'This is a computer-generated payslip. For queries, contact HR.'}</p>
  </div>
  <div class="cell" style="display:flex;flex-direction:column;align-items:center;justify-content:center;">
    <span class="status-badge" style="border:2px solid ${p.status==='Paid'?'#16a34a':'#d97706'};color:${p.status==='Paid'?'#16a34a':'#d97706'};">
      ${p.status==='Paid'?'PAID':'DRAFT'}
    </span>
    ${p.payment_date ? `<p style="font-size:9px;color:#888;margin-top:6px;">Paid on: ${fmtDate(p.payment_date)}</p>` : ''}
  </div>
  <div class="cell" style="display:flex;flex-direction:column;justify-content:space-between;">
    <p style="font-weight:700;font-size:10px;text-align:right;">For ${co.company_name || 'Company'}</p>
    <div class="sign-line">Authorised Signatory</div>
  </div>
</div>

<div class="bottom-bar">Payslip Generated by ${co.company_name || 'CRM'} &nbsp;|&nbsp; ${p.payroll_code || ''}</div>
</div></div></body></html>`;

    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox'] });
    const page    = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true, margin: {top:'0',right:'0',bottom:'0',left:'0'} });
    await browser.close();

    const uploadsDir = path.join(__dirname, '../../uploads/documents');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    const filename = `payslip_${p.payroll_code || req.params.id}_${Date.now()}.pdf`;
    fs.writeFileSync(path.join(uploadsDir, filename), pdfBuffer);

    return res.json({ url: `/uploads/documents/${filename}`, filename });
  } catch (err) {
    console.error('payslipPdf error:', err);
    return res.status(500).json({ message: 'Failed to generate payslip: ' + err.message });
  }
};
