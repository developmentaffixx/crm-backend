const db = require('../config/db');

/**
 * GET /api/dashboard/admin/approvals
 * Pending approvals with details for inline actions
 */
exports.getAdminApprovals = async (req, res) => {
  try {
    // Pending leave requests
    const [leaves] = await db.query(
      `SELECT l.id, l.user_id, CONCAT(u.first_name, ' ', u.last_name) AS employee_name,
              l.leave_type, l.from_date, l.to_date, l.days, l.reason, l.created_at
       FROM leaves l
       JOIN users u ON u.id = l.user_id
       WHERE l.status = 'pending' AND l.deleted = 0
       ORDER BY l.created_at DESC LIMIT 10`
    );

    // Pending task approvals
    const [tasks] = await db.query(
      `SELECT t.id, t.title, CONCAT(u.first_name, ' ', u.last_name) AS requested_by,
              t.created_at
       FROM tasks t
       LEFT JOIN users u ON u.id = t.created_by
       WHERE t.is_active = 0 AND t.deleted = 0
       ORDER BY t.created_at DESC LIMIT 10`
    );

    // Pending reimbursements
    const [reimbursements] = await db.query(
      `SELECT r.id, r.category AS title, r.amount, CONCAT(u.first_name, ' ', u.last_name) AS employee_name,
              r.created_at
       FROM reimbursements r
       JOIN users u ON u.id = r.user_id
       WHERE r.status = 'pending' AND r.deleted = 0
       ORDER BY r.created_at DESC LIMIT 10`
    );

    return res.json({
      leaves,
      tasks,
      reimbursements,
      totals: {
        leaves: leaves.length,
        tasks: tasks.length,
        reimbursements: reimbursements.length,
        total: leaves.length + tasks.length + reimbursements.length
      }
    });
  } catch (err) {
    console.error('Admin approvals error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};


/**
 * GET /api/dashboard/admin/overdue
 * Combined overdue items (tasks + tickets + invoices)
 */
exports.getAdminOverdue = async (req, res) => {
  try {
    const [overdueTasks] = await db.query(
      `SELECT t.id, t.title, t.deadline AS due_date, t.priority,
              CONCAT(u.first_name, ' ', u.last_name) AS assignee
       FROM tasks t
       LEFT JOIN users u ON u.id = t.assigned_to
       WHERE t.deleted = 0 AND t.is_active = 1
       AND t.deadline < CURDATE() AND t.status != 'done'
       ORDER BY t.deadline ASC LIMIT 10`
    );

    const [overdueTickets] = await db.query(
      `SELECT t.id, t.title, t.due_date, t.priority,
              CONCAT(u.first_name, ' ', u.last_name) AS assignee
       FROM tickets t
       LEFT JOIN users u ON u.id = t.assigned_to
       WHERE t.deleted = 0 AND t.due_date < CURDATE()
       AND t.status NOT IN ('resolved', 'closed')
       ORDER BY t.due_date ASC LIMIT 10`
    );

    const [overdueInvoices] = await db.query(
      `SELECT i.id, i.invoice_number AS title, i.due_date,
              i.balance_amount, COALESCE(l.business_name, l.name, 'Unknown') AS assignee
       FROM invoices i
       LEFT JOIN leads l ON l.id = i.lead_id
       WHERE i.deleted = 0 AND i.due_date < CURDATE()
       AND i.status NOT IN ('Paid')
       ORDER BY i.due_date ASC LIMIT 10`
    );

    return res.json({
      tasks: overdueTasks.map(t => ({ ...t, type: 'task' })),
      tickets: overdueTickets.map(t => ({ ...t, type: 'ticket' })),
      invoices: overdueInvoices.map(i => ({ ...i, type: 'invoice' })),
      totals: {
        tasks: overdueTasks.length,
        tickets: overdueTickets.length,
        invoices: overdueInvoices.length
      }
    });
  } catch (err) {
    console.error('Admin overdue error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};


/**
 * GET /api/dashboard/admin/workload
 * Task distribution per employee
 */
exports.getAdminWorkload = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT u.id AS user_id, CONCAT(u.first_name, ' ', u.last_name) AS name,
              COUNT(t.id) AS total_tasks,
              SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
              SUM(CASE WHEN t.status = 'to_do' THEN 1 ELSE 0 END) AS to_do,
              SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done,
              SUM(CASE WHEN t.deadline < CURDATE() AND t.status != 'done' THEN 1 ELSE 0 END) AS overdue
       FROM users u
       LEFT JOIN tasks t ON t.assigned_to = u.id AND t.deleted = 0 AND t.is_active = 1
       WHERE u.is_active = 1 AND u.deleted = 0
       GROUP BY u.id, u.first_name, u.last_name
       ORDER BY total_tasks DESC`
    );

    const avgTasks = rows.length > 0
      ? Math.round(rows.reduce((sum, r) => sum + r.total_tasks, 0) / rows.length)
      : 0;

    return res.json({
      employees: rows,
      avg_tasks: avgTasks,
      total_employees: rows.length
    });
  } catch (err) {
    console.error('Admin workload error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};


/**
 * GET /api/dashboard/admin/top-performers
 * Leaderboard: tasks completed, attendance, productivity
 */
exports.getAdminTopPerformers = async (req, res) => {
  try {
    // Tasks completed this month
    const [taskPerformers] = await db.query(
      `SELECT u.id AS user_id, CONCAT(u.first_name, ' ', u.last_name) AS name,
              u.avatar_url, COUNT(t.id) AS tasks_completed
       FROM users u
       JOIN tasks t ON t.assigned_to = u.id
       WHERE t.status = 'done' AND t.deleted = 0
       AND MONTH(t.updated_at) = MONTH(CURDATE())
       AND YEAR(t.updated_at) = YEAR(CURDATE())
       AND u.is_active = 1 AND u.deleted = 0
       GROUP BY u.id ORDER BY tasks_completed DESC LIMIT 5`
    );

    // Best attendance this month (most on_time days)
    const [attendancePerformers] = await db.query(
      `SELECT u.id AS user_id, CONCAT(u.first_name, ' ', u.last_name) AS name,
              u.avatar_url, COUNT(a.id) AS on_time_days
       FROM users u
       JOIN attendance a ON a.user_id = u.id
       WHERE a.clock_in_status = 'on_time'
       AND MONTH(a.date) = MONTH(CURDATE())
       AND YEAR(a.date) = YEAR(CURDATE())
       AND u.is_active = 1 AND u.deleted = 0
       GROUP BY u.id ORDER BY on_time_days DESC LIMIT 5`
    );

    // Most productive hours this month
    const [productivityPerformers] = await db.query(
      `SELECT u.id AS user_id, CONCAT(u.first_name, ' ', u.last_name) AS name,
              u.avatar_url,
              ROUND(SUM(ttl.duration) / 3600, 1) AS total_hours
       FROM users u
       JOIN task_time_logs ttl ON ttl.user_id = u.id
       WHERE MONTH(ttl.started_at) = MONTH(CURDATE())
       AND YEAR(ttl.started_at) = YEAR(CURDATE())
       AND u.is_active = 1 AND u.deleted = 0
       GROUP BY u.id ORDER BY total_hours DESC LIMIT 5`
    );

    return res.json({
      by_tasks: taskPerformers,
      by_attendance: attendancePerformers,
      by_productivity: productivityPerformers
    });
  } catch (err) {
    console.error('Admin top performers error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};


/**
 * GET /api/dashboard/admin/project-health
 * Active projects with progress and risk indicators
 */
exports.getAdminProjectHealth = async (req, res) => {
  try {
    const [projects] = await db.query(
      `SELECT p.id, p.title AS name, p.status, p.end_date AS deadline, p.created_at,
              COUNT(pt.task_id) AS total_tasks,
              SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS completed_tasks,
              SUM(CASE WHEN t.deadline < CURDATE() AND t.status != 'done' THEN 1 ELSE 0 END) AS overdue_tasks
       FROM projects p
       LEFT JOIN project_tasks pt ON pt.project_id = p.id
       LEFT JOIN tasks t ON t.id = pt.task_id AND t.deleted = 0 AND t.is_active = 1
       WHERE p.deleted = 0 AND p.status IN ('open', 'in_progress')
       GROUP BY p.id
       ORDER BY p.end_date ASC
       LIMIT 8`
    );

    const projectsWithHealth = projects.map(p => {
      const progress = p.total_tasks > 0
        ? Math.round((p.completed_tasks / p.total_tasks) * 100)
        : 0;
      const isOverdue = p.deadline && new Date(p.deadline) < new Date();
      const hasOverdueTasks = p.overdue_tasks > 0;

      let health = 'on_track';
      if (isOverdue) health = 'delayed';
      else if (hasOverdueTasks) health = 'at_risk';

      return { ...p, progress, health };
    });

    return res.json({ projects: projectsWithHealth });
  } catch (err) {
    console.error('Admin project health error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};


/**
 * GET /api/dashboard/admin/expense-breakdown
 * Expenses by category for current month
 */
exports.getAdminExpenseBreakdown = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT category, COALESCE(SUM(amount), 0) AS total
       FROM expenses
       WHERE deleted = 0
       AND MONTH(expense_date) = MONTH(CURDATE())
       AND YEAR(expense_date) = YEAR(CURDATE())
       GROUP BY category
       ORDER BY total DESC`
    );

    const totalExpenses = rows.reduce((sum, r) => sum + parseFloat(r.total), 0);

    return res.json({
      breakdown: rows.map(r => ({
        category: r.category,
        amount: parseFloat(r.total),
        percentage: totalExpenses > 0 ? Math.round((parseFloat(r.total) / totalExpenses) * 100) : 0
      })),
      total: totalExpenses
    });
  } catch (err) {
    console.error('Admin expense breakdown error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};


/**
 * GET /api/dashboard/admin/lead-funnel
 * Lead conversion funnel stages
 */
exports.getAdminLeadFunnel = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT status, COUNT(*) AS count FROM leads
       WHERE deleted = 0
       GROUP BY status`
    );

    const statusMap = {};
    for (const row of rows) {
      statusMap[row.status] = row.count;
    }

    const funnel = [
      { stage: 'New', count: statusMap['New'] || 0 },
      { stage: 'Contacted', count: statusMap['Contacted'] || 0 },
      { stage: 'Proposal', count: statusMap['Proposal'] || 0 },
      { stage: 'Negotiation', count: statusMap['Negotiation'] || 0 },
      { stage: 'Won', count: (statusMap['Won'] || 0) + (statusMap['Converted'] || 0) },
      { stage: 'Lost', count: statusMap['Lost'] || 0 },
    ];

    const total = funnel.reduce((sum, f) => sum + f.count, 0);
    const winRate = total > 0
      ? Math.round((funnel[4].count / (funnel[4].count + funnel[5].count || 1)) * 100)
      : 0;

    return res.json({ funnel, total, win_rate: winRate });
  } catch (err) {
    console.error('Admin lead funnel error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};


/**
 * GET /api/dashboard/admin/cash-forecast
 * Revenue projection based on current month pace
 */
exports.getAdminCashForecast = async (req, res) => {
  try {
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysPassed = now.getDate();

    // Revenue collected so far this month
    const [collectedResult] = await db.query(
      `SELECT COALESCE(SUM(paid_amount), 0) AS total FROM invoices
       WHERE MONTH(bill_date) = MONTH(CURDATE()) AND YEAR(bill_date) = YEAR(CURDATE())
       AND deleted = 0`
    );
    const collectedSoFar = parseFloat(collectedResult[0].total);

    // Last month's total revenue
    const [lastMonthResult] = await db.query(
      `SELECT COALESCE(SUM(paid_amount), 0) AS total FROM invoices
       WHERE MONTH(bill_date) = MONTH(DATE_SUB(CURDATE(), INTERVAL 1 MONTH))
       AND YEAR(bill_date) = YEAR(DATE_SUB(CURDATE(), INTERVAL 1 MONTH))
       AND deleted = 0`
    );
    const lastMonthTotal = parseFloat(lastMonthResult[0].total);

    // Projected end-of-month
    const dailyRate = daysPassed > 0 ? collectedSoFar / daysPassed : 0;
    const projected = Math.round(dailyRate * daysInMonth);

    // Last 6 months revenue for trend
    const [monthlyRevenue] = await db.query(
      `SELECT DATE_FORMAT(bill_date, '%Y-%m') AS month,
              COALESCE(SUM(paid_amount), 0) AS revenue
       FROM invoices WHERE deleted = 0
       AND bill_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
       GROUP BY DATE_FORMAT(bill_date, '%Y-%m')
       ORDER BY month`
    );

    return res.json({
      collected_so_far: collectedSoFar,
      projected_end_of_month: projected,
      last_month_total: lastMonthTotal,
      daily_rate: Math.round(dailyRate),
      days_passed: daysPassed,
      days_in_month: daysInMonth,
      monthly_trend: monthlyRevenue
    });
  } catch (err) {
    console.error('Admin cash forecast error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};


/**
 * GET /api/dashboard/admin/trends
 * Week-over-week and month-over-month comparison stats
 */
exports.getAdminTrends = async (req, res) => {
  try {
    // This week vs last week: tasks completed
    const [thisWeekTasks] = await db.query(
      `SELECT COUNT(*) AS count FROM tasks
       WHERE status = 'done' AND deleted = 0
       AND YEARWEEK(updated_at, 1) = YEARWEEK(CURDATE(), 1)`
    );
    const [lastWeekTasks] = await db.query(
      `SELECT COUNT(*) AS count FROM tasks
       WHERE status = 'done' AND deleted = 0
       AND YEARWEEK(updated_at, 1) = YEARWEEK(DATE_SUB(CURDATE(), INTERVAL 7 DAY), 1)`
    );

    // This month vs last month: revenue
    const [thisMonthRevenue] = await db.query(
      `SELECT COALESCE(SUM(paid_amount), 0) AS total FROM invoices
       WHERE deleted = 0 AND MONTH(bill_date) = MONTH(CURDATE())
       AND YEAR(bill_date) = YEAR(CURDATE())`
    );
    const [lastMonthRevenue] = await db.query(
      `SELECT COALESCE(SUM(paid_amount), 0) AS total FROM invoices
       WHERE deleted = 0 AND MONTH(bill_date) = MONTH(DATE_SUB(CURDATE(), INTERVAL 1 MONTH))
       AND YEAR(bill_date) = YEAR(DATE_SUB(CURDATE(), INTERVAL 1 MONTH))`
    );

    // This week vs last week: new leads
    const [thisWeekLeads] = await db.query(
      `SELECT COUNT(*) AS count FROM leads
       WHERE deleted = 0 AND YEARWEEK(created_at, 1) = YEARWEEK(CURDATE(), 1)`
    );
    const [lastWeekLeads] = await db.query(
      `SELECT COUNT(*) AS count FROM leads
       WHERE deleted = 0 AND YEARWEEK(created_at, 1) = YEARWEEK(DATE_SUB(CURDATE(), INTERVAL 7 DAY), 1)`
    );

    // Attendance rate this week vs last week
    const [thisWeekAttendance] = await db.query(
      `SELECT COUNT(*) AS count FROM attendance
       WHERE YEARWEEK(date, 1) = YEARWEEK(CURDATE(), 1)`
    );
    const [lastWeekAttendance] = await db.query(
      `SELECT COUNT(*) AS count FROM attendance
       WHERE YEARWEEK(date, 1) = YEARWEEK(DATE_SUB(CURDATE(), INTERVAL 7 DAY), 1)`
    );

    const calcTrend = (current, previous) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - previous) / previous) * 100);
    };

    return res.json({
      tasks_completed: {
        current: thisWeekTasks[0].count,
        previous: lastWeekTasks[0].count,
        trend: calcTrend(thisWeekTasks[0].count, lastWeekTasks[0].count)
      },
      revenue: {
        current: parseFloat(thisMonthRevenue[0].total),
        previous: parseFloat(lastMonthRevenue[0].total),
        trend: calcTrend(parseFloat(thisMonthRevenue[0].total), parseFloat(lastMonthRevenue[0].total))
      },
      leads: {
        current: thisWeekLeads[0].count,
        previous: lastWeekLeads[0].count,
        trend: calcTrend(thisWeekLeads[0].count, lastWeekLeads[0].count)
      },
      attendance: {
        current: thisWeekAttendance[0].count,
        previous: lastWeekAttendance[0].count,
        trend: calcTrend(thisWeekAttendance[0].count, lastWeekAttendance[0].count)
      }
    });
  } catch (err) {
    console.error('Admin trends error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};


/**
 * GET /api/dashboard/member/performance-score
 * Composite performance score for current user
 */
exports.getMemberPerformanceScore = async (req, res) => {
  try {
    const userId = req.user.id;

    // Attendance score (on_time days / total working days this month)
    const [attendanceResult] = await db.query(
      `SELECT
        COUNT(*) AS total_days,
        SUM(CASE WHEN clock_in_status = 'on_time' THEN 1 ELSE 0 END) AS on_time_days
       FROM attendance
       WHERE user_id = ? AND MONTH(date) = MONTH(CURDATE()) AND YEAR(date) = YEAR(CURDATE())`,
      [userId]
    );
    const attendanceScore = attendanceResult[0].total_days > 0
      ? Math.round((attendanceResult[0].on_time_days / attendanceResult[0].total_days) * 100)
      : 0;

    // Task completion score (done / total assigned this month)
    const [taskResult] = await db.query(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS completed
       FROM tasks
       WHERE assigned_to = ? AND deleted = 0 AND is_active = 1
       AND MONTH(created_at) = MONTH(CURDATE()) AND YEAR(created_at) = YEAR(CURDATE())`,
      [userId]
    );
    const taskScore = taskResult[0].total > 0
      ? Math.round((taskResult[0].completed / taskResult[0].total) * 100)
      : 0;

    // Productivity score (hours logged vs expected)
    const [hoursResult] = await db.query(
      `SELECT COALESCE(SUM(duration), 0) AS total_seconds
       FROM task_time_logs
       WHERE user_id = ? AND MONTH(started_at) = MONTH(CURDATE())
       AND YEAR(started_at) = YEAR(CURDATE())`,
      [userId]
    );
    const hoursLogged = hoursResult[0].total_seconds / 3600;
    const workingDaysThisMonth = attendanceResult[0].total_days || 1;
    const expectedHours = workingDaysThisMonth * 8;
    const productivityScore = Math.min(100, Math.round((hoursLogged / expectedHours) * 100));

    // Overall composite score
    const overallScore = Math.round((attendanceScore + taskScore + productivityScore) / 3);

    return res.json({
      overall: overallScore,
      attendance: attendanceScore,
      tasks: taskScore,
      productivity: productivityScore,
      details: {
        on_time_days: attendanceResult[0].on_time_days,
        total_attendance_days: attendanceResult[0].total_days,
        tasks_completed: taskResult[0].completed,
        tasks_total: taskResult[0].total,
        hours_logged: Math.round(hoursLogged * 10) / 10,
        hours_expected: expectedHours
      }
    });
  } catch (err) {
    console.error('Member performance score error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};


/**
 * GET /api/dashboard/member/meetings-today
 * Today's meetings for current user
 */
exports.getMemberMeetingsToday = async (req, res) => {
  try {
    const userId = req.user.id;

    const [meetings] = await db.query(
      `SELECT DISTINCT m.id, m.title, m.meeting_date, m.start_time, m.end_time,
              m.status, m.meeting_link, m.location_type,
              CONCAT(u.first_name, ' ', u.last_name) AS organizer
       FROM meetings m
       LEFT JOIN meeting_members mm ON mm.meeting_id = m.id
       LEFT JOIN users u ON u.id = m.created_by
       WHERE (m.created_by = ? OR mm.user_id = ?)
       AND m.meeting_date = CURDATE() AND m.deleted = 0
       ORDER BY m.start_time ASC`,
      [userId, userId]
    );

    return res.json({ meetings });
  } catch (err) {
    console.error('Member meetings today error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/dashboard/member/streak
 * Attendance streak (consecutive on-time days)
 */
exports.getMemberStreak = async (req, res) => {
  try {
    const userId = req.user.id;

    const [rows] = await db.query(
      `SELECT date, clock_in_status FROM attendance
       WHERE user_id = ? ORDER BY date DESC LIMIT 60`,
      [userId]
    );

    let streak = 0;
    for (const row of rows) {
      if (row.clock_in_status === 'on_time' || row.clock_in_status === 'grace') {
        streak++;
      } else {
        break;
      }
    }

    // Best streak this month
    let bestStreak = 0;
    let currentStreak = 0;
    const monthRows = rows.filter(r => {
      const d = new Date(r.date);
      const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).reverse();

    for (const row of monthRows) {
      if (row.clock_in_status === 'on_time' || row.clock_in_status === 'grace') {
        currentStreak++;
        bestStreak = Math.max(bestStreak, currentStreak);
      } else {
        currentStreak = 0;
      }
    }

    return res.json({
      current_streak: streak,
      best_streak_this_month: bestStreak,
      total_on_time_this_month: monthRows.filter(
        r => r.clock_in_status === 'on_time'
      ).length
    });
  } catch (err) {
    console.error('Member streak error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};


/**
 * GET /api/dashboard/member/weekly-comparison
 * This week vs last week comparison
 */
exports.getMemberWeeklyComparison = async (req, res) => {
  try {
    const userId = req.user.id;

    // Tasks completed this week vs last week
    const [thisWeekTasks] = await db.query(
      `SELECT COUNT(*) AS count FROM tasks
       WHERE assigned_to = ? AND status = 'done' AND deleted = 0
       AND YEARWEEK(updated_at, 1) = YEARWEEK(CURDATE(), 1)`,
      [userId]
    );
    const [lastWeekTasks] = await db.query(
      `SELECT COUNT(*) AS count FROM tasks
       WHERE assigned_to = ? AND status = 'done' AND deleted = 0
       AND YEARWEEK(updated_at, 1) = YEARWEEK(DATE_SUB(CURDATE(), INTERVAL 7 DAY), 1)`,
      [userId]
    );

    // Hours logged this week vs last week
    const [thisWeekHours] = await db.query(
      `SELECT COALESCE(SUM(duration), 0) AS total FROM task_time_logs
       WHERE user_id = ? AND YEARWEEK(started_at, 1) = YEARWEEK(CURDATE(), 1)`,
      [userId]
    );
    const [lastWeekHours] = await db.query(
      `SELECT COALESCE(SUM(duration), 0) AS total FROM task_time_logs
       WHERE user_id = ? AND YEARWEEK(started_at, 1) = YEARWEEK(DATE_SUB(CURDATE(), INTERVAL 7 DAY), 1)`,
      [userId]
    );

    // Attendance this week vs last week
    const [thisWeekAttendance] = await db.query(
      `SELECT COUNT(*) AS count,
              SUM(CASE WHEN clock_in_status = 'on_time' THEN 1 ELSE 0 END) AS on_time
       FROM attendance
       WHERE user_id = ? AND YEARWEEK(date, 1) = YEARWEEK(CURDATE(), 1)`,
      [userId]
    );
    const [lastWeekAttendance] = await db.query(
      `SELECT COUNT(*) AS count,
              SUM(CASE WHEN clock_in_status = 'on_time' THEN 1 ELSE 0 END) AS on_time
       FROM attendance
       WHERE user_id = ? AND YEARWEEK(date, 1) = YEARWEEK(DATE_SUB(CURDATE(), INTERVAL 7 DAY), 1)`,
      [userId]
    );

    const calcTrend = (current, previous) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Math.round(((current - previous) / previous) * 100);
    };

    return res.json({
      tasks: {
        this_week: thisWeekTasks[0].count,
        last_week: lastWeekTasks[0].count,
        trend: calcTrend(thisWeekTasks[0].count, lastWeekTasks[0].count)
      },
      hours: {
        this_week: Math.round(thisWeekHours[0].total / 3600 * 10) / 10,
        last_week: Math.round(lastWeekHours[0].total / 3600 * 10) / 10,
        trend: calcTrend(thisWeekHours[0].total, lastWeekHours[0].total)
      },
      attendance: {
        this_week: thisWeekAttendance[0].count,
        last_week: lastWeekAttendance[0].count,
        on_time_this_week: thisWeekAttendance[0].on_time || 0,
        on_time_last_week: lastWeekAttendance[0].on_time || 0
      }
    });
  } catch (err) {
    console.error('Member weekly comparison error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};


/**
 * GET /api/dashboard/member/leave-balance
 * Leave balances with quick info
 */
exports.getMemberLeaveBalance = async (req, res) => {
  try {
    const userId = req.user.id;

    const [balances] = await db.query(
      `SELECT leave_type, total AS total_days, used AS used_days, (total - used) AS remaining
       FROM leave_balances
       WHERE user_id = ? AND year = YEAR(CURDATE())`,
      [userId]
    );

    // Upcoming holidays (next 30 days)
    const [holidays] = await db.query(
      `SELECT title AS name, date, holiday_type AS type FROM company_holidays
       WHERE date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)
       ORDER BY date ASC LIMIT 5`
    );

    // Pending leave requests
    const [pendingLeaves] = await db.query(
      `SELECT id, leave_type, from_date, to_date, days, status
       FROM leaves
       WHERE user_id = ? AND status = 'pending' AND deleted = 0
       ORDER BY from_date ASC`,
      [userId]
    );

    return res.json({
      balances,
      holidays,
      pending_requests: pendingLeaves
    });
  } catch (err) {
    console.error('Member leave balance error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/dashboard/member/my-tasks-summary
 * Tasks grouped by status for mini kanban
 */
exports.getMemberTasksSummary = async (req, res) => {
  try {
    const userId = req.user.id;

    const [tasks] = await db.query(
      `SELECT id, title, status, priority, deadline
       FROM tasks
       WHERE assigned_to = ? AND deleted = 0 AND is_active = 1
       AND status != 'done'
       ORDER BY
         CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
         deadline ASC
       LIMIT 20`,
      [userId]
    );

    const [recentDone] = await db.query(
      `SELECT id, title, status, priority, deadline
       FROM tasks
       WHERE assigned_to = ? AND deleted = 0 AND status = 'done'
       ORDER BY updated_at DESC LIMIT 5`,
      [userId]
    );

    const grouped = {
      to_do: tasks.filter(t => t.status === 'to_do'),
      in_progress: tasks.filter(t => t.status === 'in_progress'),
      done: recentDone
    };

    return res.json({
      tasks: grouped,
      counts: {
        to_do: grouped.to_do.length,
        in_progress: grouped.in_progress.length,
        done: recentDone.length
      }
    });
  } catch (err) {
    console.error('Member tasks summary error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};


/**
 * GET /api/dashboard/member/monthly-calendar
 * Attendance calendar data for current month
 */
exports.getMemberMonthlyCalendar = async (req, res) => {
  try {
    const userId = req.user.id;

    const [attendance] = await db.query(
      `SELECT date, clock_in_status, clock_in, clock_out, total_served_seconds
       FROM attendance
       WHERE user_id = ? AND MONTH(date) = MONTH(CURDATE()) AND YEAR(date) = YEAR(CURDATE())
       ORDER BY date`,
      [userId]
    );

    const [leaves] = await db.query(
      `SELECT from_date, to_date, leave_type, status
       FROM leaves
       WHERE user_id = ? AND status = 'approved' AND deleted = 0
       AND ((MONTH(from_date) = MONTH(CURDATE()) AND YEAR(from_date) = YEAR(CURDATE()))
        OR (MONTH(to_date) = MONTH(CURDATE()) AND YEAR(to_date) = YEAR(CURDATE())))`,
      [userId]
    );

    const [holidays] = await db.query(
      `SELECT date, title AS name FROM company_holidays
       WHERE MONTH(date) = MONTH(CURDATE()) AND YEAR(date) = YEAR(CURDATE())`
    );

    return res.json({
      attendance: attendance.map(a => ({
        date: a.date,
        status: a.clock_in_status,
        clock_in: a.clock_in,
        clock_out: a.clock_out,
        hours_served: a.total_served_seconds ? Math.round(a.total_served_seconds / 3600 * 10) / 10 : 0
      })),
      leaves,
      holidays
    });
  } catch (err) {
    console.error('Member monthly calendar error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
