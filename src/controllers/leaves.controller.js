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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Normalise a date input to 'YYYY-MM-DD' (or null if invalid). */
function toDateStr(v) {
  if (!v) return null;
  const s = String(v).slice(0, 10);
  if (!DATE_RE.test(s)) return null;
  return Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()) ? null : s;
}

/**
 * Count working days between two dates (inclusive).
 * Sundays and full company holidays are not counted.
 */
async function countWorkingDays(conn, from, to) {
  let holidays = new Set();
  try {
    const [rows] = await conn.query(
      "SELECT date FROM company_holidays WHERE date BETWEEN ? AND ? AND holiday_type = 'full_holiday'",
      [from, to]
    );
    holidays = new Set(rows.map((r) => String(r.date).slice(0, 10)));
  } catch (err) {
    console.error('countWorkingDays holiday lookup failed (ignored):', err.message);
  }

  let count = 0;
  const cur = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cur <= end) {
    const key = cur.toISOString().slice(0, 10);
    if (cur.getUTCDay() !== 0 && !holidays.has(key)) count += 1;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

/**
 * Adjust the balance for a leave. Unpaid leave never touches balances.
 * `delta` is positive to deduct (approve) and negative to restore (cancel).
 * The balance year is always the year of the leave's from_date.
 */
async function adjustBalance(conn, leave, delta) {
  if (leave.leave_type === 'unpaid') return;
  const fromStr = String(leave.from_date).slice(0, 10);
  const year = Number(fromStr.slice(0, 4));
  if (delta > 0) {
    await conn.query(
      `INSERT INTO leave_balances (user_id, leave_type, total, used, year)
       VALUES (?, ?, 12, ?, ?)
       ON DUPLICATE KEY UPDATE used = used + VALUES(used)`,
      [leave.user_id, leave.leave_type, delta, year]
    );
  } else {
    await conn.query(
      `UPDATE leave_balances SET used = GREATEST(used + ?, 0)
       WHERE user_id = ? AND leave_type = ? AND year = ?`,
      [delta, leave.user_id, leave.leave_type, year]
    );
  }
}

/** Run fn(conn) inside a transaction. */
async function withTransaction(fn) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
}

/** Error carrying an HTTP status, thrown inside transactions. */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendError(res, err, label) {
  if (err instanceof HttpError) return res.status(err.status).json({ message: err.message });
  console.error(`${label}:`, err);
  return res.status(500).json({ message: 'Server error' });
}

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
      const s = `%${String(search).replace(/[\\%_]/g, '\\$&')}%`;
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

    await withTransaction(async (conn) => {
      // Lock the row so two simultaneous approvals cannot both deduct the balance
      const [rows] = await conn.query('SELECT * FROM leaves WHERE id = ? AND deleted = 0 FOR UPDATE', [id]);
      if (!rows.length) throw new HttpError(404, 'Leave not found');
      const leave = rows[0];
      if (leave.status !== 'pending') throw new HttpError(400, 'Only pending leaves can be approved');
      if (leave.user_id === req.user.id && !req.user.is_admin) {
        throw new HttpError(403, 'You cannot approve your own leave');
      }

      // Two-step approval: the tagged Head must approve before HR / Admin.
      // Exception: if the tagged Head's account is no longer active, HR can proceed.
      if (leave.head_status === 'pending') {
        const [coord] = await conn.query(
          'SELECT id FROM users WHERE id = ? AND deleted = 0 AND is_active = 1',
          [leave.coordinator_id]
        );
        if (coord.length) {
          throw new HttpError(400, "Waiting for the Head's approval before HR can approve this leave");
        }
      }

      await conn.query(
        "UPDATE leaves SET status = 'approved', approved_by = ?, remarks = ?, updated_at = NOW() WHERE id = ?",
        [req.user.id, remarks || null, id]
      );
      await adjustBalance(conn, leave, Number(leave.days));
    });

    await notifyLeave(Number(id), 'approved', req.user.id);
    res.emitSocket('leaves:updated', { id, status: 'approved' });
    return res.json({ message: 'Leave approved' });
  } catch (err) {
    return sendError(res, err, 'Approve leave error');
  }
};

/**
 * PUT /api/leaves/:id/cancel
 * The employee (own leave) or HR / Admin cancels a pending or approved leave.
 * An approved leave gets its balance restored.
 */
exports.cancel = async (req, res) => {
  try {
    const { id } = req.params;
    const isHr = await hasLeavesAllAccess(req.user);

    await withTransaction(async (conn) => {
      const [rows] = await conn.query('SELECT * FROM leaves WHERE id = ? AND deleted = 0 FOR UPDATE', [id]);
      if (!rows.length) throw new HttpError(404, 'Leave not found');
      const leave = rows[0];

      if (!isHr && leave.user_id !== req.user.id) {
        throw new HttpError(403, 'You can only cancel your own leave');
      }
      if (leave.status !== 'pending' && leave.status !== 'approved') {
        throw new HttpError(400, 'Only pending or approved leaves can be cancelled');
      }

      await conn.query("UPDATE leaves SET status = 'cancelled', updated_at = NOW() WHERE id = ?", [id]);
      if (leave.status === 'approved') {
        await adjustBalance(conn, leave, -Number(leave.days));
      }
    });

    res.emitSocket('leaves:updated', { id, status: 'cancelled' });
    return res.json({ message: 'Leave cancelled' });
  } catch (err) {
    return sendError(res, err, 'Cancel leave error');
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

    if (!['casual', 'sick', 'earned', 'unpaid'].includes(leave_type)) {
      return res.status(400).json({ message: 'Invalid leave type' });
    }

    const fromStr = toDateStr(from_date);
    const toStr = toDateStr(to_date);
    if (!fromStr || !toStr || toStr < fromStr) {
      return res.status(400).json({ message: 'Invalid date range' });
    }

    if (leaveDuration !== 'full_day' && fromStr !== toStr) {
      return res.status(400).json({ message: 'Half-day leave can only be applied for a single day' });
    }

    // Tag the employee's Head (when unambiguous) so it shows in their planning view.
    const heads = await getHeadsOfUser(user_id);
    const coordinatorId = heads.length === 1 ? heads[0].id : null;

    const insertId = await withTransaction(async (conn) => {
      const workingDays = await countWorkingDays(conn, fromStr, toStr);
      if (workingDays <= 0) {
        throw new HttpError(400, 'The selected dates have no working days (Sundays / holidays only)');
      }
      const days = leaveDuration !== 'full_day' ? 0.5 : workingDays;

      // Reject overlaps with the employee's existing pending / approved leaves
      const [overlap] = await conn.query(
        `SELECT id FROM leaves
         WHERE user_id = ? AND deleted = 0 AND status IN ('pending', 'approved')
           AND from_date <= ? AND to_date >= ?
         LIMIT 1 FOR UPDATE`,
        [user_id, toStr, fromStr]
      );
      if (overlap.length) {
        throw new HttpError(409, 'This employee already has a leave overlapping these dates');
      }

      // Insert as approved directly
      const [result] = await conn.query(
        `INSERT INTO leaves (user_id, leave_type, from_date, to_date, duration, days, reason, status, approved_by, coordinator_id, head_status, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, 'not_required', NOW())`,
        [user_id, leave_type, fromStr, toStr, leaveDuration, days, String(reason).trim(), req.user.id, coordinatorId]
      );
      await adjustBalance(conn, { user_id, leave_type, from_date: fromStr }, days);
      return result.insertId;
    });

    await notifyLeave(insertId, 'approved', req.user.id);
    res.emitSocket('leaves:updated', { id: insertId, status: 'approved' });
    return res.status(201).json({ message: 'Leave applied and approved successfully', id: insertId });
  } catch (err) {
    return sendError(res, err, 'Admin apply leave error');
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
