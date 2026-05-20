const db = require('../config/db');

/**
 * GET /api/dashboard/member
 * Get current user's dashboard stats
 */
exports.memberStats = async (req, res) => {
  try {
    const userId = req.user.id;

    // Tasks count by status
    const [taskRows] = await db.query(
      `SELECT status, COUNT(*) AS count FROM tasks
       WHERE assigned_to = ? AND deleted = 0 AND is_active = 1
       GROUP BY status`,
      [userId]
    );
    const tasks = { to_do: 0, in_progress: 0, done: 0 };
    for (const row of taskRows) {
      if (tasks.hasOwnProperty(row.status)) tasks[row.status] = row.count;
    }

    // Projects count by status
    const [projectRows] = await db.query(
      `SELECT p.status, COUNT(*) AS count FROM projects p
       JOIN project_members pm ON pm.project_id = p.id
       WHERE pm.user_id = ? AND p.deleted = 0
       GROUP BY p.status`,
      [userId]
    );
    const projects = { open: 0, in_progress: 0, completed: 0 };
    for (const row of projectRows) {
      if (projects.hasOwnProperty(row.status)) projects[row.status] = row.count;
    }

    // Tickets count by status
    const [ticketRows] = await db.query(
      `SELECT status, COUNT(*) AS count FROM tickets
       WHERE (assigned_to = ? OR reported_by = ?) AND deleted = 0
       GROUP BY status`,
      [userId, userId]
    );
    const tickets = { open: 0, in_progress: 0, hold: 0, resolved: 0, closed: 0 };
    for (const row of ticketRows) {
      if (tickets.hasOwnProperty(row.status)) tickets[row.status] = row.count;
    }

    // Leave balances
    const [leaveBalances] = await db.query(
      `SELECT * FROM leave_balances WHERE user_id = ? AND year = YEAR(CURDATE())`,
      [userId]
    );
    const [pendingLeaves] = await db.query(
      `SELECT COUNT(*) AS count FROM leaves
       WHERE user_id = ? AND status = 'pending' AND deleted = 0`,
      [userId]
    );
    const leaves = {
      balances: leaveBalances,
      pending_count: pendingLeaves[0].count
    };

    // Unread announcements
    const [unreadAnnouncements] = await db.query(
      `SELECT COUNT(*) AS count FROM announcements a
       WHERE a.deleted = 0
       AND a.id NOT IN (SELECT announcement_id FROM announcement_reads WHERE user_id = ?)`,
      [userId]
    );
    const announcements = { unread_count: unreadAnnouncements[0].count };

    return res.json({ tasks, projects, tickets, leaves, announcements });
  } catch (err) {
    console.error('Member stats error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};


/**
 * GET /api/dashboard/admin
 * Get admin dashboard stats
 */
exports.adminStats = async (req, res) => {
  try {
    // Team today
    const [presentResult] = await db.query(
      `SELECT COUNT(*) AS count FROM attendance WHERE date = CURDATE()`
    );
    const [lateResult] = await db.query(
      `SELECT COUNT(*) AS count FROM attendance WHERE date = CURDATE() AND clock_in_status = 'late'`
    );
    const [onLeaveResult] = await db.query(
      `SELECT COUNT(DISTINCT user_id) AS count FROM leaves
       WHERE status = 'approved' AND deleted = 0
       AND CURDATE() BETWEEN from_date AND to_date`
    );
    const [totalUsersResult] = await db.query(
      `SELECT COUNT(*) AS count FROM users WHERE is_active = 1 AND deleted = 0`
    );
    const present = presentResult[0].count;
    const on_leave = onLeaveResult[0].count;
    const absent = Math.max(0, totalUsersResult[0].count - present - on_leave);

    const team_today = {
      present,
      late: lateResult[0].count,
      on_leave,
      absent,
      total: totalUsersResult[0].count
    };

    // Tasks
    const [totalTasksResult] = await db.query(
      `SELECT COUNT(*) AS count FROM tasks WHERE deleted = 0 AND is_active = 1`
    );
    const [overdueTasksResult] = await db.query(
      `SELECT COUNT(*) AS count FROM tasks
       WHERE deleted = 0 AND is_active = 1 AND deadline < CURDATE() AND status != 'done'`
    );
    const [unassignedTasksResult] = await db.query(
      `SELECT COUNT(*) AS count FROM tasks WHERE deleted = 0 AND is_active = 1 AND assigned_to IS NULL`
    );
    const taskStats = {
      total_active: totalTasksResult[0].count,
      overdue: overdueTasksResult[0].count,
      unassigned: unassignedTasksResult[0].count
    };

    // Projects count by status
    const [projectRows] = await db.query(
      `SELECT status, COUNT(*) AS count FROM projects WHERE deleted = 0 GROUP BY status`
    );
    const projectStats = { open: 0, in_progress: 0, completed: 0 };
    for (const row of projectRows) {
      if (projectStats.hasOwnProperty(row.status)) projectStats[row.status] = row.count;
    }

    // Tickets
    const [openTickets] = await db.query(
      `SELECT COUNT(*) AS count FROM tickets WHERE deleted = 0 AND status = 'open'`
    );
    const [inProgressTickets] = await db.query(
      `SELECT COUNT(*) AS count FROM tickets WHERE deleted = 0 AND status = 'in_progress'`
    );
    const [criticalTickets] = await db.query(
      `SELECT COUNT(*) AS count FROM tickets WHERE deleted = 0 AND priority = 'critical'`
    );
    const [overdueTickets] = await db.query(
      `SELECT COUNT(*) AS count FROM tickets
       WHERE deleted = 0 AND due_date < CURDATE() AND status NOT IN ('resolved', 'closed')`
    );
    const ticketStats = {
      open: openTickets[0].count,
      in_progress: inProgressTickets[0].count,
      critical: criticalTickets[0].count,
      overdue: overdueTickets[0].count
    };

    // Approvals pending
    const [pendingTaskApprovals] = await db.query(
      `SELECT COUNT(*) AS count FROM tasks WHERE is_active = 0 AND deleted = 0`
    );
    const [pendingLeaveApprovals] = await db.query(
      `SELECT COUNT(*) AS count FROM leaves WHERE status = 'pending' AND deleted = 0`
    );
    const [pendingReimbursements] = await db.query(
      `SELECT COUNT(*) AS count FROM reimbursements WHERE status = 'pending' AND deleted = 0`
    );
    const approvals = {
      tasks: pendingTaskApprovals[0].count,
      leaves: pendingLeaveApprovals[0].count,
      reimbursements: pendingReimbursements[0].count,
      total: pendingTaskApprovals[0].count + pendingLeaveApprovals[0].count + pendingReimbursements[0].count
    };

    // Revenue this month
    const [invoicedResult] = await db.query(
      `SELECT COALESCE(SUM(total_amount), 0) AS total FROM invoices
       WHERE MONTH(bill_date) = MONTH(CURDATE()) AND YEAR(bill_date) = YEAR(CURDATE()) AND deleted = 0`
    );
    const [collectedResult] = await db.query(
      `SELECT COALESCE(SUM(paid_amount), 0) AS total FROM invoices
       WHERE MONTH(bill_date) = MONTH(CURDATE()) AND YEAR(bill_date) = YEAR(CURDATE()) AND deleted = 0`
    );
    const [outstandingResult] = await db.query(
      `SELECT COALESCE(SUM(balance_amount), 0) AS total FROM invoices
       WHERE deleted = 0 AND status != 'Paid'`
    );
    const revenue = {
      invoiced: parseFloat(invoicedResult[0].total),
      collected: parseFloat(collectedResult[0].total),
      outstanding: parseFloat(outstandingResult[0].total)
    };

    // Expenses this month
    const [expensesResult] = await db.query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM expenses
       WHERE MONTH(expense_date) = MONTH(CURDATE()) AND YEAR(expense_date) = YEAR(CURDATE()) AND deleted = 0`
    );
    const expenses = parseFloat(expensesResult[0].total);

    return res.json({
      team_today,
      tasks: taskStats,
      projects: projectStats,
      tickets: ticketStats,
      approvals,
      revenue,
      expenses
    });
  } catch (err) {
    console.error('Admin stats error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};


/**
 * GET /api/dashboard/charts/my-productivity
 * Get current user's task timer durations for current week (Mon-Sun)
 */
exports.chartsMyProductivity = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get current week Mon-Sun
    const [weekRange] = await db.query(
      `SELECT 
        DATE_SUB(CURDATE(), INTERVAL (WEEKDAY(CURDATE())) DAY) AS week_start,
        DATE_ADD(DATE_SUB(CURDATE(), INTERVAL (WEEKDAY(CURDATE())) DAY), INTERVAL 6 DAY) AS week_end`
    );
    const { week_start, week_end } = weekRange[0];

    const [rows] = await db.query(
      `SELECT DATE(started_at) AS date, SUM(duration) AS total_seconds
       FROM task_time_logs
       WHERE user_id = ? AND DATE(started_at) BETWEEN ? AND ?
       GROUP BY DATE(started_at)
       ORDER BY date`,
      [userId, week_start, week_end]
    );

    const data = rows.map(row => ({
      date: row.date,
      hours: parseFloat((row.total_seconds / 3600).toFixed(2))
    }));

    return res.json({ week_start, week_end, data });
  } catch (err) {
    console.error('Charts my productivity error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/dashboard/charts/my-attendance
 * Get current user's monthly attendance breakdown (donut chart)
 */
exports.chartsMyAttendance = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get current month attendance records grouped by status
    const [records] = await db.query(
      `SELECT clock_in_status, COUNT(*) AS count FROM attendance
       WHERE user_id = ? AND MONTH(date) = MONTH(CURDATE()) AND YEAR(date) = YEAR(CURDATE())
       GROUP BY clock_in_status`,
      [userId]
    );

    // Get leave days this month
    const [leaveResult] = await db.query(
      `SELECT COALESCE(SUM(days), 0) AS leave_days FROM leaves
       WHERE user_id = ? AND status = 'approved' AND deleted = 0
       AND MONTH(from_date) = MONTH(CURDATE()) AND YEAR(from_date) = YEAR(CURDATE())`,
      [userId]
    );

    // Calculate working days in current month up to today
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    let totalWorkingDays = 0;
    for (let d = new Date(monthStart); d <= now; d.setDate(d.getDate() + 1)) {
      const day = d.getDay();
      if (day !== 0 && day !== 6) totalWorkingDays++;
    }

    const statusCounts = { on_time: 0, grace: 0, late: 0 };
    for (const row of records) {
      if (statusCounts.hasOwnProperty(row.clock_in_status)) {
        statusCounts[row.clock_in_status] = row.count;
      }
    }

    const presentDays = statusCounts.on_time + statusCounts.grace + statusCounts.late;
    const leaveDays = leaveResult[0].leave_days;
    const absentDays = Math.max(0, totalWorkingDays - presentDays - leaveDays);

    return res.json({
      on_time: statusCounts.on_time,
      grace: statusCounts.grace,
      late: statusCounts.late,
      absent: absentDays,
      leave: leaveDays,
      total_working_days: totalWorkingDays
    });
  } catch (err) {
    console.error('Charts my attendance error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};


/**
 * GET /api/dashboard/charts/team-attendance
 * Admin: Weekly team attendance breakdown (Mon-Sun)
 */
exports.chartsTeamAttendance = async (req, res) => {
  try {
    // Get current week Mon-Sun
    const [weekRange] = await db.query(
      `SELECT 
        DATE_SUB(CURDATE(), INTERVAL (WEEKDAY(CURDATE())) DAY) AS week_start,
        DATE_ADD(DATE_SUB(CURDATE(), INTERVAL (WEEKDAY(CURDATE())) DAY), INTERVAL 6 DAY) AS week_end`
    );
    const { week_start, week_end } = weekRange[0];

    // Total active users
    const [totalUsersResult] = await db.query(
      `SELECT COUNT(*) AS count FROM users WHERE is_active = 1 AND deleted = 0`
    );
    const totalUsers = totalUsersResult[0].count;

    // Attendance grouped by date and status
    const [attendanceRows] = await db.query(
      `SELECT date, clock_in_status, COUNT(*) AS count
       FROM attendance
       WHERE date BETWEEN ? AND ?
       GROUP BY date, clock_in_status
       ORDER BY date`,
      [week_start, week_end]
    );

    // Leaves per day
    const [leaveRows] = await db.query(
      `SELECT d.date, COUNT(DISTINCT l.user_id) AS count
       FROM (
         SELECT DATE_ADD(?, INTERVAL seq DAY) AS date
         FROM (SELECT 0 AS seq UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6) s
       ) d
       LEFT JOIN leaves l ON l.status = 'approved' AND l.deleted = 0
         AND d.date BETWEEN l.from_date AND l.to_date
       WHERE d.date BETWEEN ? AND ?
       GROUP BY d.date`,
      [week_start, week_start, week_end]
    );

    // Build day-by-day data
    const leaveMap = {};
    for (const row of leaveRows) {
      leaveMap[row.date] = row.count;
    }

    const dayMap = {};
    for (const row of attendanceRows) {
      const dateKey = row.date instanceof Date ? row.date.toISOString().split('T')[0] : row.date;
      if (!dayMap[dateKey]) {
        dayMap[dateKey] = { on_time: 0, grace: 0, late: 0 };
      }
      if (dayMap[dateKey].hasOwnProperty(row.clock_in_status)) {
        dayMap[dateKey][row.clock_in_status] = row.count;
      }
    }

    // Generate array for each day of the week
    const data = [];
    const startDate = new Date(week_start);
    for (let i = 0; i < 7; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      const dayData = dayMap[dateStr] || { on_time: 0, grace: 0, late: 0 };
      const leaveCount = leaveMap[dateStr] || 0;
      const presentCount = dayData.on_time + dayData.grace + dayData.late;
      const absentCount = Math.max(0, totalUsers - presentCount - leaveCount);

      data.push({
        date: dateStr,
        on_time: dayData.on_time,
        grace: dayData.grace,
        late: dayData.late,
        absent: absentCount,
        leave: leaveCount
      });
    }

    return res.json({ week_start, week_end, data });
  } catch (err) {
    console.error('Charts team attendance error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/dashboard/charts/team-productivity
 * Admin: Average productive hours across all users for last 7 days
 */
exports.chartsTeamProductivity = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT DATE(started_at) AS date,
              SUM(duration) / COUNT(DISTINCT user_id) / 3600 AS avg_hours
       FROM task_time_logs
       WHERE DATE(started_at) >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
       GROUP BY DATE(started_at)
       ORDER BY date`
    );

    const data = rows.map(row => ({
      date: row.date,
      avg_hours: parseFloat(parseFloat(row.avg_hours).toFixed(2))
    }));

    return res.json({ data });
  } catch (err) {
    console.error('Charts team productivity error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};


/**
 * GET /api/dashboard/charts/revenue
 * Admin: Monthly revenue and expenses for last 6 months
 */
exports.chartsRevenue = async (req, res) => {
  try {
    const [revenueRows] = await db.query(
      `SELECT DATE_FORMAT(bill_date, '%Y-%m') AS month, COALESCE(SUM(total_amount), 0) AS revenue
       FROM invoices
       WHERE deleted = 0 AND bill_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
       GROUP BY DATE_FORMAT(bill_date, '%Y-%m')
       ORDER BY month`
    );

    const [expenseRows] = await db.query(
      `SELECT DATE_FORMAT(expense_date, '%Y-%m') AS month, COALESCE(SUM(amount), 0) AS expenses
       FROM expenses
       WHERE deleted = 0 AND expense_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
       GROUP BY DATE_FORMAT(expense_date, '%Y-%m')
       ORDER BY month`
    );

    // Merge revenue and expenses by month
    const monthMap = {};
    for (const row of revenueRows) {
      monthMap[row.month] = { month: row.month, revenue: parseFloat(row.revenue), expenses: 0 };
    }
    for (const row of expenseRows) {
      if (!monthMap[row.month]) {
        monthMap[row.month] = { month: row.month, revenue: 0, expenses: 0 };
      }
      monthMap[row.month].expenses = parseFloat(row.expenses);
    }

    const data = Object.values(monthMap).sort((a, b) => a.month.localeCompare(b.month));

    return res.json({ data });
  } catch (err) {
    console.error('Charts revenue error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/dashboard/charts/leads-pipeline
 * Admin: Leads pipeline breakdown
 */
exports.chartsLeadsPipeline = async (req, res) => {
  try {
    // Count by temperature
    const [tempRows] = await db.query(
      `SELECT temperature, COUNT(*) AS count FROM leads WHERE deleted = 0 GROUP BY temperature`
    );
    const pipeline = { hot: 0, warm: 0, cold: 0 };
    for (const row of tempRows) {
      if (pipeline.hasOwnProperty(row.temperature)) pipeline[row.temperature] = row.count;
    }

    // New this month
    const [newThisMonth] = await db.query(
      `SELECT COUNT(*) AS count FROM leads
       WHERE deleted = 0 AND MONTH(created_at) = MONTH(CURDATE()) AND YEAR(created_at) = YEAR(CURDATE())`
    );

    // Converted (Won)
    const [convertedResult] = await db.query(
      `SELECT COUNT(*) AS count FROM leads WHERE deleted = 0 AND status IN ('Won', 'Converted')`
    );

    // Lost
    const [lostResult] = await db.query(
      `SELECT COUNT(*) AS count FROM leads WHERE deleted = 0 AND status = 'Lost'`
    );

    // Total
    const [totalResult] = await db.query(
      `SELECT COUNT(*) AS count FROM leads WHERE deleted = 0`
    );

    return res.json({
      hot: pipeline.hot,
      warm: pipeline.warm,
      cold: pipeline.cold,
      new_this_month: newThisMonth[0].count,
      converted: convertedResult[0].count,
      lost: lostResult[0].count,
      total: totalResult[0].count
    });
  } catch (err) {
    console.error('Charts leads pipeline error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};


/**
 * GET /api/dashboard/birthdays
 * Returns upcoming birthdays (next 7 days) excluding the requesting user.
 * Also returns whether today is the requesting user's own birthday.
 */
exports.getBirthdays = async (req, res) => {
  try {
    const userId = req.user.id;

    // Check if today is the current user's birthday
    const [selfRows] = await db.query(
      `SELECT first_name, last_name, date_of_birth FROM users
       WHERE id = ? AND deleted = 0 AND date_of_birth IS NOT NULL
       AND MONTH(date_of_birth) = MONTH(CURDATE()) AND DAY(date_of_birth) = DAY(CURDATE())`,
      [userId]
    );
    const isMyBirthday = selfRows.length > 0;
    const myName = isMyBirthday ? `${selfRows[0].first_name} ${selfRows[0].last_name}` : null;

    // Get upcoming birthdays in the next 7 days (excluding the requesting user)
    // Use MONTH/DAY comparison to handle year-end wrapping properly
    const [upcomingRows] = await db.query(
      `SELECT id, first_name, last_name, date_of_birth, avatar_url,
              DATEDIFF(
                CASE 
                  WHEN DATE_FORMAT(date_of_birth, '%m-%d') >= DATE_FORMAT(CURDATE(), '%m-%d')
                  THEN STR_TO_DATE(CONCAT(YEAR(CURDATE()), '-', MONTH(date_of_birth), '-', DAY(date_of_birth)), '%Y-%m-%d')
                  ELSE STR_TO_DATE(CONCAT(YEAR(CURDATE()) + 1, '-', MONTH(date_of_birth), '-', DAY(date_of_birth)), '%Y-%m-%d')
                END,
                CURDATE()
              ) AS days_until
       FROM users
       WHERE deleted = 0 AND is_active = 1 AND date_of_birth IS NOT NULL AND id != ?
       HAVING days_until BETWEEN 0 AND 7
       ORDER BY days_until ASC`,
      [userId]
    );

    console.log('Birthday API - userId:', userId, 'isMyBirthday:', isMyBirthday, 'upcoming:', upcomingRows.length);

    return res.json({
      is_my_birthday: isMyBirthday,
      my_name: myName,
      upcoming: upcomingRows.map(row => ({
        id: row.id,
        name: `${row.first_name} ${row.last_name}`,
        date_of_birth: row.date_of_birth,
        avatar_url: row.avatar_url,
        days_until: row.days_until,
      })),
    });
  } catch (err) {
    console.error('Get birthdays error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};


/**
 * GET /api/dashboard/deadlines
 * Get upcoming deadlines for current user (next 7 days)
 */
exports.getDeadlines = async (req, res) => {
  try {
    const userId = req.user.id;

    // Upcoming task deadlines
    const [taskDeadlines] = await db.query(
      `SELECT id, title, deadline AS due_date, priority
       FROM tasks
       WHERE assigned_to = ? AND deleted = 0 AND status != 'done'
       AND deadline BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
       ORDER BY deadline`,
      [userId]
    );

    // Upcoming ticket due dates
    const [ticketDeadlines] = await db.query(
      `SELECT id, title, due_date, priority
       FROM tickets
       WHERE assigned_to = ? AND deleted = 0 AND status NOT IN ('resolved', 'closed')
       AND due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
       ORDER BY due_date`,
      [userId]
    );

    // Combine and sort
    const deadlines = [
      ...taskDeadlines.map(t => ({ type: 'task', id: t.id, title: t.title, due_date: t.due_date, priority: t.priority })),
      ...ticketDeadlines.map(t => ({ type: 'ticket', id: t.id, title: t.title, due_date: t.due_date, priority: t.priority }))
    ].sort((a, b) => new Date(a.due_date) - new Date(b.due_date));

    return res.json({ deadlines });
  } catch (err) {
    console.error('Get deadlines error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/dashboard/timeline
 * Get today's activity timeline for current user
 */
exports.getTimeline = async (req, res) => {
  try {
    const userId = req.user.id;
    const timeline = [];

    // Attendance clock_in / clock_out
    const [attendanceRows] = await db.query(
      `SELECT clock_in, clock_out FROM attendance WHERE user_id = ? AND date = CURDATE()`,
      [userId]
    );
    if (attendanceRows.length) {
      const att = attendanceRows[0];
      if (att.clock_in) {
        timeline.push({
          time: att.clock_in,
          type: 'clock_in',
          details: 'Clocked in for the day'
        });
      }
      if (att.clock_out) {
        timeline.push({
          time: att.clock_out,
          type: 'clock_out',
          details: 'Clocked out for the day'
        });
      }
    }

    // AFS logs
    const [afsRows] = await db.query(
      `SELECT start_time, end_time FROM afs_logs
       WHERE user_id = ? AND DATE(start_time) = CURDATE()
       ORDER BY start_time`,
      [userId]
    );
    for (const afs of afsRows) {
      timeline.push({
        time: afs.start_time,
        type: 'afs_start',
        details: 'Away from system'
      });
      if (afs.end_time) {
        timeline.push({
          time: afs.end_time,
          type: 'afs_end',
          details: 'Back to system'
        });
      }
    }

    // Task time logs
    const [taskTimeRows] = await db.query(
      `SELECT ttl.started_at, ttl.ended_at, t.title AS task_title
       FROM task_time_logs ttl
       LEFT JOIN tasks t ON t.id = ttl.task_id
       WHERE ttl.user_id = ? AND DATE(ttl.started_at) = CURDATE()
       ORDER BY ttl.started_at`,
      [userId]
    );
    for (const log of taskTimeRows) {
      timeline.push({
        time: log.started_at,
        type: 'task_start',
        details: `Started working on: ${log.task_title || 'Unknown task'}`
      });
      if (log.ended_at) {
        timeline.push({
          time: log.ended_at,
          type: 'task_stop',
          details: `Stopped working on: ${log.task_title || 'Unknown task'}`
        });
      }
    }

    // Sort by time ascending
    timeline.sort((a, b) => new Date(a.time) - new Date(b.time));

    return res.json({ timeline });
  } catch (err) {
    console.error('Get timeline error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
