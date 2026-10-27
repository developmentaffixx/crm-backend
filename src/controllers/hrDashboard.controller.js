const db = require('../config/db');

/**
 * GET /api/hr-dashboard/overview
 * Aggregates all sections for the HR Mission Control Dashboard.
 *
 * Sections:
 *   A. KPI cards (headcount, present/leave/absent today, pending approvals)
 *   B. Needs attention (pending leaves, probation due, onboarding pipeline, interviews)
 *   C. Attendance red flags (late-comers today, missing clock-outs)
 *   D. Compliance & lifecycle (anniversaries, birthdays)
 *   F. People insights (top performers, upcoming holidays, headcount by department)
 *
 * HR users see ALL employees (no per-user scoping).
 */
exports.getOverview = async (req, res) => {
  try {
    // ── A. WORKFORCE / HEADCOUNT ───────────────────────────────────────────
    let totalEmployees = 0;
    let headcountByDept = [];
    try {
      const [[totalRow]] = await db.query(
        `SELECT COUNT(*) AS total FROM users WHERE deleted = 0 AND is_active = 1 AND is_admin = 0`
      );
      totalEmployees = totalRow?.total || 0;

      const [deptRows] = await db.query(`
        SELECT COALESCE(NULLIF(u.department, ''), 'Unassigned') AS department,
               COUNT(*) AS count
        FROM users u
        WHERE u.deleted = 0 AND u.is_active = 1 AND u.is_admin = 0
        GROUP BY COALESCE(NULLIF(u.department, ''), 'Unassigned')
        ORDER BY count DESC
      `);
      headcountByDept = deptRows;
    } catch (err) {
      console.error('HR Dashboard headcount query error:', err.message);
    }

    // ── ATTENDANCE TODAY (present / late / missing clock-out) ──────────────
    let presentToday = 0;
    let lateComers = [];
    let missingClockOuts = [];
    try {
      const [[presentRow]] = await db.query(
        `SELECT COUNT(DISTINCT user_id) AS present FROM attendance WHERE date = CURDATE()`
      );
      presentToday = presentRow?.present || 0;

      const [lateRows] = await db.query(`
        SELECT a.user_id,
               CONCAT(u.first_name, ' ', u.last_name) AS name,
               u.avatar_url AS avatar,
               COALESCE(NULLIF(u.department, ''), 'Unassigned') AS department,
               a.clock_in,
               a.clock_in_status,
               a.late_reason
        FROM attendance a
        JOIN users u ON u.id = a.user_id AND u.deleted = 0
        WHERE a.date = CURDATE() AND a.clock_in_status IN ('late', 'grace')
        ORDER BY a.clock_in ASC
      `);
      lateComers = lateRows;

      // Missing clock-outs for today and yesterday (forgot to punch out)
      const [missingRows] = await db.query(`
        SELECT a.user_id,
               CONCAT(u.first_name, ' ', u.last_name) AS name,
               u.avatar_url AS avatar,
               a.date,
               a.clock_in
        FROM attendance a
        JOIN users u ON u.id = a.user_id AND u.deleted = 0
        WHERE a.clock_out IS NULL
          AND a.date >= CURDATE() - INTERVAL 1 DAY
        ORDER BY a.date DESC, a.clock_in ASC
      `);
      missingClockOuts = missingRows;
    } catch (err) {
      console.error('HR Dashboard attendance query error:', err.message);
    }

    // ── LEAVES (on leave today + pending approvals) ────────────────────────
    let onLeaveToday = 0;
    let pendingLeaves = [];
    try {
      const [[leaveRow]] = await db.query(`
        SELECT COUNT(DISTINCT user_id) AS on_leave
        FROM leaves
        WHERE deleted = 0 AND status = 'approved'
          AND CURDATE() BETWEEN from_date AND to_date
      `);
      onLeaveToday = leaveRow?.on_leave || 0;

      const [pendingRows] = await db.query(`
        SELECT l.id,
               l.user_id,
               CONCAT(u.first_name, ' ', u.last_name) AS name,
               u.avatar_url AS avatar,
               l.leave_type,
               l.from_date,
               l.to_date,
               l.days,
               l.reason,
               l.created_at
        FROM leaves l
        JOIN users u ON u.id = l.user_id AND u.deleted = 0
        WHERE l.deleted = 0 AND l.status = 'pending'
        ORDER BY l.from_date ASC
      `);
      pendingLeaves = pendingRows;
    } catch (err) {
      console.error('HR Dashboard leaves query error:', err.message);
    }

    const absentToday = Math.max(0, totalEmployees - presentToday - onLeaveToday);

    // ── B. PROBATION / CONFIRMATION DUE ────────────────────────────────────
    // Uses probation_end_date when set; otherwise date_of_joining + 3 months.
    // Flags employees still on probation whose window ends within the next 30 days
    // (or is already past but not yet confirmed).
    let probationDue = [];
    try {
      const [probRows] = await db.query(`
        SELECT u.id,
               CONCAT(u.first_name, ' ', u.last_name) AS name,
               u.avatar_url AS avatar,
               COALESCE(NULLIF(u.department, ''), 'Unassigned') AS department,
               u.designation,
               u.date_of_joining,
               u.employment_status,
               COALESCE(u.probation_end_date, DATE_ADD(u.date_of_joining, INTERVAL 3 MONTH)) AS confirmation_date,
               DATEDIFF(
                 COALESCE(u.probation_end_date, DATE_ADD(u.date_of_joining, INTERVAL 3 MONTH)),
                 CURDATE()
               ) AS days_remaining
        FROM users u
        WHERE u.deleted = 0 AND u.is_active = 1
          AND u.employment_status = 'probation'
          AND u.date_of_joining IS NOT NULL
          AND COALESCE(u.probation_end_date, DATE_ADD(u.date_of_joining, INTERVAL 3 MONTH))
              <= CURDATE() + INTERVAL 30 DAY
        ORDER BY confirmation_date ASC
      `);
      probationDue = probRows;
    } catch (err) {
      console.error('HR Dashboard probation query error:', err.message);
    }

    // ── B. ONBOARDING PIPELINE ─────────────────────────────────────────────
    let onboardingPipeline = [];
    try {
      const [obRows] = await db.query(`
        SELECT r.afid,
               r.candidate_name,
               r.email,
               r.created_at AS invited_at,
               COALESCE(d.onboarding_status, 'not_started') AS onboarding_status
        FROM pillars_candidate_registration r
        LEFT JOIN pillars_candidate_details d ON d.afid = r.afid AND d.deleted = 0
        WHERE r.deleted = 0
          AND COALESCE(d.onboarding_status, 'not_started') NOT IN ('completed', 'approved')
        ORDER BY r.created_at DESC
        LIMIT 25
      `);
      onboardingPipeline = obRows;
    } catch (err) {
      console.error('HR Dashboard onboarding query error:', err.message);
    }

    // ── B. SCHEDULED INTERVIEWS (upcoming) ─────────────────────────────────
    let scheduledInterviews = [];
    try {
      const [intRows] = await db.query(`
        SELECT ir.id,
               ir.candidate_id,
               ic.candidate_name,
               ic.position_applied,
               ir.round_number,
               ir.scheduled_date,
               ir.scheduled_time,
               CONCAT(u.first_name, ' ', u.last_name) AS interviewer_name
        FROM interview_rounds ir
        JOIN interview_candidates ic ON ic.id = ir.candidate_id AND ic.deleted = 0
        LEFT JOIN users u ON u.id = ir.interviewer_id
        WHERE ir.deleted = 0
          AND ir.scheduled_date >= CURDATE()
        ORDER BY ir.scheduled_date ASC, ir.scheduled_time ASC
        LIMIT 20
      `);
      scheduledInterviews = intRows;
    } catch (err) {
      console.error('HR Dashboard interviews query error:', err.message);
    }

    // ── D. WORK ANNIVERSARIES THIS MONTH ───────────────────────────────────
    let anniversaries = [];
    try {
      const [annRows] = await db.query(`
        SELECT u.id,
               CONCAT(u.first_name, ' ', u.last_name) AS name,
               u.avatar_url AS avatar,
               COALESCE(NULLIF(u.department, ''), 'Unassigned') AS department,
               u.date_of_joining,
               DAY(u.date_of_joining) AS join_day,
               TIMESTAMPDIFF(YEAR, u.date_of_joining, CURDATE()) AS years_completed
        FROM users u
        WHERE u.deleted = 0 AND u.is_active = 1
          AND u.date_of_joining IS NOT NULL
          AND MONTH(u.date_of_joining) = MONTH(CURDATE())
          AND TIMESTAMPDIFF(YEAR, u.date_of_joining, CURDATE()) >= 1
        ORDER BY DAY(u.date_of_joining) ASC
      `);
      anniversaries = annRows;
    } catch (err) {
      console.error('HR Dashboard anniversaries query error:', err.message);
    }

    // ── D. BIRTHDAYS THIS MONTH ────────────────────────────────────────────
    let birthdays = [];
    try {
      const [bdayRows] = await db.query(`
        SELECT u.id,
               CONCAT(u.first_name, ' ', u.last_name) AS name,
               u.avatar_url AS avatar,
               COALESCE(NULLIF(u.department, ''), 'Unassigned') AS department,
               u.date_of_birth,
               DAY(u.date_of_birth) AS birth_day
        FROM users u
        WHERE u.deleted = 0 AND u.is_active = 1
          AND u.date_of_birth IS NOT NULL
          AND MONTH(u.date_of_birth) = MONTH(CURDATE())
        ORDER BY DAY(u.date_of_birth) ASC
      `);
      birthdays = bdayRows;
    } catch (err) {
      console.error('HR Dashboard birthdays query error:', err.message);
    }

    // ── F. UPCOMING COMPANY HOLIDAYS ───────────────────────────────────────
    let upcomingHolidays = [];
    try {
      const [holRows] = await db.query(`
        SELECT id, date, name, type
        FROM company_holidays
        WHERE date >= CURDATE()
        ORDER BY date ASC
        LIMIT 10
      `);
      upcomingHolidays = holRows;
    } catch (err) {
      console.error('HR Dashboard holidays query error:', err.message);
    }

    // ── KPI AGGREGATION ────────────────────────────────────────────────────
    const kpis = {
      total_employees: totalEmployees,
      present_today: presentToday,
      on_leave_today: onLeaveToday,
      absent_today: absentToday,
      pending_leaves: pendingLeaves.length,
      probation_due: probationDue.length,
      late_today: lateComers.length,
      missing_clockouts: missingClockOuts.length,
    };

    return res.json({
      kpis,
      // B. Needs attention
      pending_leaves: pendingLeaves,
      probation_due: probationDue,
      onboarding_pipeline: onboardingPipeline,
      scheduled_interviews: scheduledInterviews,
      // C. Attendance red flags
      late_comers: lateComers,
      missing_clockouts: missingClockOuts,
      // D. Compliance & lifecycle
      anniversaries,
      birthdays,
      // F. People insights
      headcount_by_department: headcountByDept,
      upcoming_holidays: upcomingHolidays,
    });
  } catch (err) {
    console.error('HR Dashboard getOverview fatal error:', err);
    return res.status(500).json({ message: 'Server error: ' + err.message });
  }
};
