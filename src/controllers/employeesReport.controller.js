const db = require('../config/db');

/**
 * GET /api/reports/employees
 * Advanced Employee Analytics Report
 * Query params: startDate, endDate, employeeId, department
 */
exports.getEmployeesReport = async (req, res) => {
  try {
    const { startDate, endDate, employeeId } = req.query;

    let dateFilter = '';
    const dateParams = [];

    if (startDate && endDate) {
      dateFilter = 'AND a.date BETWEEN ? AND ?';
      dateParams.push(startDate, endDate);
    } else if (startDate) {
      dateFilter = 'AND a.date >= ?';
      dateParams.push(startDate);
    } else if (endDate) {
      dateFilter = 'AND a.date <= ?';
      dateParams.push(endDate);
    }

    let taskDateFilter = '';
    const taskDateParams = [];
    if (startDate && endDate) {
      taskDateFilter = 'AND t.created_at BETWEEN ? AND ?';
      taskDateParams.push(startDate, endDate + ' 23:59:59');
    } else if (startDate) {
      taskDateFilter = 'AND t.created_at >= ?';
      taskDateParams.push(startDate);
    } else if (endDate) {
      taskDateFilter = 'AND t.created_at <= ?';
      taskDateParams.push(endDate + ' 23:59:59');
    }

    let employeeFilter = '';
    const employeeParams = [];
    if (employeeId) {
      employeeFilter = 'AND u.id = ?';
      employeeParams.push(employeeId);
    }

    // ─── 1. Workforce Overview KPIs ─────────────────────────────────────────────
    const [workforceKpi] = await db.query(
      `SELECT 
        COUNT(*) AS total_employees,
        SUM(CASE WHEN u.is_active = 1 THEN 1 ELSE 0 END) AS active_employees,
        SUM(CASE WHEN u.is_active = 0 THEN 1 ELSE 0 END) AS inactive_employees,
        SUM(CASE WHEN u.gender = 'male' THEN 1 ELSE 0 END) AS male_count,
        SUM(CASE WHEN u.gender = 'female' THEN 1 ELSE 0 END) AS female_count
       FROM users u
       WHERE u.deleted = 0 ${employeeFilter}`,
      [...employeeParams]
    );

    // ─── 2. Attendance Summary ──────────────────────────────────────────────────
    const [attendanceKpi] = await db.query(
      `SELECT 
        COUNT(*) AS total_attendance_records,
        SUM(CASE WHEN a.clock_in_status = 'on_time' THEN 1 ELSE 0 END) AS on_time_count,
        SUM(CASE WHEN a.clock_in_status = 'grace' THEN 1 ELSE 0 END) AS grace_count,
        SUM(CASE WHEN a.clock_in_status = 'late' THEN 1 ELSE 0 END) AS late_count,
        ROUND(AVG(a.total_served_seconds) / 3600, 1) AS avg_hours_served,
        ROUND(AVG(a.total_afs_seconds) / 3600, 1) AS avg_afs_hours,
        ROUND(SUM(a.total_served_seconds) / 3600, 0) AS total_hours_served
       FROM attendance a
       JOIN users u ON u.id = a.user_id
       WHERE u.deleted = 0 ${dateFilter} ${employeeFilter}`,
      [...dateParams, ...employeeParams]
    );

    // ─── 3. Attendance Trend (daily/monthly) ────────────────────────────────────
    const [attendanceTrend] = await db.query(
      `SELECT 
        DATE_FORMAT(a.date, '%Y-%m') AS month,
        COUNT(*) AS total_days,
        SUM(CASE WHEN a.clock_in_status = 'on_time' THEN 1 ELSE 0 END) AS on_time,
        SUM(CASE WHEN a.clock_in_status = 'late' THEN 1 ELSE 0 END) AS late,
        ROUND(AVG(a.total_served_seconds) / 3600, 1) AS avg_hours
       FROM attendance a
       JOIN users u ON u.id = a.user_id
       WHERE u.deleted = 0 ${dateFilter} ${employeeFilter}
       GROUP BY DATE_FORMAT(a.date, '%Y-%m')
       ORDER BY month ASC
       LIMIT 12`,
      [...dateParams, ...employeeParams]
    );

    // ─── 4. Punctuality Leaderboard (top on-time employees) ─────────────────────
    const [punctualityBoard] = await db.query(
      `SELECT 
        a.user_id,
        CONCAT(u.first_name, ' ', u.last_name) AS name,
        COUNT(*) AS total_days,
        SUM(CASE WHEN a.clock_in_status = 'on_time' THEN 1 ELSE 0 END) AS on_time_days,
        SUM(CASE WHEN a.clock_in_status = 'late' THEN 1 ELSE 0 END) AS late_days,
        ROUND(SUM(CASE WHEN a.clock_in_status = 'on_time' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 1) AS punctuality_rate,
        ROUND(AVG(a.total_served_seconds) / 3600, 1) AS avg_hours
       FROM attendance a
       JOIN users u ON u.id = a.user_id
       WHERE u.deleted = 0 ${dateFilter} ${employeeFilter}
       GROUP BY a.user_id, u.first_name, u.last_name
       ORDER BY punctuality_rate DESC, total_days DESC
       LIMIT 15`,
      [...dateParams, ...employeeParams]
    );

    // ─── 5. Task Performance ────────────────────────────────────────────────────
    const [taskKpi] = await db.query(
      `SELECT 
        COUNT(*) AS total_tasks,
        SUM(CASE WHEN t.is_active = 3 THEN 1 ELSE 0 END) AS completed_tasks,
        SUM(CASE WHEN t.is_active = 1 THEN 1 ELSE 0 END) AS active_tasks,
        SUM(CASE WHEN t.is_active = 0 THEN 1 ELSE 0 END) AS pending_tasks,
        SUM(CASE WHEN t.is_active = 4 THEN 1 ELSE 0 END) AS rejected_tasks,
        SUM(CASE WHEN t.deadline < CURDATE() AND t.is_active NOT IN (3) THEN 1 ELSE 0 END) AS overdue_tasks,
        SUM(CASE WHEN t.is_active = 3 AND t.updated_at <= t.deadline THEN 1 ELSE 0 END) AS on_time_completions,
        ROUND(AVG(CASE WHEN t.is_active = 3 THEN DATEDIFF(t.updated_at, t.created_at) END), 1) AS avg_completion_days
       FROM tasks t
       JOIN users u ON u.id = t.assigned_to
       WHERE t.deleted = 0 ${taskDateFilter} ${employeeFilter}`,
      [...taskDateParams, ...employeeParams]
    );

    // ─── 6. Task Performance by Employee ────────────────────────────────────────
    const [taskByEmployee] = await db.query(
      `SELECT 
        t.assigned_to AS user_id,
        CONCAT(u.first_name, ' ', u.last_name) AS name,
        COUNT(*) AS total_tasks,
        SUM(CASE WHEN t.is_active = 3 THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN t.is_active = 1 THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN t.deadline < CURDATE() AND t.is_active NOT IN (3) THEN 1 ELSE 0 END) AS overdue,
        ROUND(SUM(CASE WHEN t.is_active = 3 THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 1) AS completion_rate,
        ROUND(AVG(CASE WHEN t.is_active = 3 THEN DATEDIFF(t.updated_at, t.created_at) END), 1) AS avg_days
       FROM tasks t
       JOIN users u ON u.id = t.assigned_to
       WHERE t.deleted = 0 ${taskDateFilter} ${employeeFilter}
       GROUP BY t.assigned_to, u.first_name, u.last_name
       ORDER BY completed DESC
       LIMIT 15`,
      [...taskDateParams, ...employeeParams]
    );

    // ─── 7. Task Priority Distribution ──────────────────────────────────────────
    const [taskPriority] = await db.query(
      `SELECT 
        t.priority,
        COUNT(*) AS count,
        SUM(CASE WHEN t.is_active = 3 THEN 1 ELSE 0 END) AS completed
       FROM tasks t
       JOIN users u ON u.id = t.assigned_to
       WHERE t.deleted = 0 ${taskDateFilter} ${employeeFilter}
       GROUP BY t.priority
       ORDER BY FIELD(t.priority, 'high', 'medium', 'low')`,
      [...taskDateParams, ...employeeParams]
    );

    // ─── 8. Leave Analytics ─────────────────────────────────────────────────────
    let leaveDateFilter = '';
    const leaveDateParams = [];
    if (startDate && endDate) {
      leaveDateFilter = 'AND lv.from_date BETWEEN ? AND ?';
      leaveDateParams.push(startDate, endDate);
    } else if (startDate) {
      leaveDateFilter = 'AND lv.from_date >= ?';
      leaveDateParams.push(startDate);
    } else if (endDate) {
      leaveDateFilter = 'AND lv.from_date <= ?';
      leaveDateParams.push(endDate);
    }

    const [leaveKpi] = await db.query(
      `SELECT 
        COUNT(*) AS total_leave_requests,
        SUM(CASE WHEN lv.status = 'approved' THEN 1 ELSE 0 END) AS approved_leaves,
        SUM(CASE WHEN lv.status = 'rejected' THEN 1 ELSE 0 END) AS rejected_leaves,
        SUM(CASE WHEN lv.status = 'pending' THEN 1 ELSE 0 END) AS pending_leaves,
        SUM(CASE WHEN lv.status = 'approved' THEN lv.days ELSE 0 END) AS total_days_taken,
        ROUND(AVG(CASE WHEN lv.status = 'approved' THEN lv.days END), 1) AS avg_leave_duration
       FROM leaves lv
       JOIN users u ON u.id = lv.user_id
       WHERE lv.deleted = 0 ${leaveDateFilter} ${employeeFilter}`,
      [...leaveDateParams, ...employeeParams]
    );

    // ─── 9. Leave Type Breakdown ────────────────────────────────────────────────
    const [leaveByType] = await db.query(
      `SELECT 
        lv.leave_type,
        COUNT(*) AS count,
        SUM(lv.days) AS total_days,
        SUM(CASE WHEN lv.status = 'approved' THEN lv.days ELSE 0 END) AS approved_days
       FROM leaves lv
       JOIN users u ON u.id = lv.user_id
       WHERE lv.deleted = 0 AND lv.status = 'approved' ${leaveDateFilter} ${employeeFilter}
       GROUP BY lv.leave_type`,
      [...leaveDateParams, ...employeeParams]
    );

    // ─── 10. Leave Trend (monthly) ──────────────────────────────────────────────
    const [leaveTrend] = await db.query(
      `SELECT 
        DATE_FORMAT(lv.from_date, '%Y-%m') AS month,
        COUNT(*) AS requests,
        SUM(CASE WHEN lv.status = 'approved' THEN lv.days ELSE 0 END) AS days_taken
       FROM leaves lv
       JOIN users u ON u.id = lv.user_id
       WHERE lv.deleted = 0 ${leaveDateFilter} ${employeeFilter}
       GROUP BY DATE_FORMAT(lv.from_date, '%Y-%m')
       ORDER BY month ASC
       LIMIT 12`,
      [...leaveDateParams, ...employeeParams]
    );

    // ─── 11. Time Tracking Analytics ────────────────────────────────────────────
    let timeLogDateFilter = '';
    const timeLogDateParams = [];
    if (startDate && endDate) {
      timeLogDateFilter = 'AND tl.started_at BETWEEN ? AND ?';
      timeLogDateParams.push(startDate, endDate + ' 23:59:59');
    } else if (startDate) {
      timeLogDateFilter = 'AND tl.started_at >= ?';
      timeLogDateParams.push(startDate);
    } else if (endDate) {
      timeLogDateFilter = 'AND tl.started_at <= ?';
      timeLogDateParams.push(endDate + ' 23:59:59');
    }

    const [timeLogKpi] = await db.query(
      `SELECT 
        COUNT(*) AS total_time_entries,
        ROUND(SUM(tl.duration) / 3600, 0) AS total_logged_hours,
        ROUND(AVG(tl.duration) / 3600, 1) AS avg_session_hours,
        COUNT(DISTINCT tl.user_id) AS employees_logging_time,
        COUNT(DISTINCT tl.task_id) AS tasks_with_time
       FROM task_time_logs tl
       JOIN users u ON u.id = tl.user_id
       WHERE 1=1 ${timeLogDateFilter} ${employeeFilter}`,
      [...timeLogDateParams, ...employeeParams]
    );

    // ─── 12. Time Logged by Employee ────────────────────────────────────────────
    const [timeByEmployee] = await db.query(
      `SELECT 
        tl.user_id,
        CONCAT(u.first_name, ' ', u.last_name) AS name,
        COUNT(*) AS sessions,
        ROUND(SUM(tl.duration) / 3600, 1) AS total_hours,
        ROUND(AVG(tl.duration) / 3600, 1) AS avg_session_hours,
        COUNT(DISTINCT tl.task_id) AS tasks_worked
       FROM task_time_logs tl
       JOIN users u ON u.id = tl.user_id
       WHERE 1=1 ${timeLogDateFilter} ${employeeFilter}
       GROUP BY tl.user_id, u.first_name, u.last_name
       ORDER BY total_hours DESC
       LIMIT 15`,
      [...timeLogDateParams, ...employeeParams]
    );

    // ─── 13. Payroll Summary ────────────────────────────────────────────────────
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

    const [payrollKpi] = await db.query(
      `SELECT 
        COUNT(*) AS total_payslips,
        SUM(CASE WHEN p.status = 'Paid' THEN 1 ELSE 0 END) AS paid_count,
        SUM(CASE WHEN p.status = 'Draft' THEN 1 ELSE 0 END) AS draft_count,
        ROUND(SUM(p.gross_salary), 0) AS total_gross,
        ROUND(SUM(p.net_salary), 0) AS total_net,
        ROUND(SUM(p.total_deductions), 0) AS total_deductions,
        ROUND(AVG(p.net_salary), 0) AS avg_net_salary
       FROM payroll p
       JOIN users u ON u.id = p.employee_id
       WHERE p.deleted = 0 ${payrollFilter} ${employeeFilter}`,
      [...payrollParams, ...employeeParams]
    );

    // ─── 14. Payroll Trend (monthly) ────────────────────────────────────────────
    const [payrollTrend] = await db.query(
      `SELECT 
        CONCAT(p.pay_year, '-', LPAD(p.pay_month, 2, '0')) AS month,
        ROUND(SUM(p.gross_salary), 0) AS gross,
        ROUND(SUM(p.net_salary), 0) AS net,
        ROUND(SUM(p.total_deductions), 0) AS deductions,
        COUNT(*) AS employees_paid
       FROM payroll p
       JOIN users u ON u.id = p.employee_id
       WHERE p.deleted = 0 AND p.status = 'Paid' ${payrollFilter} ${employeeFilter}
       GROUP BY p.pay_year, p.pay_month
       ORDER BY p.pay_year ASC, p.pay_month ASC
       LIMIT 12`,
      [...payrollParams, ...employeeParams]
    );

    // ─── 15. Project Involvement ────────────────────────────────────────────────
    const [projectStats] = await db.query(
      `SELECT 
        COUNT(DISTINCT pm.project_id) AS total_projects,
        SUM(CASE WHEN pr.status = 'completed' THEN 1 ELSE 0 END) AS completed_projects,
        SUM(CASE WHEN pr.status = 'in_progress' THEN 1 ELSE 0 END) AS active_projects,
        SUM(CASE WHEN pr.status = 'open' THEN 1 ELSE 0 END) AS open_projects
       FROM project_members pm
       JOIN projects pr ON pr.id = pm.project_id AND pr.deleted = 0
       JOIN users u ON u.id = pm.user_id
       WHERE u.deleted = 0 ${employeeFilter}`,
      [...employeeParams]
    );

    // ─── 16. Projects per Employee ──────────────────────────────────────────────
    const [projectsByEmployee] = await db.query(
      `SELECT 
        pm.user_id,
        CONCAT(u.first_name, ' ', u.last_name) AS name,
        COUNT(DISTINCT pm.project_id) AS total_projects,
        SUM(CASE WHEN pr.status = 'in_progress' THEN 1 ELSE 0 END) AS active,
        SUM(CASE WHEN pr.status = 'completed' THEN 1 ELSE 0 END) AS completed
       FROM project_members pm
       JOIN projects pr ON pr.id = pm.project_id AND pr.deleted = 0
       JOIN users u ON u.id = pm.user_id
       WHERE u.deleted = 0 ${employeeFilter}
       GROUP BY pm.user_id, u.first_name, u.last_name
       ORDER BY total_projects DESC
       LIMIT 15`,
      [...employeeParams]
    );

    // ─── 17. Reimbursement Summary ──────────────────────────────────────────────
    let reimbDateFilter = '';
    const reimbDateParams = [];
    if (startDate && endDate) {
      reimbDateFilter = 'AND r.expense_date BETWEEN ? AND ?';
      reimbDateParams.push(startDate, endDate);
    } else if (startDate) {
      reimbDateFilter = 'AND r.expense_date >= ?';
      reimbDateParams.push(startDate);
    } else if (endDate) {
      reimbDateFilter = 'AND r.expense_date <= ?';
      reimbDateParams.push(endDate);
    }

    const [reimbursementKpi] = await db.query(
      `SELECT 
        COUNT(*) AS total_claims,
        SUM(CASE WHEN r.status = 'approved' THEN 1 ELSE 0 END) AS approved_claims,
        SUM(CASE WHEN r.status = 'paid' THEN 1 ELSE 0 END) AS paid_claims,
        SUM(CASE WHEN r.status = 'pending' THEN 1 ELSE 0 END) AS pending_claims,
        ROUND(SUM(r.amount), 0) AS total_amount,
        ROUND(SUM(CASE WHEN r.status IN ('approved', 'paid') THEN r.amount ELSE 0 END), 0) AS approved_amount,
        ROUND(AVG(r.amount), 0) AS avg_claim_amount
       FROM reimbursements r
       JOIN users u ON u.id = r.user_id
       WHERE r.deleted = 0 ${reimbDateFilter} ${employeeFilter}`,
      [...reimbDateParams, ...employeeParams]
    );

    // ─── 18. Reimbursement by Category ──────────────────────────────────────────
    const [reimbByCategory] = await db.query(
      `SELECT 
        r.category,
        COUNT(*) AS count,
        ROUND(SUM(r.amount), 0) AS total_amount
       FROM reimbursements r
       JOIN users u ON u.id = r.user_id
       WHERE r.deleted = 0 ${reimbDateFilter} ${employeeFilter}
       GROUP BY r.category
       ORDER BY total_amount DESC`,
      [...reimbDateParams, ...employeeParams]
    );

    // ─── 19. Employee List (for filter dropdown) ────────────────────────────────
    const [employeeList] = await db.query(
      `SELECT id, CONCAT(first_name, ' ', last_name) AS name 
       FROM users WHERE deleted = 0 AND is_active = 1 
       ORDER BY first_name ASC`
    );

    // ─── 20. Productivity Score (composite) ─────────────────────────────────────
    const [productivityScores] = await db.query(
      `SELECT 
        u.id AS user_id,
        CONCAT(u.first_name, ' ', u.last_name) AS name,
        COALESCE(att.punctuality_rate, 0) AS punctuality_rate,
        COALESCE(tsk.completion_rate, 0) AS task_completion_rate,
        COALESCE(tm.total_hours, 0) AS time_logged_hours,
        ROUND(
          (COALESCE(att.punctuality_rate, 0) * 0.3) + 
          (COALESCE(tsk.completion_rate, 0) * 0.5) + 
          (LEAST(COALESCE(tm.total_hours, 0) / NULLIF(att.total_days * (SELECT full_day_hours FROM work_schedule WHERE id = 1), 0) * 100, 100) * 0.2)
        , 1) AS productivity_score
       FROM users u
       LEFT JOIN (
         SELECT user_id, COUNT(*) AS total_days,
           ROUND(SUM(CASE WHEN clock_in_status = 'on_time' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 1) AS punctuality_rate
         FROM attendance WHERE 1=1 ${dateFilter.replace(/a\./g, '')}
         GROUP BY user_id
       ) att ON att.user_id = u.id
       LEFT JOIN (
         SELECT assigned_to AS user_id,
           ROUND(SUM(CASE WHEN is_active = 3 THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 1) AS completion_rate
         FROM tasks WHERE deleted = 0 ${taskDateFilter.replace(/t\./g, '')}
         GROUP BY assigned_to
       ) tsk ON tsk.user_id = u.id
       LEFT JOIN (
         SELECT user_id, ROUND(SUM(duration) / 3600, 1) AS total_hours
         FROM task_time_logs WHERE 1=1 ${timeLogDateFilter.replace(/tl\./g, '')}
         GROUP BY user_id
       ) tm ON tm.user_id = u.id
       WHERE u.deleted = 0 AND u.is_active = 1 ${employeeFilter}
       ORDER BY productivity_score DESC
       LIMIT 15`,
      [...dateParams, ...taskDateParams, ...timeLogDateParams, ...employeeParams]
    );

    // ─── 21. Attendance Heatmap (daily data for calendar view) ─────────────────
    const [attendanceHeatmap] = await db.query(
      `SELECT 
        DATE_FORMAT(a.date, '%Y-%m-%d') AS date,
        COUNT(DISTINCT a.user_id) AS employees_present,
        SUM(CASE WHEN a.clock_in_status = 'late' THEN 1 ELSE 0 END) AS late_count,
        ROUND(AVG(a.total_served_seconds) / 3600, 1) AS avg_hours
       FROM attendance a
       JOIN users u ON u.id = a.user_id
       WHERE u.deleted = 0 ${dateFilter} ${employeeFilter}
       GROUP BY a.date
       ORDER BY a.date DESC
       LIMIT 90`,
      [...dateParams, ...employeeParams]
    );

    // ─── 22. Daily Plan Completion Rate ─────────────────────────────────────────
    const [dailyPlanStats] = await db.query(
      `SELECT 
        COUNT(*) AS total_plans,
        SUM(CASE WHEN dp.status = 'completed' THEN 1 ELSE 0 END) AS completed_plans,
        ROUND(SUM(CASE WHEN dp.status = 'completed' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 1) AS plan_completion_rate,
        SUM(CASE WHEN dp.is_additional = 1 THEN 1 ELSE 0 END) AS additional_tasks_taken
       FROM daily_plans dp
       JOIN users u ON u.id = dp.user_id
       WHERE 1=1 ${dateFilter.replace(/a\./g, 'dp.')} ${employeeFilter}`,
      [...dateParams, ...employeeParams]
    );

    // ─── 23. Daily Plan Completion by Employee ──────────────────────────────────
    const [dailyPlanByEmployee] = await db.query(
      `SELECT 
        dp.user_id,
        CONCAT(u.first_name, ' ', u.last_name) AS name,
        COUNT(*) AS total_plans,
        SUM(CASE WHEN dp.status = 'completed' THEN 1 ELSE 0 END) AS completed,
        ROUND(SUM(CASE WHEN dp.status = 'completed' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 1) AS completion_rate
       FROM daily_plans dp
       JOIN users u ON u.id = dp.user_id
       WHERE 1=1 ${dateFilter.replace(/a\./g, 'dp.')} ${employeeFilter}
       GROUP BY dp.user_id, u.first_name, u.last_name
       ORDER BY completion_rate DESC
       LIMIT 15`,
      [...dateParams, ...employeeParams]
    );

    // ─── 24. Workload Distribution (tasks per employee - radar data) ────────────
    const [workloadRadar] = await db.query(
      `SELECT 
        u.id AS user_id,
        CONCAT(u.first_name, ' ', u.last_name) AS name,
        COALESCE(tsk.total_tasks, 0) AS tasks_assigned,
        COALESCE(proj.project_count, 0) AS projects_involved,
        COALESCE(att.total_days, 0) AS days_present,
        COALESCE(tm.total_hours, 0) AS hours_logged,
        COALESCE(lv.leave_days, 0) AS leave_days
       FROM users u
       LEFT JOIN (
         SELECT assigned_to AS user_id, COUNT(*) AS total_tasks
         FROM tasks WHERE deleted = 0 ${taskDateFilter.replace(/t\./g, '')}
         GROUP BY assigned_to
       ) tsk ON tsk.user_id = u.id
       LEFT JOIN (
         SELECT user_id, COUNT(DISTINCT project_id) AS project_count
         FROM project_members GROUP BY user_id
       ) proj ON proj.user_id = u.id
       LEFT JOIN (
         SELECT user_id, COUNT(*) AS total_days
         FROM attendance WHERE 1=1 ${dateFilter.replace(/a\./g, '')}
         GROUP BY user_id
       ) att ON att.user_id = u.id
       LEFT JOIN (
         SELECT user_id, ROUND(SUM(duration) / 3600, 1) AS total_hours
         FROM task_time_logs WHERE 1=1 ${timeLogDateFilter.replace(/tl\./g, '')}
         GROUP BY user_id
       ) tm ON tm.user_id = u.id
       LEFT JOIN (
         SELECT user_id, SUM(days) AS leave_days
         FROM leaves WHERE deleted = 0 AND status = 'approved' ${leaveDateFilter.replace(/lv\./g, '')}
         GROUP BY user_id
       ) lv ON lv.user_id = u.id
       WHERE u.deleted = 0 AND u.is_active = 1 ${employeeFilter}
       ORDER BY tasks_assigned DESC
       LIMIT 10`,
      [...taskDateParams, ...dateParams, ...timeLogDateParams, ...leaveDateParams, ...employeeParams]
    );

    // ─── 25. Weekly Productivity Trend (last 12 weeks) ──────────────────────────
    const [weeklyTrend] = await db.query(
      `SELECT 
        YEARWEEK(a.date, 1) AS week_num,
        MIN(a.date) AS week_start,
        COUNT(DISTINCT a.user_id) AS avg_employees,
        ROUND(AVG(a.total_served_seconds) / 3600, 1) AS avg_hours,
        SUM(CASE WHEN a.clock_in_status = 'on_time' THEN 1 ELSE 0 END) AS on_time,
        SUM(CASE WHEN a.clock_in_status = 'late' THEN 1 ELSE 0 END) AS late
       FROM attendance a
       JOIN users u ON u.id = a.user_id
       WHERE u.deleted = 0 AND a.date >= DATE_SUB(CURDATE(), INTERVAL 12 WEEK) ${employeeFilter}
       GROUP BY YEARWEEK(a.date, 1)
       ORDER BY week_num ASC`,
      [...employeeParams]
    );

    // ─── 26. Top Performers (multi-dimensional) ────────────────────────────────
    const [topPerformers] = await db.query(
      `SELECT 
        u.id AS user_id,
        CONCAT(u.first_name, ' ', u.last_name) AS name,
        u.email,
        COALESCE(att.punctuality_rate, 0) AS punctuality,
        COALESCE(att.avg_hours, 0) AS avg_hours,
        COALESCE(tsk.completion_rate, 0) AS task_completion,
        COALESCE(tsk.total_tasks, 0) AS total_tasks,
        COALESCE(tsk.on_time_rate, 0) AS on_time_delivery,
        COALESCE(dp.plan_rate, 0) AS daily_plan_rate,
        COALESCE(tm.total_hours, 0) AS time_logged,
        ROUND(
          (COALESCE(att.punctuality_rate, 0) * 0.2) +
          (COALESCE(tsk.completion_rate, 0) * 0.3) +
          (COALESCE(tsk.on_time_rate, 0) * 0.2) +
          (COALESCE(dp.plan_rate, 0) * 0.15) +
          (LEAST(COALESCE(tm.total_hours, 0) / NULLIF(att.total_days * (SELECT full_day_hours FROM work_schedule WHERE id = 1), 0) * 100, 100) * 0.15)
        , 1) AS overall_score
       FROM users u
       LEFT JOIN (
         SELECT user_id, COUNT(*) AS total_days,
           ROUND(SUM(CASE WHEN clock_in_status = 'on_time' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 1) AS punctuality_rate,
           ROUND(AVG(total_served_seconds) / 3600, 1) AS avg_hours
         FROM attendance WHERE 1=1 ${dateFilter.replace(/a\./g, '')}
         GROUP BY user_id
       ) att ON att.user_id = u.id
       LEFT JOIN (
         SELECT assigned_to AS user_id, COUNT(*) AS total_tasks,
           ROUND(SUM(CASE WHEN is_active = 3 THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 1) AS completion_rate,
           ROUND(SUM(CASE WHEN is_active = 3 AND updated_at <= deadline THEN 1 ELSE 0 END) * 100.0 / NULLIF(SUM(CASE WHEN is_active = 3 THEN 1 ELSE 0 END), 0), 1) AS on_time_rate
         FROM tasks WHERE deleted = 0 ${taskDateFilter.replace(/t\./g, '')}
         GROUP BY assigned_to
       ) tsk ON tsk.user_id = u.id
       LEFT JOIN (
         SELECT user_id,
           ROUND(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 1) AS plan_rate
         FROM daily_plans WHERE 1=1 ${dateFilter.replace(/a\./g, '')}
         GROUP BY user_id
       ) dp ON dp.user_id = u.id
       LEFT JOIN (
         SELECT user_id, ROUND(SUM(duration) / 3600, 1) AS total_hours
         FROM task_time_logs WHERE 1=1 ${timeLogDateFilter.replace(/tl\./g, '')}
         GROUP BY user_id
       ) tm ON tm.user_id = u.id
       WHERE u.deleted = 0 AND u.is_active = 1 ${employeeFilter}
       HAVING overall_score > 0
       ORDER BY overall_score DESC
       LIMIT 20`,
      [...dateParams, ...taskDateParams, ...dateParams, ...timeLogDateParams, ...employeeParams]
    );

    // ─── 27. AFS (Away From System) Analytics ───────────────────────────────────
    const [afsStats] = await db.query(
      `SELECT 
        ROUND(AVG(a.total_afs_seconds) / 60, 0) AS avg_afs_minutes_per_day,
        ROUND(SUM(a.total_afs_seconds) / 3600, 0) AS total_afs_hours,
        COUNT(CASE WHEN a.total_afs_seconds > 3600 THEN 1 END) AS high_afs_days
       FROM attendance a
       JOIN users u ON u.id = a.user_id
       WHERE u.deleted = 0 ${dateFilter} ${employeeFilter}`,
      [...dateParams, ...employeeParams]
    );

    // ─── 28. Task Completion Trend (weekly) ─────────────────────────────────────
    const [taskWeeklyTrend] = await db.query(
      `SELECT 
        YEARWEEK(t.updated_at, 1) AS week_num,
        MIN(DATE(t.updated_at)) AS week_start,
        SUM(CASE WHEN t.is_active = 3 THEN 1 ELSE 0 END) AS completed,
        COUNT(*) AS created
       FROM tasks t
       JOIN users u ON u.id = t.assigned_to
       WHERE t.deleted = 0 AND t.updated_at >= DATE_SUB(CURDATE(), INTERVAL 12 WEEK) ${employeeFilter}
       GROUP BY YEARWEEK(t.updated_at, 1)
       ORDER BY week_num ASC`,
      [...employeeParams]
    );

    // ─── 29. Deadline Extension KPIs ────────────────────────────────────────────
    const [extensionKpi] = await db.query(
      `SELECT
        COUNT(*) AS total_extension_requests,
        SUM(CASE WHEN ext.status = 'approved' THEN 1 ELSE 0 END) AS approved_extensions,
        SUM(CASE WHEN ext.status = 'rejected' THEN 1 ELSE 0 END) AS rejected_extensions,
        SUM(CASE WHEN ext.status = 'pending'  THEN 1 ELSE 0 END) AS pending_extensions,
        COUNT(DISTINCT ext.task_id) AS tasks_with_extensions,
        -- Extension requested AFTER the original deadline = genuinely overdue when asked
        SUM(CASE WHEN DATE(ext.created_at) > t.deadline THEN 1 ELSE 0 END) AS extensions_after_deadline
       FROM task_deadline_extension_requests ext
       JOIN tasks t ON t.id = ext.task_id
       JOIN users u ON u.id = t.assigned_to
       WHERE t.deleted = 0 AND ext.deleted = 0 ${employeeFilter}`,
      [...employeeParams]
    );

    // ─── 30. Extension Analytics per Employee ───────────────────────────────────
    const [extensionByEmployee] = await db.query(
      `SELECT
        t.assigned_to AS user_id,
        CONCAT(u.first_name, ' ', u.last_name) AS name,
        COUNT(ext.id) AS total_extensions,
        SUM(CASE WHEN ext.status = 'approved' THEN 1 ELSE 0 END) AS approved,
        SUM(CASE WHEN ext.status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
        SUM(CASE WHEN ext.status = 'pending'  THEN 1 ELSE 0 END) AS pending,
        -- How many were requested after the deadline had already passed
        SUM(CASE WHEN DATE(ext.created_at) > t.deadline THEN 1 ELSE 0 END) AS after_deadline,
        COUNT(DISTINCT ext.task_id) AS tasks_extended,
        -- Max extensions on a single task for this employee
        MAX(ext_counts.ext_count) AS max_extensions_on_one_task
       FROM task_deadline_extension_requests ext
       JOIN tasks t ON t.id = ext.task_id
       JOIN users u ON u.id = t.assigned_to
       JOIN (
         SELECT task_id, COUNT(*) AS ext_count
         FROM task_deadline_extension_requests
         WHERE deleted = 0
         GROUP BY task_id
       ) ext_counts ON ext_counts.task_id = ext.task_id
       WHERE t.deleted = 0 AND ext.deleted = 0 ${employeeFilter}
       GROUP BY t.assigned_to, u.first_name, u.last_name
       ORDER BY total_extensions DESC
       LIMIT 15`,
      [...employeeParams]
    );

    // ─── 31. Most Extended Tasks ─────────────────────────────────────────────────
    const [mostExtendedTasks] = await db.query(
      `SELECT
        t.id AS task_id,
        t.title,
        CONCAT(u.first_name, ' ', u.last_name) AS assigned_to,
        t.deadline AS original_deadline,
        COUNT(ext.id) AS extension_count,
        MAX(ext.requested_deadline) AS latest_requested_deadline,
        CASE WHEN t.is_active = 3 THEN 'completed'
             WHEN t.deadline < CURDATE() AND t.is_active NOT IN (3) THEN 'overdue'
             WHEN t.is_active = 1 THEN 'active'
             ELSE 'pending' END AS current_status
       FROM task_deadline_extension_requests ext
       JOIN tasks t ON t.id = ext.task_id
       JOIN users u ON u.id = t.assigned_to
       WHERE t.deleted = 0 AND ext.deleted = 0 ${employeeFilter}
       GROUP BY t.id, t.title, u.first_name, u.last_name, t.deadline, t.is_active
       ORDER BY extension_count DESC
       LIMIT 10`,
      [...employeeParams]
    );

    return res.json({
      workforce: workforceKpi[0],
      attendance: {
        kpi: attendanceKpi[0],
        trend: attendanceTrend,
        leaderboard: punctualityBoard,
        heatmap: attendanceHeatmap,
        afs: afsStats[0],
      },
      tasks: {
        kpi: taskKpi[0],
        byEmployee: taskByEmployee,
        priority: taskPriority,
        weeklyTrend: taskWeeklyTrend,
        extensions: {
          kpi: extensionKpi[0],
          byEmployee: extensionByEmployee,
          mostExtended: mostExtendedTasks,
        },
      },
      leaves: {
        kpi: leaveKpi[0],
        byType: leaveByType,
        trend: leaveTrend,
      },
      timeTracking: {
        kpi: timeLogKpi[0],
        byEmployee: timeByEmployee,
      },
      payroll: {
        kpi: payrollKpi[0],
        trend: payrollTrend,
      },
      projects: {
        kpi: projectStats[0],
        byEmployee: projectsByEmployee,
      },
      reimbursements: {
        kpi: reimbursementKpi[0],
        byCategory: reimbByCategory,
      },
      dailyPlans: {
        kpi: dailyPlanStats[0],
        byEmployee: dailyPlanByEmployee,
      },
      workloadRadar,
      weeklyTrend,
      topPerformers,
      productivityScores,
      employeeList,
    });
  } catch (err) {
    console.error('Employees report error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
