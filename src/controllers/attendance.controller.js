const db = require('../config/db');
const { getExpectedHoursForDate, getExpectedHoursForRange } = require('./workSchedule.controller');

exports.clockIn = async (req, res) => {
  try {
    const userId = req.user.id;
    const { plans, late_reason } = req.body;

    // ── Block clock-in if user has unresolved past-day attendance or orphaned timers ──
    const [unclosedAttendance] = await db.query(
      `SELECT id, date, clock_in FROM attendance 
       WHERE user_id = ? AND clock_out IS NULL AND date < CURDATE()`,
      [userId]
    );
    const [orphanedTaskTimers] = await db.query(
      `SELECT tat.id, tat.task_id, tat.started_at, t.title
       FROM task_active_timers tat
       JOIN tasks t ON t.id = tat.task_id
       WHERE tat.user_id = ? AND DATE(tat.started_at) < CURDATE()`,
      [userId]
    );
    const [orphanedTicketTimers] = await db.query(
      `SELECT tt.id, tt.ticket_id, tt.started_at, tk.title
       FROM ticket_active_timers tt
       JOIN tickets tk ON tk.id = tt.ticket_id
       WHERE tt.user_id = ? AND DATE(tt.started_at) < CURDATE()`,
      [userId]
    );
    const [orphanedMeetingTimers] = await db.query(
      `SELECT mat.id, mat.meeting_id, mat.started_at, m.title
       FROM meeting_active_timers mat
       JOIN meetings m ON m.id = mat.meeting_id
       WHERE mat.user_id = ? AND DATE(mat.started_at) < CURDATE()`,
      [userId]
    );

    if (unclosedAttendance.length > 0 || orphanedTaskTimers.length > 0 || orphanedTicketTimers.length > 0 || orphanedMeetingTimers.length > 0) {
      return res.status(400).json({
        message: 'You have unresolved past-day attendance or timers. Please resolve them before clocking in.',
        pending: true,
        unclosed_attendance: unclosedAttendance,
        orphaned_task_timers: orphanedTaskTimers,
        orphaned_ticket_timers: orphanedTicketTimers,
        orphaned_meeting_timers: orphanedMeetingTimers,
      });
    }
    // ──────────────────────────────────────────────────────────────────────────

    const [existing] = await db.query(
      'SELECT id FROM attendance WHERE user_id = ? AND date = CURDATE()',
      [userId]
    );
    if (existing.length) {
      return res.status(400).json({ message: 'Already clocked in today' });
    }

    const [settings] = await db.query('SELECT * FROM attendance_settings WHERE id = 1');
    const { shift_start_time, grace_period_minutes } = settings[0];

    // Use IST (UTC+5:30) for clock-in status comparison
    // MySQL CURTIME() returns UTC which causes wrong status — use Node.js time instead
    const nowIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    const nowHours = nowIST.getUTCHours();
    const nowMinutes = nowIST.getUTCMinutes();

    // Convert shift_start_time to hours and minutes
    const shiftParts = shift_start_time.split(':');
    const shiftHours = parseInt(shiftParts[0]);
    const shiftMinutes = parseInt(shiftParts[1]);

    // On Time: up to 09:00:59 (hour < 9, or hour == 9 and minute == 0)
    // Grace: 09:01:00 to 09:10:59 (hour == 9, minutes 1 to grace_period_minutes)
    // Late: 09:11:00 onwards
    const nowTotalMinutes = nowHours * 60 + nowMinutes;
    const shiftTotalMinutes = shiftHours * 60 + shiftMinutes;
    const graceEndMinutes = shiftTotalMinutes + grace_period_minutes; // 9*60 + 0 + 10 = 550

    // ── First Day Joining detection ───────────────────────────────────────────
    // Trigger if:
    //   (a) User has zero prior attendance records, OR
    //   (b) User has is_rejoining = 1 set by admin (returning employee)
    // AND they provide "first day joining" (case-insensitive) as their late reason.
    const isFirstDayReason = typeof late_reason === 'string' &&
      late_reason.trim().toLowerCase() === 'first day joining';

    const [priorAttendance] = await db.query(
      'SELECT COUNT(*) AS cnt FROM attendance WHERE user_id = ?',
      [userId]
    );
    const [userFlags] = await db.query(
      'SELECT is_rejoining FROM users WHERE id = ?',
      [userId]
    );
    const hasNoHistory = priorAttendance[0].cnt === 0;
    const isRejoining = userFlags[0]?.is_rejoining === 1;
    const isFirstDayJoining = isFirstDayReason && (hasNoHistory || isRejoining);
    // ─────────────────────────────────────────────────────────────────────────

    let clock_in_status;
    let effective_clock_in = null;

    if (nowTotalMinutes <= shiftTotalMinutes) {
      // e.g. 09:00:xx or earlier → on_time
      clock_in_status = 'on_time';
    } else if (nowTotalMinutes <= graceEndMinutes) {
      // e.g. 09:01:xx to 09:10:xx → grace
      clock_in_status = 'grace';
    } else {
      // e.g. 09:11:xx onwards → late
      if (isFirstDayJoining) {
        // ── FDJ treatment: mark on_time, backdate effective clock-in to shift start ──
        clock_in_status = 'on_time';
        // Build effective_clock_in = today's date + shift start time (IST → UTC)
        const todayIST = nowIST.toISOString().split('T')[0]; // YYYY-MM-DD in IST
        // shift_start_time is in IST (e.g. "09:00"), convert to UTC by subtracting 5h30m
        const shiftStartIST = new Date(`${todayIST}T${shift_start_time}:00+05:30`);
        effective_clock_in = shiftStartIST; // store as UTC datetime
      } else {
        clock_in_status = 'late';
        if (!late_reason) {
          return res.status(400).json({ message: 'Late reason is required when clocking in late' });
        }
      }
    }

    const [result] = await db.query(
      `INSERT INTO attendance (user_id, date, clock_in, effective_clock_in, clock_in_status, late_reason)
       VALUES (?, CURDATE(), NOW(), ?, ?, ?)`,
      [userId, effective_clock_in || null, clock_in_status, late_reason || null]
    );

    // ── Auto-clear is_rejoining flag after first FDJ clock-in ─────────────────
    if (isFirstDayJoining && isRejoining) {
      await db.query('UPDATE users SET is_rejoining = 0 WHERE id = ?', [userId]);
    }
    const attendanceId = result.insertId;

    const insertedPlans = [];
    if (plans && plans.length) {
      for (let i = 0; i < plans.length; i++) {
        const [planResult] = await db.query(
          `INSERT INTO daily_plans (attendance_id, user_id, date, point_text, sort_order, is_additional, status)
           VALUES (?, ?, CURDATE(), ?, ?, 0, 'to_do')`,
          [attendanceId, userId, plans[i], i + 1]
        );
        insertedPlans.push({
          id: planResult.insertId,
          point_text: plans[i],
          sort_order: i + 1,
          is_additional: 0,
          status: 'to_do'
        });
      }
    }

    const [attendance] = await db.query('SELECT * FROM attendance WHERE id = ?', [attendanceId]);

    res.emitSocket('attendance:clockin', { attendance: attendance[0], plans: insertedPlans });
    return res.status(201).json({ attendance: attendance[0], plans: insertedPlans });
  } catch (err) {
    console.error('Clock in error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.clockOut = async (req, res) => {
  try {
    const userId = req.user.id;
    const { plans, additional } = req.body;

    const [records] = await db.query(
      'SELECT * FROM attendance WHERE user_id = ? AND date = CURDATE() AND clock_out IS NULL',
      [userId]
    );
    if (!records.length) {
      return res.status(400).json({ message: 'No active clock-in found for today' });
    }

    const attendance = records[0];
    const attendanceId = attendance.id;
    const now = new Date();

    // ── Stop all running task timers ──────────────────────────────────────────
    const [activeTaskTimers] = await db.query(
      'SELECT id, task_id, started_at FROM task_active_timers WHERE user_id = ?',
      [userId]
    );
    for (const timer of activeTaskTimers) {
      const startedAt = new Date(timer.started_at);
      const duration = Math.max(1, Math.floor((now - startedAt) / 1000));
      await db.query(
        `INSERT INTO task_time_logs (task_id, user_id, started_at, ended_at, duration, note)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [timer.task_id, userId, timer.started_at, now, duration, 'Auto-stopped on clock out']
      );
      await db.query(
        'UPDATE tasks SET time_spent = time_spent + ?, timer_started_at = NULL WHERE id = ?',
        [duration, timer.task_id]
      );
      await db.query('DELETE FROM task_active_timers WHERE id = ?', [timer.id]);
    }

    // ── Stop all running ticket timers ────────────────────────────────────────
    const [activeTicketTimers] = await db.query(
      'SELECT id, ticket_id, started_at FROM ticket_active_timers WHERE user_id = ?',
      [userId]
    );
    for (const timer of activeTicketTimers) {
      const startedAt = new Date(timer.started_at);
      const duration = Math.max(1, Math.floor((now - startedAt) / 1000));
      const minutes = Math.ceil(duration / 60);
      await db.query(
        `INSERT INTO ticket_time_logs (ticket_id, user_id, minutes, description, started_at, ended_at, duration, log_date, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURDATE(), ?)`,
        [timer.ticket_id, userId, minutes, 'Auto-stopped on clock out', timer.started_at, now, duration, now]
      );
      await db.query('DELETE FROM ticket_active_timers WHERE id = ?', [timer.id]);
    }

    // ── Stop all running meeting timers ───────────────────────────────────────
    const [activeMeetingTimers] = await db.query(
      'SELECT id, meeting_id, started_at FROM meeting_active_timers WHERE user_id = ?',
      [userId]
    );
    for (const timer of activeMeetingTimers) {
      const startedAt = new Date(timer.started_at);
      const duration = Math.max(1, Math.floor((now - startedAt) / 1000));
      await db.query(
        `INSERT INTO meeting_time_logs (meeting_id, user_id, started_at, ended_at, duration, note)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [timer.meeting_id, userId, timer.started_at, now, duration, 'Auto-stopped on clock out']
      );
      await db.query('DELETE FROM meeting_active_timers WHERE id = ?', [timer.id]);
    }

    // ── End any active AFS session ────────────────────────────────────────────
    const [activeAfs] = await db.query(
      'SELECT id, start_time FROM afs_logs WHERE user_id = ? AND end_time IS NULL',
      [userId]
    );
    for (const afs of activeAfs) {
      const afsDuration = Math.floor((now - new Date(afs.start_time)) / 1000);
      await db.query(
        'UPDATE afs_logs SET end_time = ?, duration_seconds = ? WHERE id = ?',
        [now, afsDuration, afs.id]
      );
      await db.query(
        'UPDATE attendance SET total_afs_seconds = total_afs_seconds + ? WHERE id = ?',
        [afsDuration, attendanceId]
      );
    }

    // ── Calculate served time and clock out ────────────────────────────────────
    // Use effective_clock_in if set (First Day Joining case) so deficit is correct
    const [servedResult] = await db.query(
      `SELECT TIMESTAMPDIFF(SECOND, COALESCE(effective_clock_in, clock_in), NOW()) AS total_served
       FROM attendance WHERE id = ?`,
      [attendanceId]
    );
    const total_served_seconds = servedResult[0].total_served;

    const [afsResult] = await db.query(
      'SELECT COALESCE(SUM(duration_seconds), 0) AS total_afs FROM afs_logs WHERE attendance_id = ?',
      [attendanceId]
    );
    const total_afs_seconds = afsResult[0].total_afs;

    await db.query(
      'UPDATE attendance SET clock_out = NOW(), total_served_seconds = ?, total_afs_seconds = ? WHERE id = ?',
      [total_served_seconds, total_afs_seconds, attendanceId]
    );

    if (plans && plans.length) {
      for (const plan of plans) {
        await db.query(
          'UPDATE daily_plans SET status = ? WHERE id = ? AND user_id = ?',
          [plan.status, plan.id, userId]
        );
      }
    }

    if (additional && additional.length) {
      const [existingPlans] = await db.query(
        'SELECT MAX(sort_order) AS max_order FROM daily_plans WHERE attendance_id = ?',
        [attendanceId]
      );
      let sortOrder = (existingPlans[0].max_order || 0) + 1;
      for (const item of additional) {
        await db.query(
          `INSERT INTO daily_plans (attendance_id, user_id, date, point_text, sort_order, is_additional, status)
           VALUES (?, ?, CURDATE(), ?, ?, 1, ?)`,
          [attendanceId, userId, item.point_text, sortOrder++, item.status || 'completed']
        );
      }
    }

    const [updated] = await db.query('SELECT * FROM attendance WHERE id = ?', [attendanceId]);
    const [updatedPlans] = await db.query(
      'SELECT * FROM daily_plans WHERE attendance_id = ? ORDER BY sort_order',
      [attendanceId]
    );

    res.emitSocket('attendance:clockout', { attendance: updated[0], plans: updatedPlans });
    return res.json({ attendance: updated[0], plans: updatedPlans });
  } catch (err) {
    console.error('Clock out error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.getToday = async (req, res) => {
  try {
    const userId = req.user.id;

    const [attendance] = await db.query(
      'SELECT * FROM attendance WHERE user_id = ? AND date = CURDATE()',
      [userId]
    );

    const [plans] = await db.query(
      'SELECT * FROM daily_plans WHERE user_id = ? AND date = CURDATE() ORDER BY sort_order',
      [userId]
    );

    const [activeAfs] = await db.query(
      'SELECT * FROM afs_logs WHERE user_id = ? AND end_time IS NULL ORDER BY start_time DESC LIMIT 1',
      [userId]
    );

    // Completed task timer segments today (from task_time_logs)
    const [taskTimerResult] = await db.query(
      'SELECT COALESCE(SUM(duration), 0) AS total FROM task_time_logs WHERE user_id = ? AND DATE(started_at) = CURDATE() AND ended_at IS NOT NULL AND duration > 0',
      [userId]
    );
    // Currently running task timer — lives in task_active_timers (no log entry until stopped)
    const [activeTaskTimerResult] = await db.query(
      'SELECT COALESCE(TIMESTAMPDIFF(SECOND, started_at, NOW()), 0) AS elapsed FROM task_active_timers WHERE user_id = ? AND DATE(started_at) = CURDATE() ORDER BY started_at DESC LIMIT 1',
      [userId]
    );
    const totalTaskSecondsToday = parseInt(taskTimerResult[0].total) + parseInt(activeTaskTimerResult[0]?.elapsed || 0);

    // Get today's ticket time
    const [ticketTimerResult] = await db.query(
      'SELECT COALESCE(SUM(minutes), 0) AS total FROM ticket_time_logs WHERE user_id = ? AND DATE(created_at) = CURDATE()',
      [userId]
    );

    // Get today's meeting time — completed timer sessions (from meeting_time_logs)
    const [meetingTimerResult] = await db.query(
      `SELECT COALESCE(SUM(duration), 0) AS total 
       FROM meeting_time_logs 
       WHERE user_id = ? AND DATE(started_at) = CURDATE() AND ended_at IS NOT NULL AND duration > 0`,
      [userId]
    );

    // Currently running meeting timer — lives in meeting_active_timers (no log entry until stopped)
    const [activeMeetingTimerResult] = await db.query(
      `SELECT COALESCE(TIMESTAMPDIFF(SECOND, started_at, NOW()), 0) AS elapsed 
       FROM meeting_active_timers 
       WHERE user_id = ? AND DATE(started_at) = CURDATE() 
       ORDER BY started_at DESC LIMIT 1`,
      [userId]
    );
    const totalMeetingSecondsToday = parseInt(meetingTimerResult[0].total) + parseInt(activeMeetingTimerResult[0]?.elapsed || 0);

    console.log('DEBUG CLOCK WIDGET:', {
      userId,
      taskSeconds: totalTaskSecondsToday,
      ticketMinutes: ticketTimerResult[0].total,
      meetingSeconds: totalMeetingSecondsToday,
      totalProductive: totalTaskSecondsToday + (ticketTimerResult[0].total * 60) + totalMeetingSecondsToday
    });

    // Get today's schedule info (full/half/holiday)
    const today = new Date().toISOString().split('T')[0];
    const todaySchedule = await getExpectedHoursForDate(today);

    // Check if this user has no attendance records yet (first-ever day) or is_rejoining
    const [priorCount] = await db.query(
      'SELECT COUNT(*) AS cnt FROM attendance WHERE user_id = ?',
      [userId]
    );
    const [userFlagRows] = await db.query(
      'SELECT is_rejoining FROM users WHERE id = ?',
      [userId]
    );
    const isFirstDay = priorCount[0].cnt === 0 || userFlagRows[0]?.is_rejoining === 1;

    return res.json({
      attendance: attendance[0] || null,
      plans,
      active_afs: activeAfs[0] || null,
      total_task_seconds: parseInt(totalTaskSecondsToday) || 0,
      total_ticket_seconds: (parseInt(ticketTimerResult[0].total) || 0) * 60,
      total_meeting_seconds: totalMeetingSecondsToday,
      today_schedule: todaySchedule,
      is_first_day: isFirstDay,
    });
  } catch (err) {
    console.error('Get today error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.getMyWeek = async (req, res) => {
  try {
    const userId = req.user.id;

    const [weekRange] = await db.query(
      `SELECT DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY) AS week_start,
              DATE_ADD(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY), INTERVAL 6 DAY) AS week_end`
    );
    const { week_start, week_end } = weekRange[0];

    // Only calculate up to today (not future days)
    const today = new Date();
    const endDateObj = new Date(Math.min(today, new Date(week_end)));
    const endDate = endDateObj.toISOString().split('T')[0];

    // Use the new schedule-aware calculation
    const { totalExpected, dailyBreakdown } = await getExpectedHoursForRange(week_start, endDate, userId);

    console.log('DEBUG WEEKLY TRACKER:', { week_start, endDate, totalExpected, days: dailyBreakdown.length, breakdown: dailyBreakdown });

    const [records] = await db.query(
      'SELECT * FROM attendance WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date',
      [userId, week_start, week_end]
    );

    // Calculate completed hours (productive time = task + ticket + meeting)
    const [taskTimeResult] = await db.query(
      `SELECT COALESCE(SUM(duration), 0) AS total FROM task_time_logs 
       WHERE user_id = ? AND DATE(started_at) BETWEEN ? AND ? AND ended_at IS NOT NULL AND duration > 0`,
      [userId, week_start, endDate]
    );
    const [ticketTimeResult] = await db.query(
      `SELECT COALESCE(SUM(minutes), 0) AS total FROM ticket_time_logs 
       WHERE user_id = ? AND DATE(created_at) BETWEEN ? AND ?`,
      [userId, week_start, endDate]
    );
    const [meetingTimeResult] = await db.query(
      `SELECT COALESCE(SUM(duration), 0) AS total 
       FROM meeting_time_logs
       WHERE user_id = ? AND DATE(started_at) BETWEEN ? AND ?
       AND ended_at IS NOT NULL AND duration > 0`,
      [userId, week_start, endDate]
    );

    const taskHours = (parseInt(taskTimeResult[0].total) || 0) / 3600;
    const ticketHours = (parseInt(ticketTimeResult[0].total) || 0) / 60;
    const meetingHours = (parseInt(meetingTimeResult[0].total) || 0) / 3600;
    const completed = taskHours + ticketHours + meetingHours;

    const required = totalExpected * 60; // Convert hours to minutes for frontend
    const completedMinutes = completed * 60;
    const remaining = Math.max(0, required - completedMinutes);
    const deficit = Math.max(0, required - completedMinutes);
    const surplus = completedMinutes > required ? completedMinutes - required : 0;

    const daily_breakdown = records.map(r => ({
      date: r.date,
      clock_in: r.clock_in,
      clock_out: r.clock_out,
      clock_in_status: r.clock_in_status,
      served_hours: (parseInt(r.total_served_seconds) || 0) / 3600
    }));

    return res.json({
      week_start, week_end,
      required: parseFloat(required.toFixed(2)),
      completed: parseFloat(completedMinutes.toFixed(2)),
      remaining: parseFloat(remaining.toFixed(2)),
      deficit: parseFloat(deficit.toFixed(2)),
      surplus: parseFloat(surplus.toFixed(2)),
      daily_breakdown,
      schedule_breakdown: dailyBreakdown
    });
  } catch (err) {
    console.error('Get my week error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.getMyMonth = async (req, res) => {
  try {
    const userId = req.user.id;

    const [records] = await db.query(
      `SELECT clock_in_status, COUNT(*) AS count FROM attendance
       WHERE user_id = ? AND MONTH(date) = MONTH(CURDATE()) AND YEAR(date) = YEAR(CURDATE())
       GROUP BY clock_in_status`,
      [userId]
    );

    const [leaveResult] = await db.query(
      `SELECT COALESCE(SUM(days), 0) AS leave_days FROM leaves
       WHERE user_id = ? AND status = 'approved' AND deleted = 0
       AND MONTH(from_date) = MONTH(CURDATE()) AND YEAR(from_date) = YEAR(CURDATE())`,
      [userId]
    );

    // Use schedule-aware working days calculation
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const startDate = monthStart.toISOString().split('T')[0];
    const endDate = now.toISOString().split('T')[0];

    const { dailyBreakdown } = await getExpectedHoursForRange(startDate, endDate, userId);
    // Count working days = days where expected_hours > 0
    const totalWorkingDays = dailyBreakdown.filter(d => d.expected_hours > 0).length;

    const statusCounts = { on_time: 0, grace: 0, late: 0 };
    for (const row of records) {
      if (statusCounts.hasOwnProperty(row.clock_in_status)) statusCounts[row.clock_in_status] = row.count;
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
    console.error('Get my month error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/attendance/history?user_id=X&month=YYYY-MM
 * Returns attendance records with daily plans for a given month.
 * Employees can only view their own data. Admins can view any employee.
 */
exports.getHistory = async (req, res) => {
  try {
    const requestingUserId = req.user.id;
    const isAdmin = req.user.is_admin;
    let { user_id, month } = req.query;

    // Non-admins can only see their own records
    if (!isAdmin || !user_id) {
      user_id = requestingUserId;
    }

    // Parse month (YYYY-MM)
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      const now = new Date();
      month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    const [year, mon] = month.split('-');
    const startDate = `${year}-${mon}-01`;
    // Last day of month
    const lastDay = new Date(parseInt(year), parseInt(mon), 0).getDate();
    const endDate = `${year}-${mon}-${String(lastDay).padStart(2, '0')}`;

    // If admin requests all employees
    if (isAdmin && user_id === 'all') {
      const [users] = await db.query(
        'SELECT id, first_name, last_name, department, avatar_url FROM users WHERE is_active = 1 AND deleted = 0 ORDER BY first_name'
      );

      const [allRecords] = await db.query(
        `SELECT * FROM attendance WHERE date BETWEEN ? AND ? ORDER BY date DESC`,
        [startDate, endDate]
      );

      const [allPlans] = await db.query(
        `SELECT * FROM daily_plans WHERE date BETWEEN ? AND ? ORDER BY sort_order`,
        [startDate, endDate]
      );

      // Productive time queries for all users
      const [taskTimeLogs] = await db.query(
        `SELECT user_id, DATE(started_at) AS log_date, COALESCE(SUM(duration), 0) AS total_seconds
         FROM task_time_logs WHERE DATE(started_at) BETWEEN ? AND ? AND ended_at IS NOT NULL AND duration > 0
         GROUP BY user_id, DATE(started_at)`,
        [startDate, endDate]
      );
      const [ticketTimeLogs] = await db.query(
        `SELECT user_id, DATE(created_at) AS log_date, COALESCE(SUM(minutes), 0) AS total_minutes
         FROM ticket_time_logs WHERE DATE(created_at) BETWEEN ? AND ?
         GROUP BY user_id, DATE(created_at)`,
        [startDate, endDate]
      );
      const [meetingTimeLogs] = await db.query(
        `SELECT COALESCE(mm.user_id, m.created_by) AS user_id, m.meeting_date AS log_date, COALESCE(SUM(TIMESTAMPDIFF(SECOND, m.start_time, m.end_time)), 0) AS total_seconds
         FROM meetings m
         LEFT JOIN meeting_members mm ON mm.meeting_id = m.id
         WHERE m.status = 'completed' AND m.deleted = 0 AND m.meeting_date BETWEEN ? AND ?
         GROUP BY COALESCE(mm.user_id, m.created_by), m.meeting_date`,
        [startDate, endDate]
      );

      // Build productive lookup: { 'userId_date': seconds }
      const productiveLookup = {};
      for (const row of taskTimeLogs) {
        const d = row.log_date instanceof Date ? row.log_date.toISOString().split('T')[0] : String(row.log_date).split('T')[0];
        const key = `${row.user_id}_${d}`;
        productiveLookup[key] = (productiveLookup[key] || 0) + (parseInt(row.total_seconds) || 0);
      }
      for (const row of ticketTimeLogs) {
        const d = row.log_date instanceof Date ? row.log_date.toISOString().split('T')[0] : String(row.log_date).split('T')[0];
        const key = `${row.user_id}_${d}`;
        productiveLookup[key] = (productiveLookup[key] || 0) + ((parseInt(row.total_minutes) || 0) * 60);
      }
      for (const row of meetingTimeLogs) {
        const d = row.log_date instanceof Date ? row.log_date.toISOString().split('T')[0] : String(row.log_date).split('T')[0];
        const key = `${row.user_id}_${d}`;
        productiveLookup[key] = (productiveLookup[key] || 0) + (parseInt(row.total_seconds) || 0);
      }

      // Group plans by attendance_id
      const plansByAttendance = {};
      for (const plan of allPlans) {
        if (!plansByAttendance[plan.attendance_id]) plansByAttendance[plan.attendance_id] = [];
        plansByAttendance[plan.attendance_id].push(plan);
      }

      // Group records by user
      const userMap = {};
      for (const u of users) {
        userMap[u.id] = { id: u.id, name: `${u.first_name} ${u.last_name}`, department: u.department, avatar_url: u.avatar_url || null, records: [] };
      }
      for (const record of allRecords) {
        if (!userMap[record.user_id]) continue;
        const dateStr = record.date instanceof Date ? record.date.toISOString().split('T')[0] : String(record.date).split('T')[0];
        const key = `${record.user_id}_${dateStr}`;
        userMap[record.user_id].records.push({
          ...record,
          plans: plansByAttendance[record.id] || [],
          productive_seconds: productiveLookup[key] || 0
        });
      }

      // Only include users who have records
      const allEmployees = Object.values(userMap).filter(u => u.records.length > 0);

      return res.json({ mode: 'all', employees: allEmployees });
    }

    // Fetch attendance records
    const [records] = await db.query(
      `SELECT * FROM attendance WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date DESC`,
      [user_id, startDate, endDate]
    );

    // Fetch all plans for this user and month in one query
    const [allPlans] = await db.query(
      `SELECT * FROM daily_plans WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY sort_order`,
      [user_id, startDate, endDate]
    );

    // Fetch productive time per day (tasks)
    const [taskTimeLogs] = await db.query(
      `SELECT DATE(started_at) AS log_date, COALESCE(SUM(duration), 0) AS total_seconds
       FROM task_time_logs WHERE user_id = ? AND DATE(started_at) BETWEEN ? AND ? AND ended_at IS NOT NULL AND duration > 0
       GROUP BY DATE(started_at)`,
      [user_id, startDate, endDate]
    );

    // Fetch productive time per day (tickets — stored in minutes)
    const [ticketTimeLogs] = await db.query(
      `SELECT DATE(created_at) AS log_date, COALESCE(SUM(minutes), 0) AS total_minutes
       FROM ticket_time_logs WHERE user_id = ? AND DATE(created_at) BETWEEN ? AND ?
       GROUP BY DATE(created_at)`,
      [user_id, startDate, endDate]
    );

    // Fetch productive time per day (meetings — calculate from start/end)
    const [meetingTimeLogs] = await db.query(
      `SELECT m.meeting_date AS log_date, COALESCE(SUM(TIMESTAMPDIFF(SECOND, m.start_time, m.end_time)), 0) AS total_seconds
       FROM meetings m
       LEFT JOIN meeting_members mm ON mm.meeting_id = m.id
       WHERE (m.created_by = ? OR mm.user_id = ?)
       AND m.status = 'completed' AND m.deleted = 0
       AND m.meeting_date BETWEEN ? AND ?
       GROUP BY m.meeting_date`,
      [user_id, user_id, startDate, endDate]
    );

    // Build lookup maps for productive time by date
    const taskByDate = {};
    for (const row of taskTimeLogs) {
      const d = row.log_date instanceof Date ? row.log_date.toISOString().split('T')[0] : String(row.log_date).split('T')[0];
      taskByDate[d] = parseInt(row.total_seconds) || 0;
    }
    const ticketByDate = {};
    for (const row of ticketTimeLogs) {
      const d = row.log_date instanceof Date ? row.log_date.toISOString().split('T')[0] : String(row.log_date).split('T')[0];
      ticketByDate[d] = (parseInt(row.total_minutes) || 0) * 60; // convert to seconds
    }
    const meetingByDate = {};
    for (const row of meetingTimeLogs) {
      const d = row.log_date instanceof Date ? row.log_date.toISOString().split('T')[0] : String(row.log_date).split('T')[0];
      meetingByDate[d] = parseInt(row.total_seconds) || 0;
    }

    // Group plans by attendance_id
    const plansByAttendance = {};
    for (const plan of allPlans) {
      if (!plansByAttendance[plan.attendance_id]) {
        plansByAttendance[plan.attendance_id] = [];
      }
      plansByAttendance[plan.attendance_id].push(plan);
    }

    // Attach plans and productive time to each record
    const enrichedRecords = records.map(record => {
      const dateStr = record.date instanceof Date ? record.date.toISOString().split('T')[0] : String(record.date).split('T')[0];
      const productiveSeconds = (taskByDate[dateStr] || 0) + (ticketByDate[dateStr] || 0) + (meetingByDate[dateStr] || 0);
      return {
        ...record,
        plans: plansByAttendance[record.id] || [],
        productive_seconds: productiveSeconds
      };
    });

    return res.json({ records: enrichedRecords });
  } catch (err) {
    console.error('Get attendance history error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.afsStart = async (req, res) => {
  try {
    const userId = req.user.id;

    const [attendance] = await db.query(
      'SELECT * FROM attendance WHERE user_id = ? AND date = CURDATE() AND clock_out IS NULL',
      [userId]
    );
    if (!attendance.length) {
      return res.status(400).json({ message: 'Must be clocked in to start AFS' });
    }
    const attendanceId = attendance[0].id;

    const [activeAfs] = await db.query(
      'SELECT id FROM afs_logs WHERE user_id = ? AND end_time IS NULL',
      [userId]
    );
    if (activeAfs.length) {
      return res.status(400).json({ message: 'An AFS session is already active' });
    }

    // ── Pause the user's active task timer (freeze, don't save log) ──────
    let pausedTask = null;
    const [activeTimer] = await db.query(
      `SELECT tat.task_id, tat.started_at, t.title
       FROM task_active_timers tat
       JOIN tasks t ON t.id = tat.task_id
       WHERE tat.user_id = ?`,
      [userId]
    );

    if (activeTimer.length > 0) {
      const timer = activeTimer[0];
      pausedTask = { task_id: timer.task_id, task_title: timer.title };
    } else {
      // Fallback: check legacy timer_started_at
      const [runningTasks] = await db.query(
        'SELECT id, title, timer_started_at FROM tasks WHERE assigned_to = ? AND timer_started_at IS NOT NULL AND deleted = 0',
        [userId]
      );
      if (runningTasks.length) {
        pausedTask = { task_id: runningTasks[0].id, task_title: runningTasks[0].title };
      }
    }

    // ── Pause the user's active ticket timer ─────────────────────────────
    let pausedTicket = null;
    const [activeTicketTimer] = await db.query(
      `SELECT tat.ticket_id, tat.started_at, t.title
       FROM ticket_active_timers tat
       JOIN tickets t ON t.id = tat.ticket_id
       WHERE tat.user_id = ?`,
      [userId]
    );

    if (activeTicketTimer.length > 0) {
      const timer = activeTicketTimer[0];
      pausedTicket = { ticket_id: timer.ticket_id, ticket_title: timer.title };
    }

    // ── Pause the user's active meeting timer ────────────────────────────
    let pausedMeeting = null;
    const [activeMeetingTimer] = await db.query(
      `SELECT mat.meeting_id, mat.started_at, m.title
       FROM meeting_active_timers mat
       JOIN meetings m ON m.id = mat.meeting_id
       WHERE mat.user_id = ?`,
      [userId]
    );

    if (activeMeetingTimer.length > 0) {
      const timer = activeMeetingTimer[0];
      pausedMeeting = { meeting_id: timer.meeting_id, meeting_title: timer.title };
    }

    const [result] = await db.query(
      'INSERT INTO afs_logs (user_id, attendance_id, start_time, paused_task_id, paused_ticket_id, paused_meeting_id) VALUES (?, ?, NOW(), ?, ?, ?)',
      [userId, attendanceId, pausedTask?.task_id || null, pausedTicket?.ticket_id || null, pausedMeeting?.meeting_id || null]
    );

    const [afsLog] = await db.query('SELECT * FROM afs_logs WHERE id = ?', [result.insertId]);

    return res.status(201).json({ afs_log: afsLog[0], paused_task: pausedTask, paused_ticket: pausedTicket, paused_meeting: pausedMeeting });
  } catch (err) {
    console.error('AFS start error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.afsEnd = async (req, res) => {
  try {
    const userId = req.user.id;

    const [activeAfs] = await db.query(
      'SELECT * FROM afs_logs WHERE user_id = ? AND end_time IS NULL ORDER BY start_time DESC LIMIT 1',
      [userId]
    );
    if (!activeAfs.length) {
      return res.status(400).json({ message: 'No active AFS session found' });
    }

    const afsLog = activeAfs[0];

    await db.query(
      'UPDATE afs_logs SET end_time = NOW(), duration_seconds = TIMESTAMPDIFF(SECOND, start_time, NOW()) WHERE id = ?',
      [afsLog.id]
    );

    const [updatedAfs] = await db.query('SELECT * FROM afs_logs WHERE id = ?', [afsLog.id]);
    const duration_seconds = updatedAfs[0].duration_seconds;

    await db.query(
      'UPDATE attendance SET total_afs_seconds = total_afs_seconds + ? WHERE id = ?',
      [duration_seconds, afsLog.attendance_id]
    );

    // ── Auto-resume the paused task timer (shift started_at forward by AFS duration) ──
    let resumedTask = null;
    if (afsLog.paused_task_id) {
      // Check the task is still active
      const [taskCheck] = await db.query(
        'SELECT id, title, is_active FROM tasks WHERE id = ? AND deleted = 0 AND is_active = 1',
        [afsLog.paused_task_id]
      );

      if (taskCheck.length > 0) {
        // Check if the user's timer is still in task_active_timers (it should be — we didn't remove it on AFS start)
        const [existingTimer] = await db.query(
          'SELECT * FROM task_active_timers WHERE task_id = ? AND user_id = ?',
          [afsLog.paused_task_id, userId]
        );

        if (existingTimer.length > 0) {
          // Shift started_at forward by AFS duration so elapsed time skips the break
          await db.query(
            'UPDATE task_active_timers SET started_at = DATE_ADD(started_at, INTERVAL ? SECOND) WHERE task_id = ? AND user_id = ?',
            [duration_seconds, afsLog.paused_task_id, userId]
          );
        } else {
          // Timer was removed (shouldn't happen, but handle gracefully) — restart it
          const now = new Date();
          await db.query(
            'INSERT IGNORE INTO task_active_timers (task_id, user_id, started_at) VALUES (?, ?, ?)',
            [afsLog.paused_task_id, userId, now]
          );
          await db.query(
            'UPDATE tasks SET timer_started_at = ? WHERE id = ? AND timer_started_at IS NULL',
            [now, afsLog.paused_task_id]
          );
        }

        resumedTask = { task_id: taskCheck[0].id, task_title: taskCheck[0].title };
      }
    }

    // ── Auto-resume the paused ticket timer (shift started_at forward by AFS duration) ──
    let resumedTicket = null;
    if (afsLog.paused_ticket_id) {
      const [ticketCheck] = await db.query(
        'SELECT id, title, status FROM tickets WHERE id = ? AND deleted = 0 AND status NOT IN ("resolved","closed")',
        [afsLog.paused_ticket_id]
      );

      if (ticketCheck.length > 0) {
        const [existingTimer] = await db.query(
          'SELECT * FROM ticket_active_timers WHERE ticket_id = ? AND user_id = ?',
          [afsLog.paused_ticket_id, userId]
        );

        if (existingTimer.length > 0) {
          // Shift started_at forward by AFS duration so elapsed time skips the break
          await db.query(
            'UPDATE ticket_active_timers SET started_at = DATE_ADD(started_at, INTERVAL ? SECOND) WHERE ticket_id = ? AND user_id = ?',
            [duration_seconds, afsLog.paused_ticket_id, userId]
          );
        } else {
          // Timer was removed — restart it
          const now = new Date();
          await db.query(
            'INSERT IGNORE INTO ticket_active_timers (ticket_id, user_id, started_at) VALUES (?, ?, ?)',
            [afsLog.paused_ticket_id, userId, now]
          );
          await db.query(
            'UPDATE tickets SET timer_started_at = ? WHERE id = ? AND timer_started_at IS NULL',
            [now, afsLog.paused_ticket_id]
          );
        }

        resumedTicket = { ticket_id: ticketCheck[0].id, ticket_title: ticketCheck[0].title };
      }
    }

    // ── Auto-resume the paused meeting timer (shift started_at forward by AFS duration) ──
    let resumedMeeting = null;
    if (afsLog.paused_meeting_id) {
      const [meetingCheck] = await db.query(
        'SELECT id, title, status FROM meetings WHERE id = ? AND deleted = 0 AND status NOT IN ("completed","cancelled")',
        [afsLog.paused_meeting_id]
      );

      if (meetingCheck.length > 0) {
        const [existingTimer] = await db.query(
          'SELECT * FROM meeting_active_timers WHERE meeting_id = ? AND user_id = ?',
          [afsLog.paused_meeting_id, userId]
        );

        if (existingTimer.length > 0) {
          // Shift started_at forward by AFS duration so elapsed time skips the break
          await db.query(
            'UPDATE meeting_active_timers SET started_at = DATE_ADD(started_at, INTERVAL ? SECOND) WHERE meeting_id = ? AND user_id = ?',
            [duration_seconds, afsLog.paused_meeting_id, userId]
          );
        } else {
          // Timer was removed — restart it
          const now = new Date();
          await db.query(
            'INSERT IGNORE INTO meeting_active_timers (meeting_id, user_id, started_at) VALUES (?, ?, ?)',
            [afsLog.paused_meeting_id, userId, now]
          );
          await db.query(
            'UPDATE meetings SET timer_started_at = ? WHERE id = ? AND timer_started_at IS NULL',
            [now, afsLog.paused_meeting_id]
          );
        }

        resumedMeeting = { meeting_id: meetingCheck[0].id, meeting_title: meetingCheck[0].title };
      }
    }

    return res.json({ afs_log: updatedAfs[0], resumed_task: resumedTask, resumed_ticket: resumedTicket, resumed_meeting: resumedMeeting });
  } catch (err) {
    console.error('AFS end error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.adminGetToday = async (req, res) => {
  try {
    const [users] = await db.query(
      `SELECT u.id, u.first_name, u.last_name, u.department, u.designation,
              a.id AS attendance_id, a.clock_in, a.clock_out, a.clock_in_status, a.total_served_seconds, a.total_afs_seconds,
              l.id AS leave_id, l.leave_type,
              t.id AS current_task_id, t.title AS current_task_title,
              afs.id AS active_afs_id, afs.start_time AS afs_start_time
       FROM users u
       LEFT JOIN attendance a ON a.user_id = u.id AND a.date = CURDATE()
       LEFT JOIN leaves l ON l.user_id = u.id AND l.status = 'approved' AND l.deleted = 0
         AND CURDATE() BETWEEN l.from_date AND l.to_date
       LEFT JOIN tasks t ON t.assigned_to = u.id AND t.timer_started_at IS NOT NULL AND t.deleted = 0
       LEFT JOIN afs_logs afs ON afs.user_id = u.id AND afs.end_time IS NULL
       WHERE u.is_active = 1 AND u.deleted = 0 AND u.is_admin = 0
       ORDER BY u.first_name`
    );

    const team = users.map(u => ({
      id: u.id,
      name: u.first_name + ' ' + u.last_name,
      department: u.department,
      designation: u.designation,
      clocked_in: !!u.attendance_id,
      clock_in: u.clock_in,
      clock_out: u.clock_out,
      clock_in_status: u.clock_in_status,
      total_served_seconds: u.total_served_seconds,
      on_leave: !!u.leave_id,
      leave_type: u.leave_type,
      current_task: u.current_task_id ? { id: u.current_task_id, title: u.current_task_title } : null,
      afs_active: !!u.active_afs_id,
      afs_start_time: u.afs_start_time
    }));

    return res.json(team);
  } catch (err) {
    console.error('Admin get today error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.adminWeekReport = async (req, res) => {
  try {
    const [weekRange] = await db.query(
      `SELECT DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY) AS week_start,
              DATE_ADD(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY), INTERVAL 6 DAY) AS week_end`
    );
    const { week_start, week_end } = weekRange[0];

    const [users] = await db.query(
      'SELECT id, first_name, last_name, department FROM users WHERE is_active = 1 AND deleted = 0 AND is_admin = 0'
    );

    // Only calculate up to today
    const today = new Date();
    const endDateObj = new Date(Math.min(today, new Date(week_end)));
    const endDate = endDateObj.toISOString().split('T')[0];

    const report = [];

    for (const user of users) {
      // Use schedule-aware calculation with leave deduction
      const { totalExpected } = await getExpectedHoursForRange(week_start, endDate, user.id);

      // Calculate productive hours (tasks + tickets + meetings)
      const [taskTimeResult] = await db.query(
        `SELECT COALESCE(SUM(duration), 0) AS total FROM task_time_logs 
         WHERE user_id = ? AND DATE(started_at) BETWEEN ? AND ? AND ended_at IS NOT NULL AND duration > 0`,
        [user.id, week_start, endDate]
      );
      const [ticketTimeResult] = await db.query(
        `SELECT COALESCE(SUM(minutes), 0) AS total FROM ticket_time_logs 
         WHERE user_id = ? AND DATE(created_at) BETWEEN ? AND ?`,
        [user.id, week_start, endDate]
      );
      const [meetingTimeResult] = await db.query(
        `SELECT COALESCE(SUM(duration), 0) AS total 
         FROM meeting_time_logs
         WHERE user_id = ? AND DATE(started_at) BETWEEN ? AND ?
         AND ended_at IS NOT NULL AND duration > 0`,
        [user.id, week_start, endDate]
      );

      const taskHours = taskTimeResult[0].total / 3600;
      const ticketHours = ticketTimeResult[0].total / 60;
      const meetingHours = meetingTimeResult[0].total / 3600;
      const completed = taskHours + ticketHours + meetingHours;

      const deficit = Math.max(0, totalExpected - completed);
      const surplus = completed > totalExpected ? completed - totalExpected : 0;

      report.push({
        user_id: user.id,
        name: user.first_name + ' ' + user.last_name,
        department: user.department,
        required: parseFloat(totalExpected.toFixed(2)),
        completed: parseFloat(completed.toFixed(2)),
        deficit: parseFloat(deficit.toFixed(2)),
        surplus: parseFloat(surplus.toFixed(2)),
        task_hours: parseFloat(taskHours.toFixed(2)),
        ticket_hours: parseFloat(ticketHours.toFixed(2)),
        meeting_hours: parseFloat(meetingHours.toFixed(2))
      });
    }

    report.sort((a, b) => b.deficit - a.deficit);

    return res.json({ week_start, week_end, report });
  } catch (err) {
    console.error('Admin week report error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.adminGetPlans = async (req, res) => {
  try {
    const { userId, date } = req.params;

    const [attendance] = await db.query(
      'SELECT * FROM attendance WHERE user_id = ? AND date = ?',
      [userId, date]
    );

    const [plans] = await db.query(
      'SELECT * FROM daily_plans WHERE user_id = ? AND date = ? ORDER BY sort_order',
      [userId, date]
    );

    return res.json({ attendance: attendance[0] || null, plans });
  } catch (err) {
    console.error('Admin get plans error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.getSettings = async (req, res) => {
  try {
    const [settings] = await db.query('SELECT * FROM attendance_settings WHERE id = 1');
    return res.json(settings[0] || {});
  } catch (err) {
    console.error('Get settings error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const { shift_start_time, grace_period_minutes, work_hours_per_day, lunch_duration_minutes, required_productive_hours, week_start_day, auto_clock_out_enabled } = req.body;

    const fields = [];
    const params = [];

    if (shift_start_time !== undefined) { fields.push('shift_start_time = ?'); params.push(shift_start_time); }
    if (grace_period_minutes !== undefined) { fields.push('grace_period_minutes = ?'); params.push(grace_period_minutes); }
    if (work_hours_per_day !== undefined) { fields.push('work_hours_per_day = ?'); params.push(work_hours_per_day); }
    if (lunch_duration_minutes !== undefined) { fields.push('lunch_duration_minutes = ?'); params.push(lunch_duration_minutes); }
    if (required_productive_hours !== undefined) { fields.push('required_productive_hours = ?'); params.push(required_productive_hours); }
    if (week_start_day !== undefined) { fields.push('week_start_day = ?'); params.push(week_start_day); }
    if (auto_clock_out_enabled !== undefined) { fields.push('auto_clock_out_enabled = ?'); params.push(auto_clock_out_enabled); }

    if (!fields.length) return res.status(400).json({ message: 'No fields to update' });

    await db.query(`UPDATE attendance_settings SET ${fields.join(', ')} WHERE id = 1`, params);

    const [settings] = await db.query('SELECT * FROM attendance_settings WHERE id = 1');
    return res.json(settings[0]);
  } catch (err) {
    console.error('Update settings error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/attendance/check-running-timers
 * Check if user has any running timers before clock-out
 */
exports.checkRunningTimers = async (req, res) => {
  try {
    const userId = req.user.id;

    // Check active task timers
    const [taskTimers] = await db.query(
      `SELECT tat.id, tat.task_id, tat.started_at, t.title AS task_title
       FROM task_active_timers tat
       JOIN tasks t ON t.id = tat.task_id
       WHERE tat.user_id = ?`,
      [userId]
    );

    // Check active ticket timers
    const [ticketTimers] = await db.query(
      `SELECT tt.id, tt.ticket_id, tt.started_at, tk.title AS ticket_title
       FROM ticket_active_timers tt
       JOIN tickets tk ON tk.id = tt.ticket_id
       WHERE tt.user_id = ?`,
      [userId]
    );

    // Check active AFS
    const [activeAfs] = await db.query(
      `SELECT id, start_time FROM afs_logs WHERE user_id = ? AND end_time IS NULL AND DATE(start_time) = CURDATE()`,
      [userId]
    );

    const hasRunningTimers = taskTimers.length > 0 || ticketTimers.length > 0;
    const hasActiveAfs = activeAfs.length > 0;

    return res.json({
      has_running_timers: hasRunningTimers,
      has_active_afs: hasActiveAfs,
      task_timers: taskTimers,
      ticket_timers: ticketTimers,
      active_afs: activeAfs[0] || null
    });
  } catch (err) {
    console.error('Check running timers error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/attendance/force-clock-out
 * Stop all timers and clock out
 */
exports.forceClockOut = async (req, res) => {
  try {
    const userId = req.user.id;
    const { plans, additional } = req.body;
    const now = new Date();

    // 1. Stop all active task timers
    const [taskTimers] = await db.query(
      'SELECT id, task_id, started_at FROM task_active_timers WHERE user_id = ?',
      [userId]
    );

    for (const timer of taskTimers) {
      const duration = Math.max(1, Math.floor((now - new Date(timer.started_at)) / 1000));
      await db.query(
        `INSERT INTO task_time_logs (task_id, user_id, started_at, ended_at, duration, note)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [timer.task_id, userId, timer.started_at, now, duration, 'Auto-stopped on clock out']
      );
      await db.query('UPDATE tasks SET time_spent = time_spent + ?, timer_started_at = NULL WHERE id = ?', [duration, timer.task_id]);
      await db.query('DELETE FROM task_active_timers WHERE id = ?', [timer.id]);
    }

    // 2. Stop active ticket timers
    const [ticketTimers] = await db.query(
      'SELECT id, ticket_id, started_at FROM ticket_active_timers WHERE user_id = ?',
      [userId]
    );

    for (const timer of ticketTimers) {
      const duration = Math.max(1, Math.floor((now - new Date(timer.started_at)) / 1000));
      const minutes = Math.ceil(duration / 60);
      await db.query(
        `INSERT INTO ticket_time_logs (ticket_id, user_id, minutes, note, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [timer.ticket_id, userId, minutes, 'Auto-stopped on clock out', now]
      );
      await db.query('DELETE FROM ticket_active_timers WHERE id = ?', [timer.id]);
    }

    // 3. End active AFS
    const [activeAfs] = await db.query(
      'SELECT id, start_time FROM afs_logs WHERE user_id = ? AND end_time IS NULL AND DATE(start_time) = CURDATE()',
      [userId]
    );
    for (const afs of activeAfs) {
      const afsDuration = Math.floor((now - new Date(afs.start_time)) / 1000);
      await db.query('UPDATE afs_logs SET end_time = ?, duration_seconds = ? WHERE id = ?', [now, afsDuration, afs.id]);
    }

    // 4. Now do the normal clock-out
    const [records] = await db.query(
      'SELECT * FROM attendance WHERE user_id = ? AND date = CURDATE() AND clock_out IS NULL',
      [userId]
    );
    if (!records.length) {
      return res.status(400).json({ message: 'No active clock-in found' });
    }

    const attendanceId = records[0].id;
    const [servedResult] = await db.query(
      'SELECT TIMESTAMPDIFF(SECOND, clock_in, NOW()) AS total_served FROM attendance WHERE id = ?',
      [attendanceId]
    );
    const [afsResult] = await db.query(
      'SELECT COALESCE(SUM(duration_seconds), 0) AS total_afs FROM afs_logs WHERE attendance_id = ?',
      [attendanceId]
    );

    await db.query(
      'UPDATE attendance SET clock_out = NOW(), total_served_seconds = ?, total_afs_seconds = ? WHERE id = ?',
      [servedResult[0].total_served, afsResult[0].total_afs, attendanceId]
    );

    // Update plans if provided
    if (plans && plans.length) {
      for (const plan of plans) {
        await db.query('UPDATE daily_plans SET status = ? WHERE id = ? AND user_id = ?', [plan.status, plan.id, userId]);
      }
    }
    if (additional && additional.length) {
      for (const item of additional) {
        if (item.point_text && item.point_text.trim()) {
          await db.query(
            'INSERT INTO daily_plans (user_id, attendance_id, point_text, status, is_additional) VALUES (?, ?, ?, ?, 1)',
            [userId, attendanceId, item.point_text.trim(), item.status || 'completed']
          );
        }
      }
    }

    return res.json({
      message: 'All timers stopped and clocked out successfully',
      stopped_tasks: taskTimers.length,
      stopped_tickets: ticketTimers.length
    });
  } catch (err) {
    console.error('Force clock out error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/attendance/check-auto-clockout
 * Check if yesterday had an auto clock-out (for next-day prompt)
 */
exports.checkAutoClockOut = async (req, res) => {
  try {
    const userId = req.user.id;

    const [records] = await db.query(
      `SELECT id, date, clock_in, clock_out, auto_clock_out, corrected_clock_out
       FROM attendance
       WHERE user_id = ? AND auto_clock_out = 1 AND corrected_clock_out IS NULL
       AND date >= DATE_SUB(CURDATE(), INTERVAL 3 DAY)
       ORDER BY date DESC LIMIT 1`,
      [userId]
    );

    if (records.length === 0) {
      return res.json({ needs_correction: false });
    }

    const record = records[0];
    return res.json({
      needs_correction: true,
      attendance_id: record.id,
      date: record.date,
      clock_in: record.clock_in,
      clock_out: record.clock_out
    });
  } catch (err) {
    console.error('Check auto clock-out error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/attendance/correct-clockout
 * User submits their actual clock-out time after auto clock-out
 */
exports.correctClockOut = async (req, res) => {
  try {
    const userId = req.user.id;
    const { attendance_id, actual_clock_out_time } = req.body;

    if (!attendance_id || !actual_clock_out_time) {
      return res.status(400).json({ message: 'attendance_id and actual_clock_out_time are required' });
    }

    // Verify the record belongs to this user and was auto-clocked-out
    const [records] = await db.query(
      'SELECT * FROM attendance WHERE id = ? AND user_id = ? AND auto_clock_out = 1',
      [attendance_id, userId]
    );

    if (records.length === 0) {
      return res.status(404).json({ message: 'Record not found or not eligible for correction' });
    }

    const record = records[0];

    // Build the corrected clock-out datetime (same date as attendance, user-provided time in IST)
    const attendanceDate = new Date(record.date).toISOString().split('T')[0];
    const correctedDateTime = new Date(`${attendanceDate}T${actual_clock_out_time}:00+05:30`);

    // Validate: corrected time must be after clock-in
    const clockInTime = new Date(record.clock_in.includes('Z') || record.clock_in.includes('+')
      ? record.clock_in
      : record.clock_in.replace(' ', 'T') + 'Z');
    if (correctedDateTime <= clockInTime) {
      return res.status(400).json({ message: 'Corrected time must be after clock-in time' });
    }

    // Recalculate served seconds
    const newServedSeconds = Math.floor((correctedDateTime - clockInTime) / 1000);

    await db.query(
      `UPDATE attendance 
       SET corrected_clock_out = ?, clock_out = ?, total_served_seconds = ?, correction_submitted_at = NOW()
       WHERE id = ?`,
      [correctedDateTime, correctedDateTime, newServedSeconds, attendance_id]
    );

    return res.json({ message: 'Clock-out time corrected successfully', new_served_seconds: newServedSeconds });
  } catch (err) {
    console.error('Correct clock-out error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/attendance/pending-resolution
 * Returns unresolved past-day attendance + orphaned timers for the logged-in user
 */
exports.getPendingResolution = async (req, res) => {
  try {
    const userId = req.user.id;
    const pending = await getPendingResolutionData(userId);
    return res.json(pending);
  } catch (err) {
    console.error('Get pending resolution error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/attendance/admin/pending-resolution/:userId
 * Admin: Returns unresolved past-day attendance + orphaned timers for any user
 */
exports.adminGetPendingResolution = async (req, res) => {
  try {
    const userId = req.params.userId;
    const pending = await getPendingResolutionData(userId);
    return res.json(pending);
  } catch (err) {
    console.error('Admin get pending resolution error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/attendance/resolve-pending
 * User resolves their own pending past-day issues
 * Body: { attendance_id, clock_out_time, timers: [{ type, timer_id, stop_time }] }
 */
exports.resolvePending = async (req, res) => {
  try {
    const userId = req.user.id;
    const { attendance_id, clock_out_time, timers } = req.body;

    if (!attendance_id || !clock_out_time) {
      return res.status(400).json({ message: 'attendance_id and clock_out_time are required' });
    }

    await resolveUserPending(userId, attendance_id, clock_out_time, timers || []);
    return res.json({ message: 'Pending issues resolved successfully' });
  } catch (err) {
    console.error('Resolve pending error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
};

/**
 * POST /api/attendance/admin/resolve-pending/:userId
 * Admin resolves pending past-day issues on behalf of a user
 * Body: { attendance_id, clock_out_time, timers: [{ type, timer_id, stop_time }] }
 */
exports.adminResolvePending = async (req, res) => {
  try {
    const userId = req.params.userId;
    const { attendance_id, clock_out_time, timers } = req.body;

    if (!attendance_id || !clock_out_time) {
      return res.status(400).json({ message: 'attendance_id and clock_out_time are required' });
    }

    await resolveUserPending(userId, attendance_id, clock_out_time, timers || []);
    return res.json({ message: 'Pending issues resolved successfully by admin' });
  } catch (err) {
    console.error('Admin resolve pending error:', err);
    return res.status(500).json({ message: err.message || 'Server error' });
  }
};

/**
 * GET /api/attendance/admin/all-pending
 * Admin: Returns all users with unresolved pending issues
 */
exports.adminGetAllPending = async (req, res) => {
  try {
    const [unclosed] = await db.query(
      `SELECT a.id AS attendance_id, a.user_id, a.date, a.clock_in,
              u.first_name, u.last_name, u.department
       FROM attendance a
       JOIN users u ON u.id = a.user_id
       WHERE a.clock_out IS NULL AND a.date < CURDATE() AND u.is_active = 1 AND u.deleted = 0
       ORDER BY a.date DESC`
    );

    const [orphanedTasks] = await db.query(
      `SELECT tat.user_id, COUNT(*) AS count
       FROM task_active_timers tat
       WHERE DATE(tat.started_at) < CURDATE()
       GROUP BY tat.user_id`
    );

    const [orphanedTickets] = await db.query(
      `SELECT tt.user_id, COUNT(*) AS count
       FROM ticket_active_timers tt
       WHERE DATE(tt.started_at) < CURDATE()
       GROUP BY tt.user_id`
    );

    const [orphanedMeetings] = await db.query(
      `SELECT mat.user_id, COUNT(*) AS count
       FROM meeting_active_timers mat
       WHERE DATE(mat.started_at) < CURDATE()
       GROUP BY mat.user_id`
    );

    // Build user map
    const userMap = {};
    for (const record of unclosed) {
      if (!userMap[record.user_id]) {
        userMap[record.user_id] = {
          user_id: record.user_id,
          name: `${record.first_name} ${record.last_name}`,
          department: record.department,
          unclosed_attendance: [],
          orphaned_task_count: 0,
          orphaned_ticket_count: 0,
          orphaned_meeting_count: 0,
        };
      }
      userMap[record.user_id].unclosed_attendance.push({
        attendance_id: record.attendance_id,
        date: record.date,
        clock_in: record.clock_in,
      });
    }

    for (const row of orphanedTasks) {
      if (!userMap[row.user_id]) {
        userMap[row.user_id] = { user_id: row.user_id, name: '', department: '', unclosed_attendance: [], orphaned_task_count: 0, orphaned_ticket_count: 0, orphaned_meeting_count: 0 };
      }
      userMap[row.user_id].orphaned_task_count = row.count;
    }
    for (const row of orphanedTickets) {
      if (!userMap[row.user_id]) {
        userMap[row.user_id] = { user_id: row.user_id, name: '', department: '', unclosed_attendance: [], orphaned_task_count: 0, orphaned_ticket_count: 0, orphaned_meeting_count: 0 };
      }
      userMap[row.user_id].orphaned_ticket_count = row.count;
    }
    for (const row of orphanedMeetings) {
      if (!userMap[row.user_id]) {
        userMap[row.user_id] = { user_id: row.user_id, name: '', department: '', unclosed_attendance: [], orphaned_task_count: 0, orphaned_ticket_count: 0, orphaned_meeting_count: 0 };
      }
      userMap[row.user_id].orphaned_meeting_count = row.count;
    }

    return res.json({ users_with_pending: Object.values(userMap) });
  } catch (err) {
    console.error('Admin get all pending error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── Helper: Get pending resolution data for a user ─────────────────────────
async function getPendingResolutionData(userId) {
  const [unclosedAttendance] = await db.query(
    `SELECT id, date, clock_in FROM attendance 
     WHERE user_id = ? AND clock_out IS NULL AND date < CURDATE()
     ORDER BY date DESC`,
    [userId]
  );

  const [orphanedTaskTimers] = await db.query(
    `SELECT tat.id, tat.task_id, tat.started_at, t.title
     FROM task_active_timers tat
     JOIN tasks t ON t.id = tat.task_id
     WHERE tat.user_id = ? AND DATE(tat.started_at) < CURDATE()`,
    [userId]
  );

  const [orphanedTicketTimers] = await db.query(
    `SELECT tt.id, tt.ticket_id, tt.started_at, tk.title
     FROM ticket_active_timers tt
     JOIN tickets tk ON tk.id = tt.ticket_id
     WHERE tt.user_id = ? AND DATE(tt.started_at) < CURDATE()`,
    [userId]
  );

  const [orphanedMeetingTimers] = await db.query(
    `SELECT mat.id, mat.meeting_id, mat.started_at, m.title
     FROM meeting_active_timers mat
     JOIN meetings m ON m.id = mat.meeting_id
     WHERE mat.user_id = ? AND DATE(mat.started_at) < CURDATE()`,
    [userId]
  );

  const hasPending = unclosedAttendance.length > 0 || orphanedTaskTimers.length > 0 || orphanedTicketTimers.length > 0 || orphanedMeetingTimers.length > 0;

  return {
    has_pending: hasPending,
    unclosed_attendance: unclosedAttendance,
    orphaned_task_timers: orphanedTaskTimers,
    orphaned_ticket_timers: orphanedTicketTimers,
    orphaned_meeting_timers: orphanedMeetingTimers,
  };
}

// ─── Helper: Resolve pending for a user ─────────────────────────────────────
async function resolveUserPending(userId, attendanceId, clockOutTime, timers) {
  // Verify the attendance record belongs to this user and is unclosed
  const [records] = await db.query(
    'SELECT * FROM attendance WHERE id = ? AND user_id = ? AND clock_out IS NULL',
    [attendanceId, userId]
  );

  if (records.length === 0) {
    throw new Error('Attendance record not found or already closed');
  }

  const record = records[0];
  const attendanceDate = new Date(record.date).toISOString().split('T')[0];

  // Build the clock-out datetime — user enters time in IST, convert to UTC for storage
  // IST = UTC + 5:30, so subtract 5h 30m to get UTC
  const [clockHours, clockMinutes] = clockOutTime.split(':').map(Number);
  const clockOutDateTime = new Date(`${attendanceDate}T${clockOutTime}:00+05:30`);
  const clockInTime = new Date(record.clock_in.includes('Z') || record.clock_in.includes('+') 
    ? record.clock_in 
    : record.clock_in.replace(' ', 'T') + 'Z');

  if (clockOutDateTime <= clockInTime) {
    throw new Error('Clock-out time must be after clock-in time');
  }

  // Process each orphaned timer
  for (const timer of timers) {
    if (!timer.type || !timer.timer_id || !timer.stop_time) {
      throw new Error('Each timer requires type, timer_id, and stop_time');
    }

    const stopDateTime = new Date(`${attendanceDate}T${timer.stop_time}:00+05:30`);

    if (timer.type === 'task') {
      const [taskTimer] = await db.query(
        'SELECT * FROM task_active_timers WHERE id = ? AND user_id = ?',
        [timer.timer_id, userId]
      );
      if (taskTimer.length === 0) continue;

      const t = taskTimer[0];
      const startedAt = new Date(t.started_at);
      const duration = Math.max(1, Math.floor((stopDateTime - startedAt) / 1000));

      await db.query(
        `INSERT INTO task_time_logs (task_id, user_id, started_at, ended_at, duration, note)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [t.task_id, userId, t.started_at, stopDateTime, duration, 'Manually resolved (forgot to stop)']
      );
      await db.query(
        'UPDATE tasks SET time_spent = time_spent + ?, timer_started_at = NULL WHERE id = ?',
        [duration, t.task_id]
      );
      await db.query('DELETE FROM task_active_timers WHERE id = ?', [t.id]);

    } else if (timer.type === 'ticket') {
      const [ticketTimer] = await db.query(
        'SELECT * FROM ticket_active_timers WHERE id = ? AND user_id = ?',
        [timer.timer_id, userId]
      );
      if (ticketTimer.length === 0) continue;

      const t = ticketTimer[0];
      const startedAt = new Date(t.started_at);
      const duration = Math.max(1, Math.floor((stopDateTime - startedAt) / 1000));
      const minutes = Math.ceil(duration / 60);

      await db.query(
        `INSERT INTO ticket_time_logs (ticket_id, user_id, minutes, description, started_at, ended_at, duration, log_date, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [t.ticket_id, userId, minutes, 'Manually resolved (forgot to stop)', t.started_at, stopDateTime, duration, attendanceDate, stopDateTime]
      );
      await db.query('DELETE FROM ticket_active_timers WHERE id = ?', [t.id]);

    } else if (timer.type === 'meeting') {
      const [meetingTimer] = await db.query(
        'SELECT * FROM meeting_active_timers WHERE id = ? AND user_id = ?',
        [timer.timer_id, userId]
      );
      if (meetingTimer.length === 0) continue;

      const t = meetingTimer[0];
      const startedAt = new Date(t.started_at);
      const duration = Math.max(1, Math.floor((stopDateTime - startedAt) / 1000));

      await db.query(
        `INSERT INTO meeting_time_logs (meeting_id, user_id, started_at, ended_at, duration, note)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [t.meeting_id, userId, t.started_at, stopDateTime, duration, 'Manually resolved (forgot to stop)']
      );
      await db.query('DELETE FROM meeting_active_timers WHERE id = ?', [t.id]);
    }
  }

  // End any active AFS sessions from that day
  const [activeAfs] = await db.query(
    'SELECT id, start_time FROM afs_logs WHERE user_id = ? AND end_time IS NULL AND DATE(start_time) = ?',
    [userId, attendanceDate]
  );
  for (const afs of activeAfs) {
    const afsDuration = Math.floor((clockOutDateTime - new Date(afs.start_time)) / 1000);
    await db.query(
      'UPDATE afs_logs SET end_time = ?, duration_seconds = ? WHERE id = ?',
      [clockOutDateTime, afsDuration, afs.id]
    );
    await db.query(
      'UPDATE attendance SET total_afs_seconds = total_afs_seconds + ? WHERE id = ?',
      [afsDuration, attendanceId]
    );
  }

  // Calculate total served seconds and close attendance
  const totalServedSeconds = Math.floor((clockOutDateTime - clockInTime) / 1000);

  await db.query(
    `UPDATE attendance 
     SET clock_out = ?, corrected_clock_out = ?, total_served_seconds = ?, correction_submitted_at = NOW()
     WHERE id = ?`,
    [clockOutDateTime, clockOutDateTime, totalServedSeconds, attendanceId]
  );
}

/**
 * GET /api/attendance/my-month-balance
 * Get current user's monthly running balance (deficit/surplus within the month)
 * Resets every month — no carry-forward
 */
exports.getMyMonthBalance = async (req, res) => {
  try {
    const userId = req.user.id;

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const today = now.toISOString().split('T')[0];

    // Get expected hours for the month up to today
    const { totalExpected, dailyBreakdown } = await getExpectedHoursForRange(monthStart, today, userId);

    // Calculate productive hours (tasks + tickets + meetings) for the month
    const [taskTimeResult] = await db.query(
      `SELECT COALESCE(SUM(duration), 0) AS total FROM task_time_logs 
       WHERE user_id = ? AND DATE(started_at) BETWEEN ? AND ? AND ended_at IS NOT NULL AND duration > 0`,
      [userId, monthStart, today]
    );
    const [ticketTimeResult] = await db.query(
      `SELECT COALESCE(SUM(minutes), 0) AS total FROM ticket_time_logs 
       WHERE user_id = ? AND DATE(created_at) BETWEEN ? AND ?`,
      [userId, monthStart, today]
    );
    const [meetingTimeResult] = await db.query(
      `SELECT COALESCE(SUM(duration), 0) AS total 
       FROM meeting_time_logs
       WHERE user_id = ? AND DATE(started_at) BETWEEN ? AND ?
       AND ended_at IS NOT NULL AND duration > 0`,
      [userId, monthStart, today]
    );

    const taskHours = (parseInt(taskTimeResult[0].total) || 0) / 3600;
    const ticketHours = (parseInt(ticketTimeResult[0].total) || 0) / 60;
    const meetingHours = (parseInt(meetingTimeResult[0].total) || 0) / 3600;
    const completedHours = taskHours + ticketHours + meetingHours;

    // Balance = completed - required (positive = surplus, negative = deficit)
    const balanceHours = completedHours - totalExpected;
    const deficit = balanceHours < 0 ? Math.abs(balanceHours) : 0;
    const surplus = balanceHours > 0 ? balanceHours : 0;

    // Calculate total required for full month (for progress context)
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
    const { totalExpected: fullMonthExpected } = await getExpectedHoursForRange(monthStart, monthEnd, userId);

    // Daily balance breakdown (for chart/detail view)
    const [dailyTasks] = await db.query(
      `SELECT DATE(started_at) AS date, COALESCE(SUM(duration), 0) AS total 
       FROM task_time_logs WHERE user_id = ? AND DATE(started_at) BETWEEN ? AND ? AND ended_at IS NOT NULL AND duration > 0
       GROUP BY DATE(started_at)`,
      [userId, monthStart, today]
    );
    const [dailyTickets] = await db.query(
      `SELECT DATE(created_at) AS date, COALESCE(SUM(minutes), 0) AS total 
       FROM ticket_time_logs WHERE user_id = ? AND DATE(created_at) BETWEEN ? AND ?
       GROUP BY DATE(created_at)`,
      [userId, monthStart, today]
    );
    const [dailyMeetings] = await db.query(
      `SELECT DATE(started_at) AS date, COALESCE(SUM(duration), 0) AS total
       FROM meeting_time_logs
       WHERE user_id = ? AND DATE(started_at) BETWEEN ? AND ?
       AND ended_at IS NOT NULL AND duration > 0
       GROUP BY DATE(started_at)`,
      [userId, monthStart, today]
    );

    // Build daily map
    const taskMap = {};
    dailyTasks.forEach(r => { taskMap[new Date(r.date).toISOString().split('T')[0]] = (parseInt(r.total) || 0) / 3600; });
    const ticketMap = {};
    dailyTickets.forEach(r => { ticketMap[new Date(r.date).toISOString().split('T')[0]] = (parseInt(r.total) || 0) / 60; });
    const meetingMap = {};
    dailyMeetings.forEach(r => { meetingMap[new Date(r.date).toISOString().split('T')[0]] = (parseInt(r.total) || 0) / 3600; });

    let runningBalance = 0;
    const daily_balance = dailyBreakdown.map(day => {
      const dayCompleted = (taskMap[day.date] || 0) + (ticketMap[day.date] || 0) + (meetingMap[day.date] || 0);
      const dayDiff = dayCompleted - day.expected_hours;
      runningBalance += dayDiff;
      return {
        date: day.date,
        expected: parseFloat(day.expected_hours.toFixed(2)),
        completed: parseFloat(dayCompleted.toFixed(2)),
        daily_diff: parseFloat(dayDiff.toFixed(2)),
        running_balance: parseFloat(runningBalance.toFixed(2)),
        type: day.type
      };
    });

    // Get month name for display
    const monthName = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });

    return res.json({
      month: monthName,
      month_start: monthStart,
      required_hours_so_far: parseFloat(totalExpected.toFixed(2)),
      completed_hours: parseFloat(completedHours.toFixed(2)),
      balance_hours: parseFloat(balanceHours.toFixed(2)),
      deficit: parseFloat(deficit.toFixed(2)),
      surplus: parseFloat(surplus.toFixed(2)),
      full_month_required: parseFloat(fullMonthExpected.toFixed(2)),
      task_hours: parseFloat(taskHours.toFixed(2)),
      ticket_hours: parseFloat(ticketHours.toFixed(2)),
      meeting_hours: parseFloat(meetingHours.toFixed(2)),
      daily_balance,
      status: surplus > 0 ? 'surplus' : deficit > 0 ? 'deficit' : 'on_track'
    });
  } catch (err) {
    console.error('Get my month balance error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/attendance/admin/month-balance-report
 * Admin: Get all employees' monthly balance for the current month
 */
exports.adminMonthBalanceReport = async (req, res) => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const today = now.toISOString().split('T')[0];

    const [users] = await db.query(
      'SELECT id, first_name, last_name, department, designation FROM users WHERE is_active = 1 AND deleted = 0'
    );

    const report = [];

    for (const user of users) {
      const { totalExpected } = await getExpectedHoursForRange(monthStart, today, user.id);

      const [taskTimeResult] = await db.query(
        `SELECT COALESCE(SUM(duration), 0) AS total FROM task_time_logs 
         WHERE user_id = ? AND DATE(started_at) BETWEEN ? AND ? AND ended_at IS NOT NULL AND duration > 0`,
        [user.id, monthStart, today]
      );
      const [ticketTimeResult] = await db.query(
        `SELECT COALESCE(SUM(minutes), 0) AS total FROM ticket_time_logs 
         WHERE user_id = ? AND DATE(created_at) BETWEEN ? AND ?`,
        [user.id, monthStart, today]
      );
      const [meetingTimeResult] = await db.query(
        `SELECT COALESCE(SUM(duration), 0) AS total 
         FROM meeting_time_logs
         WHERE user_id = ? AND DATE(started_at) BETWEEN ? AND ?
         AND ended_at IS NOT NULL AND duration > 0`,
        [user.id, monthStart, today]
      );

      const taskHours = (parseInt(taskTimeResult[0].total) || 0) / 3600;
      const ticketHours = (parseInt(ticketTimeResult[0].total) || 0) / 60;
      const meetingHours = (parseInt(meetingTimeResult[0].total) || 0) / 3600;
      const completedHours = taskHours + ticketHours + meetingHours;

      const balanceHours = completedHours - totalExpected;

      report.push({
        user_id: user.id,
        name: user.first_name + ' ' + user.last_name,
        department: user.department,
        designation: user.designation,
        required: parseFloat(totalExpected.toFixed(2)),
        completed: parseFloat(completedHours.toFixed(2)),
        balance: parseFloat(balanceHours.toFixed(2)),
        status: balanceHours > 0 ? 'surplus' : balanceHours < -0.5 ? 'deficit' : 'on_track'
      });
    }

    // Sort: deficit first (most negative), then on_track, then surplus
    report.sort((a, b) => a.balance - b.balance);

    const monthName = now.toLocaleString('en-US', { month: 'long', year: 'numeric' });

    return res.json({ month: monthName, month_start: monthStart, report });
  } catch (err) {
    console.error('Admin month balance report error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/attendance/admin/timesheet?user_id=X&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
 * Admin: Returns timesheet data for any employee for a given period.
 */
exports.adminTimesheet = async (req, res) => {
  try {
    const { user_id, start_date, end_date } = req.query;

    if (!user_id) return res.status(400).json({ message: 'user_id is required' });

    // Default to current week
    const now = new Date();
    const dayOfWeek = now.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(now);
    monday.setDate(now.getDate() + mondayOffset);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const startStr = start_date || monday.toISOString().split('T')[0];
    const endStr = end_date || sunday.toISOString().split('T')[0];

    // Attendance records
    const [attendance] = await db.query(
      `SELECT date, clock_in, clock_out, clock_in_status, total_served_seconds, total_afs_seconds
       FROM attendance WHERE user_id = ? AND date BETWEEN ? AND ?
       ORDER BY date ASC`,
      [user_id, startStr, endStr]
    );

    // Task time logs
    const [taskTime] = await db.query(
      `SELECT DATE(started_at) AS log_date, SUM(duration) AS total_seconds
       FROM task_time_logs WHERE user_id = ? AND DATE(started_at) BETWEEN ? AND ?
       AND ended_at IS NOT NULL AND duration > 0
       GROUP BY DATE(started_at)`,
      [user_id, startStr, endStr]
    );

    // Ticket time logs
    const [ticketTime] = await db.query(
      `SELECT log_date, SUM(minutes) AS total_minutes
       FROM ticket_time_logs WHERE user_id = ? AND log_date BETWEEN ? AND ?
       GROUP BY log_date`,
      [user_id, startStr, endStr]
    );

    // Meeting time — use actual timer logs (meeting_time_logs), not scheduled meeting times
    const [meetingTime] = await db.query(
      `SELECT DATE(ml.started_at) AS log_date, SUM(ml.duration) AS total_seconds
       FROM meeting_time_logs ml
       WHERE ml.user_id = ? AND DATE(ml.started_at) BETWEEN ? AND ?
       AND ml.ended_at IS NOT NULL AND ml.duration > 0
       GROUP BY DATE(ml.started_at)`,
      [user_id, startStr, endStr]
    );

    // Get lunch duration from settings
    const [settings] = await db.query('SELECT lunch_duration_minutes FROM attendance_settings WHERE id = 1');
    const lunchSeconds = (settings[0]?.lunch_duration_minutes || 60) * 60;

    // Summary
    const totalServed = attendance.reduce((sum, a) => sum + (Number(a.total_served_seconds) || 0), 0);
    const totalAfs = attendance.reduce((sum, a) => sum + (Number(a.total_afs_seconds) || 0), 0);
    const totalTaskSeconds = taskTime.reduce((sum, t) => sum + (Number(t.total_seconds) || 0), 0);
    const totalTicketMinutes = ticketTime.reduce((sum, t) => sum + (Number(t.total_minutes) || 0), 0);
    const totalMeetingSeconds = meetingTime.reduce((sum, m) => sum + (Number(m.total_seconds) || 0), 0);
    const rawProductiveSeconds = totalTaskSeconds + (totalTicketMinutes * 60) + totalMeetingSeconds;
    // Cap productive to never exceed served (handles overlapping timers / simultaneous tracking)
    const productiveSeconds = Math.min(rawProductiveSeconds, totalServed);
    // Deduct lunch per day present from unaccounted time
    const unaccountedSeconds = Math.max(0, totalServed - productiveSeconds - totalAfs);
    const totalLunchDeduction = Math.min(lunchSeconds * attendance.length, unaccountedSeconds);
    const idleSeconds = Math.max(0, unaccountedSeconds - totalLunchDeduction);

    return res.json({
      period: { start: startStr, end: endStr },
      attendance,
      taskTime,
      ticketTime,
      meetingTime,
      summary: {
        total_served_seconds: totalServed,
        total_afs_seconds: totalAfs,
        productive_seconds: productiveSeconds,
        idle_seconds: idleSeconds,
        total_task_seconds: totalTaskSeconds,
        total_ticket_minutes: totalTicketMinutes,
        total_meeting_seconds: totalMeetingSeconds,
        days_present: attendance.length,
      },
    });
  } catch (err) {
    console.error('Admin timesheet error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/attendance/admin/timesheet/day?user_id=X&date=YYYY-MM-DD
 * Admin: Returns detailed breakdown of a specific day for any employee.
 */
exports.adminTimesheetDay = async (req, res) => {
  try {
    const { user_id, date } = req.query;

    if (!user_id) return res.status(400).json({ message: 'user_id is required' });
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ message: 'Valid date (YYYY-MM-DD) is required' });
    }

    // Task time logs with task title
    const [taskLogs] = await db.query(
      `SELECT tl.id, tl.task_id, t.title AS task_title, tl.started_at, tl.ended_at, tl.duration, tl.note
       FROM task_time_logs tl
       JOIN tasks t ON t.id = tl.task_id
       WHERE tl.user_id = ? AND DATE(tl.started_at) = ?
       ORDER BY tl.started_at ASC`,
      [user_id, date]
    );

    // Ticket time logs with ticket title
    const [ticketLogs] = await db.query(
      `SELECT tl.id, tl.ticket_id, tk.title AS ticket_title, tl.started_at, tl.ended_at, tl.duration, tl.description AS note
       FROM ticket_time_logs tl
       JOIN tickets tk ON tk.id = tl.ticket_id
       WHERE tl.user_id = ? AND DATE(tl.started_at) = ?
       ORDER BY tl.started_at ASC`,
      [user_id, date]
    );

    // Meeting time logs with meeting title
    const [meetingLogs] = await db.query(
      `SELECT ml.id, ml.meeting_id, m.title AS meeting_title, ml.started_at, ml.ended_at, ml.duration, ml.note
       FROM meeting_time_logs ml
       JOIN meetings m ON m.id = ml.meeting_id
       WHERE ml.user_id = ? AND DATE(ml.started_at) = ?
       ORDER BY ml.started_at ASC`,
      [user_id, date]
    );

    // AFS logs
    const [afsLogs] = await db.query(
      `SELECT id, start_time, end_time, duration_seconds
       FROM afs_logs
       WHERE user_id = ? AND DATE(start_time) = ?
       ORDER BY start_time ASC`,
      [user_id, date]
    );

    // Attendance for that day
    const [attendance] = await db.query(
      `SELECT clock_in, clock_out, clock_in_status, total_served_seconds, total_afs_seconds
       FROM attendance WHERE user_id = ? AND date = ?`,
      [user_id, date]
    );

    const totalTaskSeconds = taskLogs.reduce((sum, l) => sum + (Number(l.duration) || 0), 0);
    const totalTicketSeconds = ticketLogs.reduce((sum, l) => sum + (Number(l.duration) || 0), 0);
    const totalMeetingSeconds = meetingLogs.reduce((sum, l) => sum + (Number(l.duration) || 0), 0);
    const totalAfsSeconds = afsLogs.reduce((sum, l) => sum + (Number(l.duration_seconds) || 0), 0);
    const rawProductiveSeconds = totalTaskSeconds + totalTicketSeconds + totalMeetingSeconds;
    const totalServedSeconds = Number(attendance[0]?.total_served_seconds) || 0;
    // Cap productive to never exceed served (handles overlapping timers)
    const productiveSeconds = Math.min(rawProductiveSeconds, totalServedSeconds);
    // Deduct lunch from unaccounted time
    const [settings] = await db.query('SELECT lunch_duration_minutes FROM attendance_settings WHERE id = 1');
    const lunchSeconds = (settings[0]?.lunch_duration_minutes || 60) * 60;
    const unaccountedSeconds = Math.max(0, totalServedSeconds - productiveSeconds - totalAfsSeconds);
    const lunchDeduction = Math.min(lunchSeconds, unaccountedSeconds);
    const idleSeconds = Math.max(0, unaccountedSeconds - lunchDeduction);

    return res.json({
      date,
      attendance: attendance[0] || null,
      tasks: taskLogs,
      tickets: ticketLogs,
      meetings: meetingLogs,
      afs: afsLogs,
      summary: {
        total_task_seconds: totalTaskSeconds,
        total_ticket_seconds: totalTicketSeconds,
        total_meeting_seconds: totalMeetingSeconds,
        total_afs_seconds: totalAfsSeconds,
        productive_seconds: productiveSeconds,
        idle_seconds: idleSeconds,
      },
    });
  } catch (err) {
    console.error('Admin timesheet day error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
