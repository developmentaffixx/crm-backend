const db = require('../config/db');
const { getHeadsOfUser, notifyLeave } = require('../helpers/leaveWorkflow');

/**
 * Helper: returns true if the user is an admin OR has been granted
 * "All" submenu access on the leaves page (can_access >= 2) OR can_approve on people_ops.
 * Checks user-level overrides first, then role-level baseline.
 */
async function hasLeavesAllAccess(user) {
  if (user.is_admin) return true;
  try {
    // 1. User-level override for leaves submenu wins
    const [userOverride] = await db.query(
      'SELECT can_access FROM user_submenu_permissions WHERE user_id = ? AND module = ? AND submenu = ?',
      [user.id, 'people_ops', 'leaves']
    );
    if (userOverride.length > 0 && userOverride[0].can_access >= 2) return true;

    // 2. User-level module permission for people_ops (can_approve or can_edit)
    const [userPerm] = await db.query(
      'SELECT can_approve, can_edit FROM user_permissions WHERE user_id = ? AND module = ?',
      [user.id, 'people_ops']
    );
    if (userPerm.length > 0 && (userPerm[0].can_approve === 1 || userPerm[0].can_edit === 1)) return true;

    // 3. Role-level baseline
    const [userRole] = await db.query('SELECT role_id FROM users WHERE id = ?', [user.id]);
    if (userRole.length > 0 && userRole[0].role_id) {
      const [rolePerms] = await db.query(
        'SELECT can_access FROM role_submenu_permissions WHERE role_id = ? AND module = ? AND submenu = ?',
        [userRole[0].role_id, 'people_ops', 'leaves']
      );
      if (rolePerms.length > 0 && rolePerms[0].can_access >= 2) return true;

      const [roleModPerm] = await db.query(
        'SELECT can_approve, can_edit FROM role_permissions WHERE role_id = ? AND module = ?',
        [userRole[0].role_id, 'people_ops']
      );
      if (roleModPerm.length > 0 && (roleModPerm[0].can_approve === 1 || roleModPerm[0].can_edit === 1)) return true;
    }
  } catch (err) {
    console.error('hasLeavesAllAccess error:', err);
  }
  return false;
}

exports.hasLeavesAllAccess = hasLeavesAllAccess;

/**
 * GET /api/leaves
 * Admin / users with "All" submenu access: get all leave requests with filters
 * Employee: get own leave requests
 */
exports.list = async (req, res) => {
  try {
    const { status, search } = req.query;
    const isAdmin = await hasLeavesAllAccess(req.user);

    let sql = `
      SELECT l.*, 
             CONCAT(u.first_name, ' ', u.last_name) AS employee_name,
             u.department, u.designation,
             CONCAT(a.first_name, ' ', a.last_name) AS approved_by_name,
             CONCAT(c.first_name, ' ', c.last_name) AS coordinator_name,
             c.email AS coordinator_email
      FROM leaves l
      INNER JOIN users u ON u.id = l.user_id
      LEFT JOIN users a ON a.id = l.approved_by
      LEFT JOIN users c ON c.id = l.coordinator_id
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

    // Two-step approval: the tagged Head must approve before HR / Admin.
    // Exception: if the tagged Head's account is no longer active, HR can proceed.
    if (rows[0].head_status === 'pending') {
      const [coord] = await db.query(
        'SELECT id FROM users WHERE id = ? AND deleted = 0 AND is_active = 1',
        [rows[0].coordinator_id]
      );
      if (coord.length) {
        return res.status(400).json({ message: 'Waiting for the Head\'s approval before HR can approve this leave' });
      }
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

    await notifyLeave(Number(id), 'approved', req.user.id);
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
    // Tag the employee's Head (when unambiguous) so it shows in their planning view.
    const heads = await getHeadsOfUser(user_id);
    const coordinatorId = heads.length === 1 ? heads[0].id : null;

    const [result] = await db.query(
      `INSERT INTO leaves (user_id, leave_type, from_date, to_date, duration, days, reason, status, approved_by, coordinator_id, head_status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, 'not_required', NOW())`,
      [user_id, leave_type, from_date, to_date, leaveDuration, days, reason, req.user.id, coordinatorId]
    );

    // Update leave balance
    await db.query(
      `INSERT INTO leave_balances (user_id, leave_type, total, used, year)
       VALUES (?, ?, 12, ?, YEAR(?))
       ON DUPLICATE KEY UPDATE used = used + ?`,
      [user_id, leave_type === 'unpaid' ? 'casual' : leave_type, days, from_date, days]
    );

    await notifyLeave(result.insertId, 'approved', req.user.id);
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

    await notifyLeave(Number(id), 'rejected', req.user.id);
    res.emitSocket('leaves:updated', { id, status: 'rejected' });
    return res.json({ message: 'Leave rejected' });
  } catch (err) {
    console.error('Reject leave error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/leaves/:id/head-approve  |  PUT /api/leaves/:id/head-reject
 * Step 1 of the two-step approval. Only the Head tagged on the leave may act.
 *   approve → head_status = 'approved' (HR / Admin can now give the final approval)
 *   reject  → leave is rejected (final); HR / Admin and the employee are notified
 */
function headDecision(action) {
  return async (req, res) => {
    try {
      const { id } = req.params;
      const { remarks } = req.body || {};

      const [rows] = await db.query('SELECT * FROM leaves WHERE id = ? AND deleted = 0', [id]);
      if (!rows.length) return res.status(404).json({ message: 'Leave not found' });
      const leave = rows[0];

      if (!leave.coordinator_id || leave.coordinator_id !== req.user.id) {
        return res.status(403).json({ message: 'Only the tagged Head can action this leave' });
      }
      if (leave.status !== 'pending' || leave.head_status !== 'pending') {
        return res.status(400).json({ message: 'This leave is not waiting for Head approval' });
      }

      if (action === 'approve') {
        await db.query(
          "UPDATE leaves SET head_status = 'approved', head_actioned_by = ?, head_remarks = ?, head_actioned_at = NOW(), updated_at = NOW() WHERE id = ?",
          [req.user.id, remarks || null, id]
        );
        await notifyLeave(Number(id), 'head_approved', req.user.id);
        res.emitSocket('leaves:updated', { id, status: 'pending' });
        return res.json({ message: 'Approved. Sent to HR for final approval' });
      }

      await db.query(
        "UPDATE leaves SET status = 'rejected', head_status = 'rejected', head_actioned_by = ?, head_remarks = ?, head_actioned_at = NOW(), approved_by = ?, remarks = ?, updated_at = NOW() WHERE id = ?",
        [req.user.id, remarks || null, req.user.id, remarks || null, id]
      );
      await notifyLeave(Number(id), 'head_rejected', req.user.id);
      res.emitSocket('leaves:updated', { id, status: 'rejected' });
      return res.json({ message: 'Leave rejected' });
    } catch (err) {
      console.error('Head decision error:', err);
      return res.status(500).json({ message: 'Server error' });
    }
  };
}
exports.headApprove = headDecision('approve');
exports.headReject = headDecision('reject');

/**
 * GET /api/leaves/team
 * Leaves tagged to the logged-in Head: pending, approved, rejected, cancelled
 * (last 60 days and all upcoming). `overlaps` = how many other tagged members
 * are also on leave (pending or approved) during the same dates.
 */
exports.team = async (req, res) => {
  try {
    const [head] = await db.query(
      "SELECT 1 FROM team_members WHERE user_id = ? AND role = 'head' LIMIT 1",
      [req.user.id]
    );
    const [rows] = await db.query(
      `SELECT l.*, CONCAT(u.first_name, ' ', u.last_name) AS employee_name,
              u.department, u.designation
       FROM leaves l
       JOIN users u ON u.id = l.user_id
       WHERE l.deleted = 0 AND l.coordinator_id = ?
         AND l.to_date >= DATE_SUB(CURDATE(), INTERVAL 60 DAY)
       ORDER BY l.from_date ASC
       LIMIT 300`,
      [req.user.id]
    );

    const active = rows.filter((r) => r.status === 'pending' || r.status === 'approved');
    const leaves = rows.map((r) => {
      let overlaps = 0;
      if (r.status === 'pending' || r.status === 'approved') {
        overlaps = active.filter(
          (o) => o.id !== r.id && o.user_id !== r.user_id && o.from_date <= r.to_date && o.to_date >= r.from_date
        ).length;
      }
      return { ...r, overlaps };
    });

    return res.json({ is_head: head.length > 0, leaves });
  } catch (err) {
    console.error('Team leaves error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
