const db = require('../config/db');
const { autoGeneratePayroll } = require('../jobs/payrollCron');

// ─── Shared helper: generate payroll ID code ──────────────────────────────────
async function generatePayrollIdCode(payYear, payMonth, employeeId) {
  const payYY = String(payYear).slice(-2);
  const payMM = String(payMonth).padStart(2, '0');
  const [empRows] = await db.query('SELECT emp_code FROM users WHERE id = ?', [employeeId]);
  const empCode = (empRows.length > 0 && empRows[0].emp_code)
    ? empRows[0].emp_code
    : `EMP${String(employeeId).padStart(3, '0')}`;
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
        parseInt(working_days_per_month) || 26,
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
        working_days_per_month !== undefined ? parseInt(working_days_per_month) : (ex.working_days_per_month || 26),
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
