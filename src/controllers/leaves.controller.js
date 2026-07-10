const db = require('../config/db');

/**
 * GET /api/leaves
 * Admin: get all leave requests with filters
 * Employee: get own leave requests
 */
exports.list = async (req, res) => {
  try {
    const { status, search } = req.query;
    const isAdmin = req.user.is_admin;

    let sql = `
      SELECT l.*, 
             CONCAT(u.first_name, ' ', u.last_name) AS employee_name,
             u.department, u.designation,
             CONCAT(a.first_name, ' ', a.last_name) AS approved_by_name
      FROM leaves l
      INNER JOIN users u ON u.id = l.user_id
      LEFT JOIN users a ON a.id = l.approved_by
      WHERE l.deleted = 0
    `;
    const params = [];

    if (!isAdmin) {
      sql += ' AND l.user_id = ?';
      params.push(req.user.id);
    }

    if (status && status !== 'all') {
      sql += ' AND l.status = ?';
      params.push(status);
    }

    if (search) {
      sql += " AND (u.first_name LIKE ? OR u.last_name LIKE ? OR CONCAT(u.first_name, ' ', u.last_name) LIKE ?)";
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    sql += ' ORDER BY l.created_at DESC';

    const [rows] = await db.query(sql, params);
    return res.json(rows);
  } catch (err) {
    console.error('Leaves list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/leaves/stats
 * Admin stats for leave dashboard
 */
exports.stats = async (req, res) => {
  try {
    const [pending] = await db.query(
      "SELECT COUNT(*) as count FROM leaves WHERE status = 'pending' AND deleted = 0"
    );
    const [approvedMonth] = await db.query(
      "SELECT COUNT(*) as count FROM leaves WHERE status = 'approved' AND deleted = 0 AND MONTH(updated_at) = MONTH(CURDATE()) AND YEAR(updated_at) = YEAR(CURDATE())"
    );
    const [rejectedMonth] = await db.query(
      "SELECT COUNT(*) as count FROM leaves WHERE status = 'rejected' AND deleted = 0 AND MONTH(updated_at) = MONTH(CURDATE()) AND YEAR(updated_at) = YEAR(CURDATE())"
    );
    const [totalDays] = await db.query(
      "SELECT COALESCE(SUM(days), 0) as total FROM leaves WHERE status = 'approved' AND deleted = 0 AND MONTH(from_date) = MONTH(CURDATE()) AND YEAR(from_date) = YEAR(CURDATE())"
    );

    return res.json({
      pending: pending[0].count,
      approved_this_month: approvedMonth[0].count,
      rejected_this_month: rejectedMonth[0].count,
      total_days_this_month: totalDays[0].total,
    });
  } catch (err) {
    console.error('Leaves stats error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/leaves/:id/approve
 * Admin approves a leave
 */
exports.approve = async (req, res) => {
  try {
    const { id } = req.params;
    const { remarks } = req.body;

    const [rows] = await db.query('SELECT * FROM leaves WHERE id = ? AND deleted = 0', [id]);
    if (!rows.length) return res.status(404).json({ message: 'Leave not found' });
    if (rows[0].status !== 'pending') {
      return res.status(400).json({ message: 'Only pending leaves can be approved' });
    }

    await db.query(
      "UPDATE leaves SET status = 'approved', approved_by = ?, remarks = ?, updated_at = NOW() WHERE id = ?",
      [req.user.id, remarks || null, id]
    );

    // Update leave balance
    const leave = rows[0];
    await db.query(
      `INSERT INTO leave_balances (user_id, leave_type, total, used, year)
       VALUES (?, ?, 12, ?, YEAR(CURDATE()))
       ON DUPLICATE KEY UPDATE used = used + ?`,
      [leave.user_id, leave.leave_type === 'unpaid' ? 'casual' : leave.leave_type, leave.days, leave.days]
    );

    res.emitSocket('leaves:updated', { id, status: 'approved' });
    return res.json({ message: 'Leave approved' });
  } catch (err) {
    console.error('Approve leave error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/leaves/admin-apply
 * Admin applies leave on behalf of an employee (auto-approved, allows past dates)
 */
exports.adminApply = async (req, res) => {
  try {
    const { user_id, leave_type, from_date, to_date, duration, reason } = req.body;
    if (!user_id || !leave_type || !from_date || !to_date || !reason) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    // Validate user exists
    const [users] = await db.query('SELECT id FROM users WHERE id = ? AND deleted = 0', [user_id]);
    if (!users.length) return res.status(404).json({ message: 'Employee not found' });

    const validDurations = ['full_day', 'first_half', 'second_half'];
    const leaveDuration = validDurations.includes(duration) ? duration : 'full_day';

    const start = new Date(from_date);
    const end = new Date(to_date);
    const fullDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;

    if (fullDays <= 0) return res.status(400).json({ message: 'Invalid date range' });

    if (leaveDuration !== 'full_day' && fullDays > 1) {
      return res.status(400).json({ message: 'Half-day leave can only be applied for a single day' });
    }

    const days = leaveDuration !== 'full_day' ? 0.5 : fullDays;

    // Insert as approved directly
    const [result] = await db.query(
      `INSERT INTO leaves (user_id, leave_type, from_date, to_date, duration, days, reason, status, approved_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', ?, NOW())`,
      [user_id, leave_type, from_date, to_date, leaveDuration, days, reason, req.user.id]
    );

    // Update leave balance
    await db.query(
      `INSERT INTO leave_balances (user_id, leave_type, total, used, year)
       VALUES (?, ?, 12, ?, YEAR(?))
       ON DUPLICATE KEY UPDATE used = used + ?`,
      [user_id, leave_type === 'unpaid' ? 'casual' : leave_type, days, from_date, days]
    );

    res.emitSocket('leaves:updated', { id: result.insertId, status: 'approved' });
    return res.status(201).json({ message: 'Leave applied and approved successfully', id: result.insertId });
  } catch (err) {
    console.error('Admin apply leave error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/leaves/:id/reject
 * Admin rejects a leave
 */
exports.reject = async (req, res) => {
  try {
    const { id } = req.params;
    const { remarks } = req.body;

    const [rows] = await db.query('SELECT * FROM leaves WHERE id = ? AND deleted = 0', [id]);
    if (!rows.length) return res.status(404).json({ message: 'Leave not found' });
    if (rows[0].status !== 'pending') {
      return res.status(400).json({ message: 'Only pending leaves can be rejected' });
    }

    await db.query(
      "UPDATE leaves SET status = 'rejected', approved_by = ?, remarks = ?, updated_at = NOW() WHERE id = ?",
      [req.user.id, remarks || null, id]
    );

    res.emitSocket('leaves:updated', { id, status: 'rejected' });
    return res.json({ message: 'Leave rejected' });
  } catch (err) {
    console.error('Reject leave error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
