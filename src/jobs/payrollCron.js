/**
 * Payroll Auto-Generate Cron Job  (v4 — Probation + Paid Leave + Mid-Month Join)
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs on the 1st of every month at 00:05 AM.
 *
 * Step 1 — Credit paid leave:
 *   For every CONFIRMED employee → add 1 paid leave to paid_leave_ledger.
 *   Probation employees → skip (no paid leave).
 *
 * Step 2 — Generate payroll:
 *   For every employee with a salary structure:
 *   a) Check if in probation → all absent days = LOP
 *   b) If confirmed → absent days first consume paid leave balance,
 *      remaining absent days = LOP
 *
 * Probation check:
 *   employment_status = 'probation'  OR  probation_end_date > target month end
 *   → in probation
 *
 * Mid-month join handling:
 *   If date_of_joining falls within the target month, working days and
 *   attendance are counted only from the join date (pro-rata salary).
 */

const db = require('../config/db');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getWorkingDaysInMonth(year, month) {
  const daysInMonth = new Date(year, month, 0).getDate();
  let workingDays = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const day = new Date(year, month - 1, d).getDay();
    if (day !== 0) workingDays++; // exclude Sunday
  }
  return workingDays;
}

/**
 * Count working days (Mon–Sat) from a given start date to end of month.
 * Used for mid-month joiners to calculate pro-rata working days.
 */
function getWorkingDaysFromDate(year, month, fromDateStr) {
  const monthEnd   = new Date(year, month, 0).getDate();
  const startDay   = new Date(fromDateStr).getDate();
  let workingDays  = 0;
  for (let d = startDay; d <= monthEnd; d++) {
    const day = new Date(year, month - 1, d).getDay();
    if (day !== 0) workingDays++; // exclude Sunday
  }
  return workingDays;
}

/**
 * Returns the effective start date for payroll calculation.
 * If employee joined mid-month, use join date. Otherwise use 1st of month.
 */
function getEffectiveStartDate(year, month, dateOfJoining) {
  const monthStr   = String(month).padStart(2, '0');
  const monthStart = `${year}-${monthStr}-01`;
  if (!dateOfJoining) return monthStart;

  const joinStr = dateOfJoining instanceof Date
    ? dateOfJoining.toISOString().split('T')[0]
    : String(dateOfJoining).split('T')[0];

  // Only use join date if it falls within the target month
  return joinStr > monthStart ? joinStr : monthStart;
}

async function getAttendanceSummary(employeeId, year, month, effectiveStartDate) {
  const monthStr = String(month).padStart(2, '0');
  const endDate  = `${year}-${monthStr}-${new Date(year, month, 0).getDate()}`;
  const [rows] = await db.query(
    `SELECT COUNT(*) AS days_present
     FROM attendance
     WHERE user_id = ? AND date >= ? AND date <= ? AND clock_out IS NOT NULL`,
    [employeeId, effectiveStartDate, endDate]
  );
  return { days_present: rows[0]?.days_present || 0 };
}

/**
 * Check if employee is in probation for the target month.
 * Returns true if probation, false if confirmed.
 */
function isInProbation(employee, targetYear, targetMonth) {
  // If explicitly marked confirmed → not probation
  if (employee.employment_status === 'confirmed') return false;

  // If probation_end_date is set and has passed the target month end → confirmed
  if (employee.probation_end_date) {
    const monthEnd = new Date(targetYear, targetMonth, 0); // last day of target month
    const probEnd  = new Date(employee.probation_end_date);
    if (probEnd <= monthEnd) return false; // probation ended before/during this month
  }

  // Default → still in probation
  return true;
}

/**
 * Get the current paid leave balance for an employee.
 * Looks at the closing_balance of the most recent ledger entry.
 */
async function getPaidLeaveBalance(employeeId, beforeYear, beforeMonth) {
  // Get the latest ledger entry before the target month
  const [rows] = await db.query(
    `SELECT closing_balance FROM paid_leave_ledger
     WHERE employee_id = ?
       AND (ledger_year < ? OR (ledger_year = ? AND ledger_month < ?))
     ORDER BY ledger_year DESC, ledger_month DESC
     LIMIT 1`,
    [employeeId, beforeYear, beforeYear, beforeMonth]
  );
  return rows.length > 0 ? parseFloat(rows[0].closing_balance) : 0;
}

/**
 * Credit 1 paid leave to a confirmed employee for the target month.
 * Creates a ledger entry: opening = previous closing, credited = 1.
 */
async function creditPaidLeave(employeeId, targetYear, targetMonth) {
  // Check if already credited this month
  const [existing] = await db.query(
    `SELECT id FROM paid_leave_ledger WHERE employee_id = ? AND ledger_month = ? AND ledger_year = ?`,
    [employeeId, targetMonth, targetYear]
  );
  if (existing.length > 0) return; // already credited

  const openingBalance = await getPaidLeaveBalance(employeeId, targetYear, targetMonth);
  const credited       = 1;
  const closingBalance = openingBalance + credited;

  await db.query(
    `INSERT INTO paid_leave_ledger
       (employee_id, ledger_month, ledger_year, opening_balance, credited, used, lop_days, closing_balance)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?)`,
    [employeeId, targetMonth, targetYear, openingBalance, credited, closingBalance]
  );
}

/**
 * Update the ledger entry for the month with actual used/lop values.
 * Called after payroll is calculated.
 */
async function updateLedgerUsage(employeeId, targetYear, targetMonth, usedDays, lopDays) {
  const [rows] = await db.query(
    `SELECT * FROM paid_leave_ledger WHERE employee_id = ? AND ledger_month = ? AND ledger_year = ?`,
    [employeeId, targetMonth, targetYear]
  );

  if (rows.length > 0) {
    const entry = rows[0];
    const newClosing = Math.max(0, parseFloat(entry.opening_balance) + parseFloat(entry.credited) - usedDays);
    await db.query(
      `UPDATE paid_leave_ledger SET used = ?, lop_days = ?, closing_balance = ? WHERE id = ?`,
      [usedDays, lopDays, newClosing, entry.id]
    );
  } else {
    // No ledger entry (probation employee — no credit, just record LOP)
    await db.query(
      `INSERT INTO paid_leave_ledger
         (employee_id, ledger_month, ledger_year, opening_balance, credited, used, lop_days, closing_balance)
       VALUES (?, ?, ?, 0, 0, 0, ?, 0)`,
      [employeeId, targetMonth, targetYear, lopDays]
    );
  }
}

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

async function logCronRun(month, year, created, skipped, errorMsg, status) {
  try {
    await db.query(
      `INSERT INTO payroll_cron_log (pay_month, pay_year, created_count, skipped_count, error_message, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [month, year, created, skipped, errorMsg || null, status]
    );
  } catch (e) {
    console.error('[PayrollCron] Failed to write cron log:', e.message);
  }
}

// ─── Main Auto-Generate Function ──────────────────────────────────────────────
async function autoGeneratePayroll(targetMonth, targetYear) {
  console.log(`[PayrollCron] Starting for ${targetMonth}/${targetYear}`);

  let createdCount = 0;
  let skippedCount = 0;
  let errorMessage = null;
  let cronStatus   = 'success';

  try {
    // ── Step 1: Get all active employees with salary structures ───────────────
    const [structures] = await db.query(
      `SELECT ss.*, u.employment_status, u.probation_end_date, u.date_of_joining
       FROM salary_structures ss
       INNER JOIN (
         SELECT employee_id, MAX(effective_from) AS max_date
         FROM salary_structures
         WHERE deleted = 0 AND effective_from <= ?
         GROUP BY employee_id
       ) latest ON ss.employee_id = latest.employee_id
               AND ss.effective_from = latest.max_date
       INNER JOIN users u ON u.id = ss.employee_id
       WHERE ss.deleted = 0 AND u.deleted = 0 AND u.is_active = 1`,
      [`${targetYear}-${String(targetMonth).padStart(2, '0')}-01`]
    );

    if (structures.length === 0) {
      console.log('[PayrollCron] No salary structures found.');
      await logCronRun(targetMonth, targetYear, 0, 0, 'No salary structures found', 'partial');
      return;
    }

    // ── Step 2: Check existing payroll for this month ─────────────────────────
    const [existingPayroll] = await db.query(
      'SELECT employee_id FROM payroll WHERE pay_month = ? AND pay_year = ? AND deleted = 0',
      [targetMonth, targetYear]
    );
    const existingSet = new Set(existingPayroll.map(r => r.employee_id));

    const fullMonthWorkingDays = getWorkingDaysInMonth(targetYear, targetMonth);
    const SYSTEM_USER  = 1;

    // ── Step 3: Credit paid leave for confirmed employees ─────────────────────
    for (const structure of structures) {
      const inProbation = isInProbation(structure, targetYear, targetMonth);
      if (!inProbation) {
        await creditPaidLeave(structure.employee_id, targetYear, targetMonth);
      }
    }

    // ── Step 4: Generate payroll per employee ─────────────────────────────────
    for (const structure of structures) {
      const empId = structure.employee_id;

      if (existingSet.has(empId)) { skippedCount++; continue; }

      try {
        // ── Mid-month join: calculate pro-rata working days ───────────────────
        const effectiveStart = getEffectiveStartDate(targetYear, targetMonth, structure.date_of_joining);
        const isMidMonthJoin = effectiveStart !== `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`;
        const workingDays    = isMidMonthJoin
          ? getWorkingDaysFromDate(targetYear, targetMonth, effectiveStart)
          : fullMonthWorkingDays;

        const { days_present } = await getAttendanceSummary(empId, targetYear, targetMonth, effectiveStart);
        const absentDays       = Math.max(0, workingDays - days_present);
        const inProbation      = isInProbation(structure, targetYear, targetMonth);

        if (isMidMonthJoin) {
          console.log(`[PayrollCron] Employee ${empId} joined mid-month (${effectiveStart}). Pro-rata working days: ${workingDays}/${fullMonthWorkingDays}`);
        }

        let paidLeaveUsed    = 0;
        let lopDays          = 0;
        let paidLeaveBalance = 0;

        if (inProbation) {
          // ── Probation: ALL absent days = LOP ─────────────────────────────
          lopDays          = absentDays;
          paidLeaveUsed    = 0;
          paidLeaveBalance = 0;
        } else {
          // ── Confirmed: use paid leave first, then LOP ─────────────────────
          paidLeaveBalance = await getPaidLeaveBalance(empId, targetYear, targetMonth) + 1;
          // +1 because we just credited 1 this month in Step 3

          if (absentDays <= paidLeaveBalance) {
            paidLeaveUsed    = absentDays;
            lopDays          = 0;
          } else {
            paidLeaveUsed    = paidLeaveBalance;
            lopDays          = absentDays - paidLeaveBalance;
          }

          // Update ledger with actual usage
          await updateLedgerUsage(empId, targetYear, targetMonth, paidLeaveUsed, lopDays);
          // Recalculate balance after usage
          paidLeaveBalance = Math.max(0, paidLeaveBalance - paidLeaveUsed);
        }

        // ── Salary calculation ────────────────────────────────────────────────
        const basicRaw    = parseFloat(structure.basic_salary);
        const wDaysConfig = parseInt(structure.working_days_per_month) || 26;
        const wHoursConfig = parseInt(structure.working_hours_per_day) || 8;
        const perDaySal   = workingDays > 0 ? basicRaw / workingDays : 0;
        const perDayDisplay  = parseFloat((basicRaw / wDaysConfig).toFixed(2));
        const perHourDisplay = parseFloat((basicRaw / wDaysConfig / wHoursConfig).toFixed(2));
        const lopDeduction = parseFloat((lopDays * perDaySal).toFixed(2));

        const basicActual = parseFloat((basicRaw - lopDeduction).toFixed(2));
        const hraAmt      = parseFloat(structure.hra);
        const allowAmt    = parseFloat(structure.allowances);
        const grossSalary = parseFloat((basicActual + hraAmt + allowAmt).toFixed(2));

        // Auto statutory deductions
        const pfAmt  = parseFloat(Math.min(basicActual * 0.12, 1800).toFixed(2));
        const esiAmt = grossSalary <= 21000
          ? parseFloat((grossSalary * 0.0075).toFixed(2)) : 0;
        const ptAmt    = parseFloat(structure.professional_tax);
        const otherAmt = parseFloat(structure.other_deductions);

        const totalDeductions = parseFloat((pfAmt + esiAmt + ptAmt + otherAmt).toFixed(2));
        const netSalary       = parseFloat((grossSalary - totalDeductions).toFixed(2));

        const payrollIdCode = await generatePayrollIdCode(targetYear, targetMonth, empId);

        await db.query(
          `INSERT INTO payroll (
            payroll_id_code, employee_id, pay_month, pay_year,
            basic_salary, hra, allowances,
            working_days, days_present, lop_days, lop_deduction,
            gross_salary, pf_deduction, esi_deduction, professional_tax, other_deductions,
            total_deductions, net_salary,
            is_probation, paid_leave_used, paid_leave_balance,
            per_day_salary, per_hour_salary,
            payment_mode, status, auto_generated, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Bank', 'Draft', 1, ?)`,
          [
            payrollIdCode, empId, targetMonth, targetYear,
            basicActual, hraAmt, allowAmt,
            workingDays, days_present, lopDays, lopDeduction,
            grossSalary, pfAmt, esiAmt, ptAmt, otherAmt,
            totalDeductions, netSalary,
            inProbation ? 1 : 0, paidLeaveUsed, paidLeaveBalance,
            perDayDisplay, perHourDisplay,
            SYSTEM_USER,
          ]
        );

        createdCount++;
        console.log(`[PayrollCron] Employee ${empId} | Probation: ${inProbation} | Absent: ${absentDays} | PL Used: ${paidLeaveUsed} | LOP: ${lopDays} | Net: ₹${netSalary}`);
      } catch (empErr) {
        console.error(`[PayrollCron] Error for employee ${empId}:`, empErr.message);
        skippedCount++;
        cronStatus = 'partial';
      }
    }

    console.log(`[PayrollCron] Done. Created: ${createdCount}, Skipped: ${skippedCount}`);
  } catch (err) {
    console.error('[PayrollCron] Fatal error:', err);
    errorMessage = err.message;
    cronStatus   = 'failed';
  }

  await logCronRun(targetMonth, targetYear, createdCount, skippedCount, errorMessage, cronStatus);
}

// ─── Scheduler (runs every minute, triggers on 1st at 00:05) ─────────────────
function startPayrollCron() {
  console.log('[PayrollCron] Scheduler started. Auto-generates on 1st of every month at 00:05.');

  setInterval(async () => {
    const now    = new Date();
    const day    = now.getDate();
    const hour   = now.getHours();
    const minute = now.getMinutes();

    if (day === 1 && hour === 0 && minute === 5) {
      // Generate for the previous month
      const targetDate  = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const targetMonth = targetDate.getMonth() + 1;
      const targetYear  = targetDate.getFullYear();
      await autoGeneratePayroll(targetMonth, targetYear);
    }
  }, 60 * 1000);
}

module.exports = { startPayrollCron, autoGeneratePayroll };
