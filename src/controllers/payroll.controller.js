const db = require('../config/db');

// ─── GET /api/payroll ─────────────────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    const { month, year, status, search } = req.query;
    let where = 'p.deleted = 0';
    const params = [];

    if (month) { where += ' AND p.pay_month = ?'; params.push(parseInt(month)); }
    if (year) { where += ' AND p.pay_year = ?'; params.push(parseInt(year)); }
    if (status) { where += ' AND p.status = ?'; params.push(status); }
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

    // Summary
    const summary = {
      total_count: rows.length,
      total_gross: rows.reduce((sum, r) => sum + parseFloat(r.gross_salary || 0), 0),
      total_deductions: rows.reduce((sum, r) => sum + parseFloat(r.total_deductions || 0), 0),
      total_net: rows.reduce((sum, r) => sum + parseFloat(r.net_salary || 0), 0),
      paid_count: rows.filter(r => r.status === 'Paid').length,
      draft_count: rows.filter(r => r.status === 'Draft').length,
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
              u.department,
              u.designation,
              u.email AS employee_email,
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
      payment_mode, payment_date, status, notes
    } = req.body;

    if (!employee_id || !pay_month || !pay_year) {
      return res.status(400).json({ message: 'Employee, month, and year are required' });
    }

    // Check for duplicate
    const [existing] = await db.query(
      'SELECT id FROM payroll WHERE employee_id = ? AND pay_month = ? AND pay_year = ? AND deleted = 0',
      [employee_id, pay_month, pay_year]
    );
    if (existing.length > 0) {
      return res.status(400).json({ message: 'Payroll already exists for this employee in the selected month' });
    }

    const basic = parseFloat(basic_salary || 0);
    const hraAmt = parseFloat(hra || 0);
    const allowAmt = parseFloat(allowances || 0);
    const pfAmt = parseFloat(pf_deduction || 0);
    const esiAmt = parseFloat(esi_deduction || 0);
    const ptAmt = parseFloat(professional_tax || 0);
    const otherAmt = parseFloat(other_deductions || 0);

    const gross_salary = basic + hraAmt + allowAmt;
    const total_deductions = pfAmt + esiAmt + ptAmt + otherAmt;
    const net_salary = gross_salary - total_deductions;

    const [result] = await db.query(
      `INSERT INTO payroll (employee_id, pay_month, pay_year, basic_salary, hra, allowances,
        gross_salary, pf_deduction, esi_deduction, professional_tax, other_deductions,
        total_deductions, net_salary, payment_mode, payment_date, status, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        employee_id, pay_month, pay_year, basic, hraAmt, allowAmt,
        gross_salary, pfAmt, esiAmt, ptAmt, otherAmt,
        total_deductions, net_salary,
        payment_mode || 'Bank',
        payment_date || null,
        status || 'Draft',
        notes || null,
        req.user.id
      ]
    );

    const [created] = await db.query(
      `SELECT p.*, CONCAT(u.first_name, ' ', u.last_name) AS employee_name,
              u.department, u.designation
       FROM payroll p
       LEFT JOIN users u ON u.id = p.employee_id
       WHERE p.id = ?`,
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

    const existing = rows[0];
    const {
      basic_salary, hra, allowances,
      pf_deduction, esi_deduction, professional_tax, other_deductions,
      payment_mode, payment_date, status, notes
    } = req.body;

    const basic = basic_salary !== undefined ? parseFloat(basic_salary) : parseFloat(existing.basic_salary);
    const hraAmt = hra !== undefined ? parseFloat(hra) : parseFloat(existing.hra);
    const allowAmt = allowances !== undefined ? parseFloat(allowances) : parseFloat(existing.allowances);
    const pfAmt = pf_deduction !== undefined ? parseFloat(pf_deduction) : parseFloat(existing.pf_deduction);
    const esiAmt = esi_deduction !== undefined ? parseFloat(esi_deduction) : parseFloat(existing.esi_deduction);
    const ptAmt = professional_tax !== undefined ? parseFloat(professional_tax) : parseFloat(existing.professional_tax);
    const otherAmt = other_deductions !== undefined ? parseFloat(other_deductions) : parseFloat(existing.other_deductions);

    const gross_salary = basic + hraAmt + allowAmt;
    const total_deductions = pfAmt + esiAmt + ptAmt + otherAmt;
    const net_salary = gross_salary - total_deductions;

    await db.query(
      `UPDATE payroll SET
        basic_salary = ?, hra = ?, allowances = ?,
        gross_salary = ?, pf_deduction = ?, esi_deduction = ?, professional_tax = ?, other_deductions = ?,
        total_deductions = ?, net_salary = ?,
        payment_mode = ?, payment_date = ?, status = ?, notes = ?
       WHERE id = ?`,
      [
        basic, hraAmt, allowAmt,
        gross_salary, pfAmt, esiAmt, ptAmt, otherAmt,
        total_deductions, net_salary,
        payment_mode || existing.payment_mode,
        payment_date !== undefined ? (payment_date || null) : existing.payment_date,
        status || existing.status,
        notes !== undefined ? notes : existing.notes,
        req.params.id
      ]
    );

    const [updated] = await db.query(
      `SELECT p.*, CONCAT(u.first_name, ' ', u.last_name) AS employee_name,
              u.department, u.designation
       FROM payroll p
       LEFT JOIN users u ON u.id = p.employee_id
       WHERE p.id = ?`,
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
       FROM payroll p
       LEFT JOIN users u ON u.id = p.employee_id
       WHERE p.id = ?`,
      [req.params.id]
    );
    res.emitSocket('payroll:updated', updated[0]);
    return res.json(updated[0]);
  } catch (err) {
    console.error('Payroll markPaid error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── DELETE /api/payroll/:id (soft delete) ────────────────────────────────────
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

// ─── POST /api/payroll/generate ───────────────────────────────────────────────
// Bulk generate payroll for all employees with salary structures
exports.generate = async (req, res) => {
  try {
    const { pay_month, pay_year, payment_mode } = req.body;

    if (!pay_month || !pay_year) {
      return res.status(400).json({ message: 'Month and year are required' });
    }

    // Get all active salary structures
    const [structures] = await db.query(
      `SELECT ss.* FROM salary_structures ss
       WHERE ss.deleted = 0
         AND ss.effective_from <= ?
       ORDER BY ss.employee_id, ss.effective_from DESC`,
      [`${pay_year}-${String(pay_month).padStart(2, '0')}-01`]
    );

    // Get latest structure per employee
    const latestByEmployee = {};
    for (const s of structures) {
      if (!latestByEmployee[s.employee_id]) {
        latestByEmployee[s.employee_id] = s;
      }
    }

    // Check which employees already have payroll for this month
    const [existingPayroll] = await db.query(
      'SELECT employee_id FROM payroll WHERE pay_month = ? AND pay_year = ? AND deleted = 0',
      [pay_month, pay_year]
    );
    const existingSet = new Set(existingPayroll.map(r => r.employee_id));

    let created = 0;
    let skipped = 0;

    for (const [empId, structure] of Object.entries(latestByEmployee)) {
      if (existingSet.has(parseInt(empId))) {
        skipped++;
        continue;
      }

      const basic = parseFloat(structure.basic_salary);
      const hraAmt = parseFloat(structure.hra);
      const allowAmt = parseFloat(structure.allowances);
      const pfAmt = parseFloat(structure.pf_deduction);
      const esiAmt = parseFloat(structure.esi_deduction);
      const ptAmt = parseFloat(structure.professional_tax);
      const otherAmt = parseFloat(structure.other_deductions);

      const gross_salary = basic + hraAmt + allowAmt;
      const total_deductions = pfAmt + esiAmt + ptAmt + otherAmt;
      const net_salary = gross_salary - total_deductions;

      await db.query(
        `INSERT INTO payroll (employee_id, pay_month, pay_year, basic_salary, hra, allowances,
          gross_salary, pf_deduction, esi_deduction, professional_tax, other_deductions,
          total_deductions, net_salary, payment_mode, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Draft', ?)`,
        [empId, pay_month, pay_year, basic, hraAmt, allowAmt, gross_salary, pfAmt, esiAmt, ptAmt, otherAmt, total_deductions, net_salary, payment_mode || 'Bank', req.user.id]
      );
      created++;
    }

    return res.json({ message: `Payroll generated: ${created} created, ${skipped} skipped (already exist)`, created, skipped });
  } catch (err) {
    console.error('Payroll generate error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// SALARY STRUCTURES
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /api/payroll/structures ──────────────────────────────────────────────
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
              u.department,
              u.designation
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

// ─── GET /api/payroll/structures/:id ──────────────────────────────────────────
exports.getStructure = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT ss.*,
              CONCAT(u.first_name, ' ', u.last_name) AS employee_name,
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

// ─── POST /api/payroll/structures ─────────────────────────────────────────────
exports.createStructure = async (req, res) => {
  try {
    const {
      employee_id, basic_salary, hra, allowances,
      pf_deduction, esi_deduction, professional_tax, other_deductions,
      effective_from
    } = req.body;

    if (!employee_id || !basic_salary) {
      return res.status(400).json({ message: 'Employee and basic salary are required' });
    }

    const [result] = await db.query(
      `INSERT INTO salary_structures (employee_id, basic_salary, hra, allowances,
        pf_deduction, esi_deduction, professional_tax, other_deductions, effective_from, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        employee_id,
        parseFloat(basic_salary || 0),
        parseFloat(hra || 0),
        parseFloat(allowances || 0),
        parseFloat(pf_deduction || 0),
        parseFloat(esi_deduction || 0),
        parseFloat(professional_tax || 0),
        parseFloat(other_deductions || 0),
        effective_from || new Date().toISOString().split('T')[0],
        req.user.id
      ]
    );

    const [created] = await db.query(
      `SELECT ss.*, CONCAT(u.first_name, ' ', u.last_name) AS employee_name, u.department, u.designation
       FROM salary_structures ss
       LEFT JOIN users u ON u.id = ss.employee_id
       WHERE ss.id = ?`,
      [result.insertId]
    );
    return res.status(201).json(created[0]);
  } catch (err) {
    console.error('Salary structure create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── PUT /api/payroll/structures/:id ──────────────────────────────────────────
exports.updateStructure = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM salary_structures WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Salary structure not found' });

    const existing = rows[0];
    const {
      basic_salary, hra, allowances,
      pf_deduction, esi_deduction, professional_tax, other_deductions,
      effective_from
    } = req.body;

    await db.query(
      `UPDATE salary_structures SET
        basic_salary = ?, hra = ?, allowances = ?,
        pf_deduction = ?, esi_deduction = ?, professional_tax = ?, other_deductions = ?,
        effective_from = ?
       WHERE id = ?`,
      [
        basic_salary !== undefined ? parseFloat(basic_salary) : existing.basic_salary,
        hra !== undefined ? parseFloat(hra) : existing.hra,
        allowances !== undefined ? parseFloat(allowances) : existing.allowances,
        pf_deduction !== undefined ? parseFloat(pf_deduction) : existing.pf_deduction,
        esi_deduction !== undefined ? parseFloat(esi_deduction) : existing.esi_deduction,
        professional_tax !== undefined ? parseFloat(professional_tax) : existing.professional_tax,
        other_deductions !== undefined ? parseFloat(other_deductions) : existing.other_deductions,
        effective_from || existing.effective_from,
        req.params.id
      ]
    );

    const [updated] = await db.query(
      `SELECT ss.*, CONCAT(u.first_name, ' ', u.last_name) AS employee_name, u.department, u.designation
       FROM salary_structures ss
       LEFT JOIN users u ON u.id = ss.employee_id
       WHERE ss.id = ?`,
      [req.params.id]
    );
    return res.json(updated[0]);
  } catch (err) {
    console.error('Salary structure update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── DELETE /api/payroll/structures/:id ────────────────────────────────────────
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
