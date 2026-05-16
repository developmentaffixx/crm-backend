const db = require('../config/db');

exports.clockIn = async (req, res) => {
  try {
    const userId = req.user.id;
    const { plans, late_reason } = req.body;

    const [existing] = await db.query(
      'SELECT id FROM attendance WHERE user_id = ? AND date = CURDATE()',
      [userId]
    );
    if (existing.length) {
      return res.status(400).json({ message: 'Already clocked in today' });
    }

    const [settings] = await db.query('SELECT * FROM attendance_settings WHERE id = 1');
    const { shift_start_time, grace_period_minutes } = settings[0];

    const [timeResult] = await db.query('SELECT CURTIME() AS now_time');
    const nowTime = timeResult[0].now_time;

    const toSeconds = (t) => {
      const parts = t.split(':');
      return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2] || 0);
    };

    const nowSec = toSeconds(nowTime);
    const shiftSec = toSeconds(shift_start_time);
    const graceSec = shiftSec + grace_period_minutes * 60;

    let clock_in_status;
    if (nowSec <= shiftSec) {
      clock_in_status = 'on_time';
    } else if (nowSec <= graceSec) {
      clock_in_status = 'grace';
    } else {
      clock_in_status = 'late';
      if (!late_reason) {
        return res.status(400).json({ message: 'Late reason is required when clocking in late' });
      }
    }

    const [result] = await db.query(
      `INSERT INTO attendance (user_id, date, clock_in, clock_in_status, late_reason)
       VALUES (?, CURDATE(), NOW(), ?, ?)`,
      [userId, clock_in_status, late_reason || null]
    );
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

    const [servedResult] = await db.query(
      'SELECT TIMESTAMPDIFF(SECOND, clock_in, NOW()) AS total_served FROM attendance WHERE id = ?',
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

    const [taskTimerResult] = await db.query(
      'SELECT COALESCE(SUM(duration), 0) AS total FROM task_time_logs WHERE user_id = ? AND DATE(started_at) = CURDATE()',
      [userId]
    );

    return res.json({
      attendance: attendance[0] || null,
      plans,
      active_afs: activeAfs[0] || null,
      total_task_seconds: taskTimerResult[0].total
    });
  } catch (err) {
    console.error('Get today error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

exports.getMyWeek = async (req, res) => {
  try {
    const userId = req.user.id;

    const [settings] = await db.query('SELECT * FROM attendance_settings WHERE id = 1');
    const { work_hours_per_day } = settings[0];

    const [weekRange] = await db.query(
      `SELECT DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY) AS week_start,
              DATE_ADD(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY), INTERVAL 6 DAY) AS week_end`
    );
    const { week_start, week_end } = weekRange[0];

    const [records] = await db.query(
      'SELECT * FROM attendance WHERE user_id = ? AND date BETWEEN ? AND ? ORDER BY date',
      [userId, week_start, week_end]
    );

    const [leaves] = await db.query(
      `SELECT * FROM leaves WHERE user_id = ? AND status = 'approved' AND deleted = 0
       AND from_date <= ? AND to_date >= ?`,
      [userId, week_end, week_start]
    );

    let fullLeaveDays = 0;
    let halfLeaveDays = 0;
    for (const leave of leaves) {
      const leaveStart = new Date(Math.max(new Date(leave.from_date), new Date(week_start)));
      const leaveEnd = new Date(Math.min(new Date(leave.to_date), new Date(week_end)));
      const days = Math.floor((leaveEnd - leaveStart) / (1000 * 60 * 60 * 24)) + 1;
      if (leave.leave_type === 'half_day') {
        halfLeaveDays += days;
      } else {
        fullLeaveDays += days;
      }
    }

    const today = new Date();
    const endDate = new Date(Math.min(today, new Date(week_end)));
    let workingDays = 0;
    for (let d = new Date(week_start); d <= endDate; d.setDate(d.getDate() + 1)) {
      const day = d.getDay();
      if (day !== 0 && day !== 6) workingDays++;
    }

    const required = (workingDays * work_hours_per_day) - (fullLeaveDays * work_hours_per_day) - (halfLeaveDays * work_hours_per_day / 2);
    const completed = records.reduce((sum, r) => sum + (r.total_served_seconds || 0), 0) / 3600;
    const remaining = Math.max(0, required - completed);
    const deficit = Math.max(0, required - completed);

    const daily_breakdown = records.map(r => ({
      date: r.date,
      clock_in: r.clock_in,
      clock_out: r.clock_out,
      clock_in_status: r.clock_in_status,
      served_hours: (r.total_served_seconds || 0) / 3600
    }));

    return res.json({
      week_start, week_end,
      required: parseFloat(required.toFixed(2)),
      completed: parseFloat(completed.toFixed(2)),
      remaining: parseFloat(remaining.toFixed(2)),
      deficit: parseFloat(deficit.toFixed(2)),
      daily_breakdown
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

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    let totalWorkingDays = 0;
    for (let d = new Date(monthStart); d <= now; d.setDate(d.getDate() + 1)) {
      const day = d.getDay();
      if (day !== 0 && day !== 6) totalWorkingDays++;
    }

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

    let pausedTask = null;
    const [runningTasks] = await db.query(
      'SELECT id, timer_started_at, time_spent FROM tasks WHERE assigned_to = ? AND timer_started_at IS NOT NULL',
      [userId]
    );

    if (runningTasks.length) {
      const task = runningTasks[0];
      const [durationResult] = await db.query(
        'SELECT TIMESTAMPDIFF(SECOND, ?, NOW()) AS duration',
        [task.timer_started_at]
      );
      const duration = durationResult[0].duration;

      await db.query(
        `INSERT INTO task_time_logs (task_id, user_id, started_at, ended_at, duration, note)
         VALUES (?, ?, ?, NOW(), ?, 'Auto-paused for AFS')`,
        [task.id, userId, task.timer_started_at, duration]
      );

      await db.query(
        'UPDATE tasks SET timer_started_at = NULL, time_spent = time_spent + ? WHERE id = ?',
        [duration, task.id]
      );

      pausedTask = { task_id: task.id, duration_paused: duration };
    }

    const [result] = await db.query(
      'INSERT INTO afs_logs (user_id, attendance_id, start_time) VALUES (?, ?, NOW())',
      [userId, attendanceId]
    );

    const [afsLog] = await db.query('SELECT * FROM afs_logs WHERE id = ?', [result.insertId]);

    return res.status(201).json({ afs_log: afsLog[0], paused_task: pausedTask });
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

    return res.json({ afs_log: updatedAfs[0] });
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
       WHERE u.is_active = 1 AND u.deleted = 0
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
    const [settings] = await db.query('SELECT * FROM attendance_settings WHERE id = 1');
    const { work_hours_per_day } = settings[0];

    const [weekRange] = await db.query(
      `SELECT DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY) AS week_start,
              DATE_ADD(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY), INTERVAL 6 DAY) AS week_end`
    );
    const { week_start, week_end } = weekRange[0];

    const [users] = await db.query(
      'SELECT id, first_name, last_name, department FROM users WHERE is_active = 1 AND deleted = 0'
    );

    const today = new Date();
    const endDate = new Date(Math.min(today, new Date(week_end)));
    let workingDays = 0;
    for (let d = new Date(week_start); d <= endDate; d.setDate(d.getDate() + 1)) {
      const day = d.getDay();
      if (day !== 0 && day !== 6) workingDays++;
    }

    const report = [];

    for (const user of users) {
      const [records] = await db.query(
        'SELECT total_served_seconds FROM attendance WHERE user_id = ? AND date BETWEEN ? AND ?',
        [user.id, week_start, week_end]
      );

      const [leaves] = await db.query(
        `SELECT * FROM leaves WHERE user_id = ? AND status = 'approved' AND deleted = 0
         AND from_date <= ? AND to_date >= ?`,
        [user.id, week_end, week_start]
      );

      let fullLeaveDays = 0;
      let halfLeaveDays = 0;
      for (const leave of leaves) {
        const leaveStart = new Date(Math.max(new Date(leave.from_date), new Date(week_start)));
        const leaveEnd = new Date(Math.min(new Date(leave.to_date), new Date(week_end)));
        const days = Math.floor((leaveEnd - leaveStart) / (1000 * 60 * 60 * 24)) + 1;
        if (leave.leave_type === 'half_day') halfLeaveDays += days;
        else fullLeaveDays += days;
      }

      const required = (workingDays * work_hours_per_day) - (fullLeaveDays * work_hours_per_day) - (halfLeaveDays * work_hours_per_day / 2);
      const completed = records.reduce((sum, r) => sum + (r.total_served_seconds || 0), 0) / 3600;
      const deficit = Math.max(0, required - completed);

      report.push({
        user_id: user.id,
        name: user.first_name + ' ' + user.last_name,
        department: user.department,
        required: parseFloat(required.toFixed(2)),
        completed: parseFloat(completed.toFixed(2)),
        deficit: parseFloat(deficit.toFixed(2)),
        leave_days: fullLeaveDays + halfLeaveDays * 0.5
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
