const db = require('../config/db');

/**
 * GET /api/compensation/my-deficits
 * Get current user's deficit history and pending compensations
 */
exports.getMyDeficits = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get unresolved deficits (last 4 weeks)
    const [deficits] = await db.query(
      `SELECT * FROM weekly_deficit_log
       WHERE user_id = ? AND deficit_hours > 0 AND status != 'compensated'
       ORDER BY week_start DESC LIMIT 4`,
      [userId]
    );

    // Get pending/approved compensation requests
    const [requests] = await db.query(
      `SELECT * FROM compensation_requests
       WHERE user_id = ? AND deleted = 0 AND status IN ('pending', 'approved')
       ORDER BY planned_date ASC`,
      [userId]
    );

    // Current week surplus (auto-compensation check)
    const [currentWeek] = await db.query(
      `SELECT 
        DATE_SUB(CURDATE(), INTERVAL (WEEKDAY(CURDATE())) DAY) AS week_start`
    );
    const weekStart = currentWeek[0].week_start;

    return res.json({ deficits, requests, current_week_start: weekStart });
  } catch (err) {
    console.error('Get my deficits error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};


/**
 * POST /api/compensation/request
 * Submit a compensation request
 */
exports.createRequest = async (req, res) => {
  try {
    const userId = req.user.id;
    const { deficit_week, planned_date, planned_start, planned_end, planned_hours, remarks } = req.body;

    if (!deficit_week || !planned_date || !planned_hours) {
      return res.status(400).json({ message: 'deficit_week, planned_date, and planned_hours are required' });
    }

    // Validate planned_hours (min 1h, max 8h)
    if (planned_hours < 1 || planned_hours > 8) {
      return res.status(400).json({ message: 'Planned hours must be between 1 and 8' });
    }

    // Validate planned_date is in the future
    if (new Date(planned_date) < new Date(new Date().toDateString())) {
      return res.status(400).json({ message: 'Planned date must be today or in the future' });
    }

    // Check if deficit exists for that week
    const [deficit] = await db.query(
      `SELECT * FROM weekly_deficit_log
       WHERE user_id = ? AND week_start = ? AND deficit_hours > 0`,
      [userId, deficit_week]
    );

    if (deficit.length === 0) {
      return res.status(400).json({ message: 'No deficit found for the specified week' });
    }

    // Check deadline (7 days from end of deficit week)
    const deficitWeekEnd = new Date(deficit_week);
    deficitWeekEnd.setDate(deficitWeekEnd.getDate() + 13); // 7 days after week ends (Sun + 7)
    if (new Date(planned_date) > deficitWeekEnd) {
      return res.status(400).json({ message: 'Compensation must be completed within 7 days of the deficit week' });
    }

    // Check no duplicate request for same week + date
    const [existing] = await db.query(
      `SELECT id FROM compensation_requests
       WHERE user_id = ? AND deficit_week = ? AND planned_date = ? AND deleted = 0 AND status NOT IN ('rejected', 'cancelled')`,
      [userId, deficit_week, planned_date]
    );

    if (existing.length > 0) {
      return res.status(400).json({ message: 'You already have a request for this date' });
    }

    const [result] = await db.query(
      `INSERT INTO compensation_requests (user_id, deficit_week, deficit_hours, planned_date, planned_start, planned_end, planned_hours, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, deficit_week, deficit[0].deficit_hours, planned_date, planned_start || null, planned_end || null, planned_hours, remarks || null]
    );

    return res.status(201).json({ id: result.insertId, message: 'Compensation request submitted' });
  } catch (err) {
    console.error('Create compensation request error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};


/**
 * PATCH /api/compensation/:id/approve
 * Admin approves a compensation request
 */
exports.approveRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.user.id;
    const { remarks } = req.body;

    const [request] = await db.query(
      'SELECT * FROM compensation_requests WHERE id = ? AND deleted = 0',
      [id]
    );

    if (request.length === 0) {
      return res.status(404).json({ message: 'Request not found' });
    }

    if (request[0].status !== 'pending') {
      return res.status(400).json({ message: 'Request is not in pending status' });
    }

    await db.query(
      `UPDATE compensation_requests SET status = 'approved', approved_by = ?, approved_at = NOW(), remarks = COALESCE(?, remarks) WHERE id = ?`,
      [adminId, remarks || null, id]
    );

    return res.json({ message: 'Request approved' });
  } catch (err) {
    console.error('Approve compensation error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PATCH /api/compensation/:id/reject
 * Admin rejects a compensation request
 */
exports.rejectRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { remarks } = req.body;

    const [request] = await db.query(
      'SELECT * FROM compensation_requests WHERE id = ? AND deleted = 0',
      [id]
    );

    if (request.length === 0) {
      return res.status(404).json({ message: 'Request not found' });
    }

    if (request[0].status !== 'pending') {
      return res.status(400).json({ message: 'Request is not in pending status' });
    }

    await db.query(
      `UPDATE compensation_requests SET status = 'rejected', remarks = ? WHERE id = ?`,
      [remarks || 'Rejected by admin', id]
    );

    return res.json({ message: 'Request rejected' });
  } catch (err) {
    console.error('Reject compensation error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};


/**
 * PATCH /api/compensation/:id/cancel
 * Member cancels their own request
 */
exports.cancelRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const [request] = await db.query(
      'SELECT * FROM compensation_requests WHERE id = ? AND user_id = ? AND deleted = 0',
      [id, userId]
    );

    if (request.length === 0) {
      return res.status(404).json({ message: 'Request not found' });
    }

    if (!['pending', 'approved'].includes(request[0].status)) {
      return res.status(400).json({ message: 'Cannot cancel this request' });
    }

    await db.query(
      `UPDATE compensation_requests SET status = 'cancelled' WHERE id = ?`,
      [id]
    );

    return res.json({ message: 'Request cancelled' });
  } catch (err) {
    console.error('Cancel compensation error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/compensation/:id/complete
 * Auto-called when employee clocks out on a compensation day
 * Or manually triggered by admin
 */
exports.completeRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const { actual_hours } = req.body;

    const [request] = await db.query(
      'SELECT * FROM compensation_requests WHERE id = ? AND deleted = 0',
      [id]
    );

    if (request.length === 0) {
      return res.status(404).json({ message: 'Request not found' });
    }

    if (request[0].status !== 'approved') {
      return res.status(400).json({ message: 'Request must be approved first' });
    }

    const hours = actual_hours || request[0].planned_hours;

    // Update request
    await db.query(
      `UPDATE compensation_requests SET status = 'completed', actual_hours = ? WHERE id = ?`,
      [hours, id]
    );

    // Update weekly deficit log
    await db.query(
      `UPDATE weekly_deficit_log
       SET compensated_hours = compensated_hours + ?,
           remaining_deficit = GREATEST(0, remaining_deficit - ?),
           status = CASE
             WHEN remaining_deficit - ? <= 0 THEN 'compensated'
             ELSE 'partially_compensated'
           END
       WHERE user_id = ? AND week_start = ?`,
      [hours, hours, hours, request[0].user_id, request[0].deficit_week]
    );

    return res.json({ message: 'Compensation completed', actual_hours: hours });
  } catch (err) {
    console.error('Complete compensation error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};


/**
 * GET /api/compensation/admin/pending
 * Admin: Get all pending compensation requests
 */
exports.getAdminPending = async (req, res) => {
  try {
    const [requests] = await db.query(
      `SELECT cr.*, CONCAT(u.first_name, ' ', u.last_name) AS employee_name, u.avatar_url
       FROM compensation_requests cr
       JOIN users u ON u.id = cr.user_id
       WHERE cr.deleted = 0 AND cr.status = 'pending'
       ORDER BY cr.created_at DESC`
    );

    return res.json({ requests });
  } catch (err) {
    console.error('Admin pending compensations error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/compensation/admin/all
 * Admin: Get all compensation requests with filters
 */
exports.getAdminAll = async (req, res) => {
  try {
    const { status, user_id } = req.query;

    let query = `SELECT cr.*, CONCAT(u.first_name, ' ', u.last_name) AS employee_name
                 FROM compensation_requests cr
                 JOIN users u ON u.id = cr.user_id
                 WHERE cr.deleted = 0`;
    const params = [];

    if (status) {
      query += ' AND cr.status = ?';
      params.push(status);
    }
    if (user_id) {
      query += ' AND cr.user_id = ?';
      params.push(user_id);
    }

    query += ' ORDER BY cr.created_at DESC LIMIT 50';

    const [requests] = await db.query(query, params);
    return res.json({ requests });
  } catch (err) {
    console.error('Admin all compensations error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Called by a cron or at end of week to log deficits
 * POST /api/compensation/log-weekly-deficit
 */
exports.logWeeklyDeficit = async (req, res) => {
  try {
    // Get last week's Monday
    const [weekResult] = await db.query(
      `SELECT DATE_SUB(CURDATE(), INTERVAL (WEEKDAY(CURDATE()) + 7) DAY) AS last_week_start`
    );
    const lastWeekStart = weekResult[0].last_week_start;
    const lastWeekEnd = new Date(lastWeekStart);
    lastWeekEnd.setDate(lastWeekEnd.getDate() + 6);
    const lastWeekEndStr = lastWeekEnd.toISOString().split('T')[0];

    // Get all active users
    const [users] = await db.query(
      'SELECT id FROM users WHERE is_active = 1 AND deleted = 0'
    );

    let logged = 0;

    for (const user of users) {
      // Check if already logged
      const [existing] = await db.query(
        'SELECT id FROM weekly_deficit_log WHERE user_id = ? AND week_start = ?',
        [user.id, lastWeekStart]
      );
      if (existing.length > 0) continue;

      // Get required hours for last week (from attendance/week-report logic)
      const [attendanceRows] = await db.query(
        `SELECT COALESCE(SUM(total_served_seconds), 0) AS total_seconds
         FROM attendance
         WHERE user_id = ? AND date BETWEEN ? AND ?`,
        [user.id, lastWeekStart, lastWeekEndStr]
      );

      const completedHours = (parseInt(attendanceRows[0].total_seconds) || 0) / 3600;

      // Get required hours (assume 8h * working days)
      const [workDays] = await db.query(
        `SELECT COUNT(*) AS days FROM attendance
         WHERE user_id = ? AND date BETWEEN ? AND ?`,
        [user.id, lastWeekStart, lastWeekEndStr]
      );

      // Use 8h per working day as default
      const requiredHours = Math.max(workDays[0].days, 5) * 8;
      const deficit = Math.max(0, requiredHours - completedHours);

      if (deficit > 0.5) { // Only log if deficit > 30 min
        const deadlineDate = new Date(lastWeekEnd);
        deadlineDate.setDate(deadlineDate.getDate() + 7);

        await db.query(
          `INSERT INTO weekly_deficit_log (user_id, week_start, required_hours, completed_hours, deficit_hours, remaining_deficit, status, deadline_date)
           VALUES (?, ?, ?, ?, ?, ?, 'deficit', ?)`,
          [user.id, lastWeekStart, requiredHours.toFixed(2), completedHours.toFixed(2), deficit.toFixed(2), deficit.toFixed(2), deadlineDate.toISOString().split('T')[0]]
        );
        logged++;
      }
    }

    return res.json({ message: `Logged deficits for ${logged} users`, week: lastWeekStart });
  } catch (err) {
    console.error('Log weekly deficit error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
