const { validationResult } = require('express-validator');
const db = require('../config/db');
const {
  canApproveTasks, canApproveTickets, getTeamScopeForHead,
  isTopApprover, isCeoUser, getHeadUserIds, headNeedsTopApproval,
} = require('../middleware/auth');

// Helper: Log to task_activity_log
async function logActivity(taskId, userId, action, { field_name, old_value, new_value, note } = {}) {
  try {
    await db.query(
      `INSERT INTO task_activity_log (task_id, user_id, action, field_name, old_value, new_value, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [taskId, userId, action, field_name || null, old_value || null, new_value || null, note || null]
    );
  } catch (err) {
    console.error('Activity log error:', err);
  }
}

// A forward request raised by a Head on a task assigned to themselves must be
// approved by Admin / CEO (instead of the recipient simply accepting).
async function forwardNeedsTopApproval(fwd) {
  const [rows] = await db.query('SELECT assigned_to FROM tasks WHERE id = ?', [fwd.task_id]);
  if (rows.length === 0) return false;
  if (rows[0].assigned_to !== fwd.forwarded_by) return false;
  return (await getHeadUserIds()).has(fwd.forwarded_by);
}

// ─────────────────────────────────────────────────────────────────────────────
// EXTENSION REQUESTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/approvals/extensions
 */
exports.createExtension = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array(), message: errors.array()[0]?.msg });

  const { task_id, requested_deadline, reason } = req.body;

  try {
    // Verify task exists and is active
    const [tasks] = await db.query(
      'SELECT * FROM tasks WHERE id = ? AND deleted = 0',
      [task_id]
    );
    if (tasks.length === 0) return res.status(404).json({ message: 'Task not found' });

    const task = tasks[0];
    if (task.is_active !== 1) {
      return res.status(400).json({ message: 'Can only request extension for active tasks' });
    }

    // Block duplicate pending extension
    const [existing] = await db.query(
      "SELECT id FROM task_deadline_extension_requests WHERE task_id = ? AND status = 'pending' AND deleted = 0",
      [task_id]
    );
    if (existing.length > 0) {
      return res.status(409).json({ message: 'A pending extension request already exists for this task' });
    }

    // A Head requesting an extension on their own task needs Admin/CEO approval.
    const headSelf = await headNeedsTopApproval(req.user, task.assigned_to);
    const canApprove = !headSelf && (req.user.is_admin || (await canApproveTasks(req.user)));
    const initialStatus = canApprove ? 'approved' : 'pending';

    const [result] = await db.query(
      'INSERT INTO task_deadline_extension_requests (task_id, requested_by, requested_deadline, reason, status, actioned_by) VALUES (?, ?, ?, ?, ?, ?)',
      [task_id, req.user.id, requested_deadline, reason, initialStatus, canApprove ? req.user.id : null]
    );

    if (canApprove) {
      await db.query('UPDATE tasks SET deadline = ? WHERE id = ?', [requested_deadline, task_id]);
      await logActivity(task_id, req.user.id, 'extension_approved', {
        note: `Deadline updated directly by manager to ${new Date(requested_deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}${reason ? ' — Reason: ' + reason : ''}`
      });
    } else {
      // Log to task activity
      await logActivity(task_id, req.user.id, 'extension_requested', {
        note: `Requested new deadline: ${new Date(requested_deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}${reason ? ' — Reason: ' + reason : ''}`
      });
    }

    const [rows] = await db.query(
      `SELECT er.*, t.title AS task_title,
              CONCAT(u.first_name, ' ', u.last_name) AS requested_by_name
       FROM task_deadline_extension_requests er
       LEFT JOIN tasks t ON t.id = er.task_id
       LEFT JOIN users u ON u.id = er.requested_by
       WHERE er.id = ?`,
      [result.insertId]
    );

    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Create extension error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/approvals/extensions/:id/approve  (admin)
 */
exports.approveExtension = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM task_deadline_extension_requests WHERE id = ? AND deleted = 0',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Extension request not found' });

    const ext = rows[0];
    if (ext.status !== 'pending') {
      return res.status(400).json({ message: 'Only pending requests can be approved' });
    }

    // Update request status and task deadline
    await db.query(
      "UPDATE task_deadline_extension_requests SET status = 'approved', actioned_by = ? WHERE id = ?",
      [req.user.id, ext.id]
    );
    await db.query(
      'UPDATE tasks SET deadline = ? WHERE id = ?',
      [ext.requested_deadline, ext.task_id]
    );

    // Log to task activity
    await logActivity(ext.task_id, req.user.id, 'extension_approved', {
      note: `Deadline extended to ${new Date(ext.requested_deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
    });

    res.emitSocket('approvals:updated', { id: req.params.id, type: 'extension', status: 'approved', new_deadline: ext.requested_deadline });
    return res.json({ message: 'Extension approved', new_deadline: ext.requested_deadline });
  } catch (err) {
    console.error('Approve extension error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/approvals/extensions/:id/reject  (admin)
 */
exports.rejectExtension = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM task_deadline_extension_requests WHERE id = ? AND deleted = 0',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Extension request not found' });

    const ext = rows[0];
    if (ext.status !== 'pending') {
      return res.status(400).json({ message: 'Only pending requests can be rejected' });
    }

    await db.query(
      "UPDATE task_deadline_extension_requests SET status = 'rejected', actioned_by = ? WHERE id = ?",
      [req.user.id, ext.id]
    );

    // Log to task activity
    await logActivity(ext.task_id, req.user.id, 'extension_rejected', {
      note: `Extension request rejected`
    });

    res.emitSocket('approvals:updated', { id: req.params.id, type: 'extension', status: 'rejected' });
    return res.json({ message: 'Extension rejected' });
  } catch (err) {
    console.error('Reject extension error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * DELETE /api/approvals/extensions/:id/cancel  (team member cancels own pending)
 */
exports.cancelExtension = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM task_deadline_extension_requests WHERE id = ? AND deleted = 0',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Extension request not found' });

    const ext = rows[0];

    // Ownership check
    if (ext.requested_by !== req.user.id) {
      return res.status(403).json({ message: 'You can only cancel your own requests' });
    }

    if (ext.status !== 'pending') {
      return res.status(400).json({ message: 'Only pending requests can be cancelled' });
    }

    await db.query(
      'UPDATE task_deadline_extension_requests SET deleted = 1 WHERE id = ?',
      [ext.id]
    );

    return res.json({ message: 'Extension request cancelled' });
  } catch (err) {
    console.error('Cancel extension error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// CLOSE REQUESTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/approvals/closes
 * Team member requests that an overdue task be marked closed.
 */
exports.createCloseRequest = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { task_id, reason } = req.body;

  try {
    const [tasks] = await db.query(
      'SELECT * FROM tasks WHERE id = ? AND deleted = 0',
      [task_id]
    );
    if (tasks.length === 0) return res.status(404).json({ message: 'Task not found' });

    const task = tasks[0];

    // Only the assignee, admin, or task approver can raise a close request
    const canApprove = req.user.is_admin || (await canApproveTasks(req.user));
    if (task.assigned_to !== req.user.id && !canApprove) {
      return res.status(403).json({ message: 'Only the assigned user or task managers can request task closure' });
    }

    // Block if task is already completed or rejected
    if ([3, 4].includes(task.is_active)) {
      return res.status(400).json({ message: 'Task is already completed or rejected' });
    }

    // Block duplicate pending close request for the same task
    const [existing] = await db.query(
      "SELECT id FROM task_close_requests WHERE task_id = ? AND status = 'pending' AND deleted = 0",
      [task_id]
    );
    if (existing.length > 0) {
      return res.status(409).json({ message: 'A pending close request already exists for this task' });
    }

    const [result] = await db.query(
      'INSERT INTO task_close_requests (task_id, requested_by, reason) VALUES (?, ?, ?)',
      [task_id, req.user.id, reason]
    );

    await logActivity(task_id, req.user.id, 'close_requested', {
      note: `Requested task closure${reason ? ' — Reason: ' + reason : ''}`
    });

    const [rows] = await db.query(
      `SELECT cr.*, t.title AS task_title,
              CONCAT(u.first_name, ' ', u.last_name) AS requested_by_name
       FROM task_close_requests cr
       LEFT JOIN tasks t ON t.id = cr.task_id
       LEFT JOIN users u ON u.id = cr.requested_by
       WHERE cr.id = ?`,
      [result.insertId]
    );

    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Create close request error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/approvals/closes/:id/approve  (admin)
 * Marks the task as completed (is_active = 3) and approves the request.
 */
exports.approveCloseRequest = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM task_close_requests WHERE id = ? AND deleted = 0',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Close request not found' });

    const cr = rows[0];
    if (cr.status !== 'pending') {
      return res.status(400).json({ message: 'Only pending requests can be approved' });
    }

    await db.query(
      "UPDATE task_close_requests SET status = 'approved', reviewed_by = ?, reviewed_at = NOW() WHERE id = ?",
      [req.user.id, cr.id]
    );

    // Mark the task as completed
    await db.query(
      'UPDATE tasks SET is_active = 3 WHERE id = ?',
      [cr.task_id]
    );

    await logActivity(cr.task_id, req.user.id, 'close_approved', {
      note: 'Close request approved — task marked as completed'
    });

    res.emitSocket('approvals:updated', { id: req.params.id, type: 'close', status: 'approved' });
    return res.json({ message: 'Close request approved, task marked as completed' });
  } catch (err) {
    console.error('Approve close request error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/approvals/closes/:id/reject  (admin)
 */
exports.rejectCloseRequest = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM task_close_requests WHERE id = ? AND deleted = 0',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Close request not found' });

    const cr = rows[0];
    if (cr.status !== 'pending') {
      return res.status(400).json({ message: 'Only pending requests can be rejected' });
    }

    const { reject_reason } = req.body;

    await db.query(
      "UPDATE task_close_requests SET status = 'rejected', reviewed_by = ?, reviewed_at = NOW(), reject_reason = ? WHERE id = ?",
      [req.user.id, reject_reason || null, cr.id]
    );

    await logActivity(cr.task_id, req.user.id, 'close_rejected', {
      note: `Close request rejected${reject_reason ? ' — ' + reject_reason : ''}`
    });

    res.emitSocket('approvals:updated', { id: req.params.id, type: 'close', status: 'rejected' });
    return res.json({ message: 'Close request rejected' });
  } catch (err) {
    console.error('Reject close request error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * DELETE /api/approvals/closes/:id/cancel  (team member cancels own pending)
 */
exports.cancelCloseRequest = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM task_close_requests WHERE id = ? AND deleted = 0',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Close request not found' });

    const cr = rows[0];

    if (cr.requested_by !== req.user.id) {
      return res.status(403).json({ message: 'You can only cancel your own requests' });
    }

    if (cr.status !== 'pending') {
      return res.status(400).json({ message: 'Only pending requests can be cancelled' });
    }

    await db.query(
      'UPDATE task_close_requests SET deleted = 1 WHERE id = ?',
      [cr.id]
    );

    return res.json({ message: 'Close request cancelled' });
  } catch (err) {
    console.error('Cancel close request error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// FORWARD REQUESTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/approvals/forwards
 */
exports.createForward = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { task_id, forwarded_to } = req.body;

  try {
    const [tasks] = await db.query(
      'SELECT * FROM tasks WHERE id = ? AND deleted = 0',
      [task_id]
    );
    if (tasks.length === 0) return res.status(404).json({ message: 'Task not found' });

    const task = tasks[0];

    // Block forwarding to self
    if (forwarded_to === req.user.id || forwarded_to == req.user.id) {
      return res.status(400).json({ message: 'You cannot forward a task to yourself' });
    }

    // Block forwarding to current assignee
    if (forwarded_to === task.assigned_to || forwarded_to == task.assigned_to) {
      return res.status(400).json({ message: 'Task is already assigned to this person' });
    }

    // Block duplicate pending forward
    const [existing] = await db.query(
      "SELECT id FROM task_forward_requests WHERE task_id = ? AND status = 'pending' AND deleted = 0",
      [task_id]
    );
    if (existing.length > 0) {
      return res.status(409).json({ message: 'A pending forward request already exists for this task' });
    }

    const [result] = await db.query(
      'INSERT INTO task_forward_requests (task_id, forwarded_by, forwarded_to) VALUES (?, ?, ?)',
      [task_id, req.user.id, forwarded_to]
    );

    const [rows] = await db.query(
      `SELECT fr.*, t.title AS task_title,
              CONCAT(u1.first_name, ' ', u1.last_name) AS forwarded_by_name,
              CONCAT(u2.first_name, ' ', u2.last_name) AS forwarded_to_name
       FROM task_forward_requests fr
       LEFT JOIN tasks t  ON t.id  = fr.task_id
       LEFT JOIN users u1 ON u1.id = fr.forwarded_by
       LEFT JOIN users u2 ON u2.id = fr.forwarded_to
       WHERE fr.id = ?`,
      [result.insertId]
    );

    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Create forward error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/approvals/forwards/:id/accept  (forwarded_to user accepts)
 */
exports.acceptForward = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM task_forward_requests WHERE id = ? AND deleted = 0',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Forward request not found' });

    const fwd = rows[0];

    if (await forwardNeedsTopApproval(fwd)) {
      if (!(await isTopApprover(req.user))) {
        return res.status(403).json({ message: 'This forward request needs approval from Admin or CEO' });
      }
    } else if (fwd.forwarded_to !== req.user.id && !req.user.is_admin) {
      return res.status(403).json({ message: 'Only the recipient can accept this request' });
    }

    if (fwd.status !== 'pending') {
      return res.status(400).json({ message: 'Only pending requests can be accepted' });
    }

    await db.query(
      "UPDATE task_forward_requests SET status = 'accepted' WHERE id = ?",
      [fwd.id]
    );
    await db.query(
      'UPDATE tasks SET assigned_to = ? WHERE id = ?',
      [fwd.forwarded_to, fwd.task_id]
    );

    res.emitSocket('approvals:updated', { id: req.params.id, type: 'forward', status: 'accepted' });
    return res.json({ message: 'Forward accepted, task reassigned' });
  } catch (err) {
    console.error('Accept forward error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/approvals/forwards/:id/reject  (forwarded_to user declines)
 */
exports.rejectForward = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM task_forward_requests WHERE id = ? AND deleted = 0',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Forward request not found' });

    const fwd = rows[0];

    if (await forwardNeedsTopApproval(fwd)) {
      if (!(await isTopApprover(req.user))) {
        return res.status(403).json({ message: 'This forward request needs approval from Admin or CEO' });
      }
    } else if (fwd.forwarded_to !== req.user.id && !req.user.is_admin) {
      return res.status(403).json({ message: 'Only the recipient can reject this request' });
    }

    if (fwd.status !== 'pending') {
      return res.status(400).json({ message: 'Only pending requests can be rejected' });
    }

    await db.query(
      "UPDATE task_forward_requests SET status = 'rejected' WHERE id = ?",
      [fwd.id]
    );

    res.emitSocket('approvals:updated', { id: req.params.id, type: 'forward', status: 'rejected' });
    return res.json({ message: 'Forward request declined' });
  } catch (err) {
    console.error('Reject forward error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * DELETE /api/approvals/forwards/:id/cancel  (team member cancels own pending)
 */
exports.cancelForward = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM task_forward_requests WHERE id = ? AND deleted = 0',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Forward request not found' });

    const fwd = rows[0];

    if (fwd.forwarded_by !== req.user.id) {
      return res.status(403).json({ message: 'You can only cancel your own requests' });
    }

    if (fwd.status !== 'pending') {
      return res.status(400).json({ message: 'Only pending requests can be cancelled' });
    }

    await db.query(
      'UPDATE task_forward_requests SET deleted = 1 WHERE id = ?',
      [fwd.id]
    );

    return res.json({ message: 'Forward request cancelled' });
  } catch (err) {
    console.error('Cancel forward error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// APPROVALS PAGE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/approvals
 * Admin: all pending items across all users (default: heads only; use ?member_id= to filter by a specific user).
 * Team member: only their own requests.
 */
exports.getApprovalsPage = async (req, res) => {
  try {
    const isAdmin = req.user.is_admin;
    // Admin or CEO: sees every task-related approval item (CEO approves Heads' own actions).
    const isCeo = await isCeoUser(req.user);
    const isTop = req.user.is_admin || isCeo; // view scope: Admin & CEO see everything
    const canApprove = isTop || (await canApproveTasks(req.user));
    const userId  = req.user.id;

    // Admin/CEO can pass ?member_id=X to scope the view to a specific member's requests.
    const filterMemberId = isTop && req.query.member_id ? parseInt(req.query.member_id, 10) : null;

    // Always resolve team scope — a team head who also has can_approve via their
    // role should still be treated as a scoped approver (their team only), not
    // as a global approver. Admins are the only ones who see everything.
    const teamScope = !isAdmin ? await getTeamScopeForHead(userId) : { isHead: false, memberIds: [] };
    // A head's own items are excluded here: those go to Admin/CEO, not to the head.
    const taskScopeIds = teamScope.memberIds.filter(id => id !== userId);
    const isHeadScope = teamScope.isHead && taskScopeIds.length > 0;

    let pendingTasksWhere = "t.deleted = 0 AND t.is_active IN (0, 2)";
    let extWhere          = "er.deleted = 0";
    let fwdWhere          = "fr.deleted = 0 AND fr.status = 'pending'";
    let clsWhere          = "cr.deleted = 0 AND cr.status = 'pending'";

    // Params in declaration order for each query below.
    let pendingTasksParams = [];
    let extParams = [];
    let fwdParams = [];
    let clsParams = [];

    // Subquery fragment: excludes tasks assigned to plain team members (role='member').
    // Used for the admin default view — same logic as the Tasks list page.
    const excludeMembersFragment = `(
        t.assigned_to IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM team_members tm_excl
          JOIN teams t_excl ON t_excl.id = tm_excl.team_id AND t_excl.deleted = 0
          WHERE tm_excl.user_id = t.assigned_to AND tm_excl.role = 'member'
        )
      )`;

    if (isTop && filterMemberId) {
      // Admin/CEO filtered to a specific member: scope all queries to that user.
      pendingTasksWhere += ' AND (t.assigned_to = ? OR t.created_by = ?)';
      pendingTasksParams = [filterMemberId, filterMemberId];
      extWhere += ' AND er.requested_by = ?';
      extParams = [filterMemberId];
      fwdWhere += ' AND (fr.forwarded_by = ? OR fr.forwarded_to = ?)';
      fwdParams = [filterMemberId, filterMemberId];
      clsWhere += ' AND cr.requested_by = ?';
      clsParams = [filterMemberId];
    } else if (isTop) {
      // Admin/CEO default view: hide tasks assigned to plain team members — show heads/teamless only.
      pendingTasksWhere += ` AND ${excludeMembersFragment}`;
      // For ext/fwd/cls: join back to the task to apply the same assignee filter.
      extWhere += ` AND EXISTS (SELECT 1 FROM tasks te WHERE te.id = er.task_id AND ${excludeMembersFragment.replace(/\bt\./g, 'te.')})`;
      fwdWhere += ` AND EXISTS (SELECT 1 FROM tasks tf WHERE tf.id = fr.task_id AND ${excludeMembersFragment.replace(/\bt\./g, 'tf.')})`;
      clsWhere += ` AND EXISTS (SELECT 1 FROM tasks tc WHERE tc.id = cr.task_id AND ${excludeMembersFragment.replace(/\bt\./g, 'tc.')})`;
    } else if (!isTop) {
      if (isHeadScope) {
        // Head: scope by the task's assignee being a team member (excluding the head).
        // This applies even if the head has can_approve via their role —
        // a head is a scoped approver for their team only, not globally.
        const mp = taskScopeIds.map(() => '?').join(',');
        pendingTasksWhere += ` AND t.assigned_to IN (${mp})`;
        pendingTasksParams = [...taskScopeIds];
        extWhere += ` AND EXISTS (SELECT 1 FROM tasks te WHERE te.id = er.task_id AND te.assigned_to IN (${mp}))`;
        extParams = [...taskScopeIds];
        fwdWhere += ` AND EXISTS (SELECT 1 FROM tasks tf WHERE tf.id = fr.task_id AND tf.assigned_to IN (${mp}))`;
        fwdParams = [...taskScopeIds];
        clsWhere += ` AND EXISTS (SELECT 1 FROM tasks tc WHERE tc.id = cr.task_id AND tc.assigned_to IN (${mp}))`;
        clsParams = [...taskScopeIds];
      } else {
        // Plain user (no team head role): only their own items.
        pendingTasksWhere += ' AND (t.created_by = ? OR t.assigned_to = ?)';
        pendingTasksParams = [userId, userId];
        extWhere += ' AND er.requested_by = ?';
        extParams = [userId];
        fwdWhere += ' AND (fr.forwarded_by = ? OR fr.forwarded_to = ?)';
        fwdParams = [userId, userId];
        clsWhere += ' AND cr.requested_by = ?';
        clsParams = [userId];
      }
    }
    // else: isAdmin && !filterMemberId → apply heads-only filter above (excludeMembersFragment)

    const scopeParams2 = pendingTasksParams;
    const scopeParams1 = extParams;

    const [pendingTasks] = await db.query(
      `SELECT t.id, t.task_id_code, t.title, t.is_active, t.deadline, t.priority,
              t.assigned_to AS assigned_to_id, t.created_by,
              (SELECT p.title FROM project_tasks pt JOIN projects p ON p.id = pt.project_id AND p.deleted = 0 WHERE pt.task_id = t.id LIMIT 1) AS project_name,
              CONCAT(u.first_name, ' ', u.last_name) AS assigned_to_name
       FROM tasks t
       LEFT JOIN users u ON u.id = t.assigned_to
       WHERE ${pendingTasksWhere}
       ORDER BY t.created_at DESC`,
      scopeParams2
    );

    const [extensions] = await db.query(
      `SELECT er.*, t.title AS task_title, t.task_id_code,
              (SELECT p.title FROM project_tasks pt JOIN projects p ON p.id = pt.project_id AND p.deleted = 0 WHERE pt.task_id = t.id LIMIT 1) AS project_name,
              CONCAT(u.first_name, ' ', u.last_name) AS requested_by_name
       FROM task_deadline_extension_requests er
       LEFT JOIN tasks t ON t.id = er.task_id
       LEFT JOIN users u ON u.id = er.requested_by
       WHERE ${extWhere}
       ORDER BY er.created_at DESC`,
      scopeParams1
    );

    const [forwards] = await db.query(
      `SELECT fr.*, t.title AS task_title, t.task_id_code,
              (SELECT p.title FROM project_tasks pt JOIN projects p ON p.id = pt.project_id AND p.deleted = 0 WHERE pt.task_id = t.id LIMIT 1) AS project_name,
              CONCAT(u1.first_name, ' ', u1.last_name) AS forwarded_by_name,
              CONCAT(u2.first_name, ' ', u2.last_name) AS forwarded_to_name
       FROM task_forward_requests fr
       LEFT JOIN tasks t  ON t.id  = fr.task_id
       LEFT JOIN users u1 ON u1.id = fr.forwarded_by
       LEFT JOIN users u2 ON u2.id = fr.forwarded_to
       WHERE ${fwdWhere}
       ORDER BY fr.created_at DESC`,
      fwdParams
    );

    const [closeRequests] = await db.query(
      `SELECT cr.*, t.title AS task_title, t.deadline, t.task_id_code,
              (SELECT p.title FROM project_tasks pt JOIN projects p ON p.id = pt.project_id AND p.deleted = 0 WHERE pt.task_id = t.id LIMIT 1) AS project_name,
              CONCAT(u.first_name, ' ', u.last_name) AS requested_by_name
       FROM task_close_requests cr
       LEFT JOIN tasks t ON t.id = cr.task_id
       LEFT JOIN users u ON u.id = cr.requested_by
       WHERE ${clsWhere}
       ORDER BY cr.created_at DESC`,
      clsParams
    );

    // Ticket approval scope is independent of task approval.
    // A team head sees ticket items ASSIGNED TO a team member;
    // a plain user sees only their own (assigned-to or reported-by them).
    // Admins see everything — same pattern as tasks above.
    const canApproveTicket = isTop || (await canApproveTickets(req.user));
    // A head's own tickets go to Admin/CEO, so exclude the head from their own ticket scope.
    const ticketScopeIds = teamScope.memberIds.filter(id => id !== userId);
    const ticketHeadScope = !isTop && teamScope.isHead && ticketScopeIds.length > 0;
    const tmp = ticketHeadScope ? ticketScopeIds.map(() => '?').join(',') : '';

    let pendingTicketsWhere = "tk.deleted = 0 AND tk.status = 'pending_done'";
    let pendingTicketsParams = [];
    if (isTop && filterMemberId) {
      pendingTicketsWhere += ' AND (tk.assigned_to = ? OR tk.reported_by = ?)';
      pendingTicketsParams = [filterMemberId, filterMemberId];
    } else if (isTop) {
      // Admin/CEO default: exclude tickets assigned to plain team members
      pendingTicketsWhere += ` AND (
        tk.assigned_to IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM team_members tm_excl
          JOIN teams t_excl ON t_excl.id = tm_excl.team_id AND t_excl.deleted = 0
          WHERE tm_excl.user_id = tk.assigned_to AND tm_excl.role = 'member'
        )
      )`;
    } else if (!isAdmin) {
      if (ticketHeadScope) {
        pendingTicketsWhere += ` AND tk.assigned_to IN (${tmp})`;
        pendingTicketsParams = [...ticketScopeIds];
      } else {
        pendingTicketsWhere += ' AND (tk.assigned_to = ? OR tk.reported_by = ?)';
        pendingTicketsParams = [userId, userId];
      }
    }
    const [pendingTickets] = await db.query(
      `SELECT tk.id, tk.title, tk.status, tk.due_date, tk.priority, tk.mode,
              tk.assigned_to AS assigned_to_id, tk.marked_done_by,
              CONCAT(u.first_name, ' ', u.last_name) AS assigned_to_name,
              CONCAT(u2.first_name, ' ', u2.last_name) AS marked_done_by_name
       FROM tickets tk
       LEFT JOIN users u ON u.id = tk.assigned_to
       LEFT JOIN users u2 ON u2.id = tk.marked_done_by
       WHERE ${pendingTicketsWhere}
       ORDER BY tk.marked_done_at DESC`,
      pendingTicketsParams
    );

    let ticketExtWhere = "ter.deleted = 0 AND ter.status = 'pending'";
    let ticketExtParams = [];
    if (isTop && filterMemberId) {
      ticketExtWhere += ' AND ter.requested_by = ?';
      ticketExtParams = [filterMemberId];
    } else if (isTop) {
      // Admin default: exclude extensions on tickets assigned to plain team members
      ticketExtWhere += ` AND EXISTS (
        SELECT 1 FROM tickets tke
        WHERE tke.id = ter.ticket_id
          AND (
            tke.assigned_to IS NULL
            OR NOT EXISTS (
              SELECT 1 FROM team_members tm_excl
              JOIN teams t_excl ON t_excl.id = tm_excl.team_id AND t_excl.deleted = 0
              WHERE tm_excl.user_id = tke.assigned_to AND tm_excl.role = 'member'
            )
          )
      )`;
    } else if (!isAdmin) {
      if (ticketHeadScope) {
        ticketExtWhere += ` AND EXISTS (SELECT 1 FROM tickets tke WHERE tke.id = ter.ticket_id AND tke.assigned_to IN (${tmp}))`;
        ticketExtParams = [...ticketScopeIds];
      } else {
        ticketExtWhere += ' AND ter.requested_by = ?';
        ticketExtParams = [userId];
      }
    }
    const [ticketExtensions] = await db.query(
      `SELECT ter.*, tk.title AS ticket_title, tk.assigned_to AS ticket_assigned_to,
              CONCAT(u.first_name, ' ', u.last_name) AS requested_by_name
       FROM ticket_deadline_extension_requests ter
       LEFT JOIN tickets tk ON tk.id = ter.ticket_id
       LEFT JOIN users u ON u.id = ter.requested_by
       WHERE ${ticketExtWhere}
       ORDER BY ter.created_at DESC`,
      ticketExtParams
    );

    // Flag items that are a Head's own action — only Admin/CEO can action these.
    const headIds = await getHeadUserIds();
    const taskAssignee = {};
    if (extensions.length || forwards.length || closeRequests.length) {
      const ids = [...new Set([...extensions, ...forwards, ...closeRequests].map(r => r.task_id))];
      const [ta] = await db.query('SELECT id, assigned_to FROM tasks WHERE id IN (?)', [ids]);
      ta.forEach(r => { taskAssignee[r.id] = r.assigned_to; });
    }
    const flag = (rows, requesterKey) => rows.map(r => ({
      ...r,
      requires_top_approval: headIds.has(r[requesterKey]) && taskAssignee[r.task_id] === r[requesterKey],
    }));
    const flaggedTasks = pendingTasks.map(t => ({
      ...t,
      requires_top_approval: headIds.has(t.assigned_to_id) && (t.is_active === 2 || t.created_by === t.assigned_to_id),
    }));
    let outTasks = flaggedTasks;
    let outExt = flag(extensions, 'requested_by');
    let outFwd = flag(forwards, 'forwarded_by');
    let outCls = flag(closeRequests, 'requested_by');
    // Same flag for tickets: a Head's own done / extension request on their own ticket.
    let outTickets = pendingTickets.map(t => ({
      ...t,
      requires_top_approval: headIds.has(t.assigned_to_id) && t.marked_done_by === t.assigned_to_id,
    }));
    let outTicketExt = ticketExtensions.map(r => ({
      ...r,
      requires_top_approval: headIds.has(r.requested_by) && r.ticket_assigned_to === r.requested_by,
    }));
    if (!isTop && ticketHeadScope) {
      outTickets = outTickets.filter(r => !r.requires_top_approval);
      outTicketExt = outTicketExt.filter(r => !r.requires_top_approval);
    }

    if (!isTop && isHeadScope) {
      // A head cannot action another head's own requests — hide them.
      outTasks = outTasks.filter(r => !r.requires_top_approval);
      outExt = outExt.filter(r => !r.requires_top_approval);
      outFwd = outFwd.filter(r => !r.requires_top_approval);
      outCls = outCls.filter(r => !r.requires_top_approval);
    }

    return res.json({
      pending_tasks: outTasks,
      extension_requests: outExt,
      forward_requests: outFwd,
      close_requests: outCls,
      pending_tickets: outTickets,
      ticket_extension_requests: outTicketExt,
      can_approve_tickets: canApproveTicket,
      is_top_approver: isTop,
    });
  } catch (err) {
    console.error('Approvals page error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// BADGE COUNT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/approvals/badge
 * Admin / Task Approver: total pending items across all users.
 * Team member: their own pending items only.
 */
exports.getBadgeCount = async (req, res) => {
  try {
    const isAdmin = req.user.is_admin;
    const canApprove = isAdmin || (await canApproveTasks(req.user));
    const canApproveTicket = isAdmin || (await canApproveTickets(req.user));
    const userId  = req.user.id;

    // Always resolve team scope — mirrors the fix in getApprovalsPage.
    // A head is always scoped to their team; only admins see everything.
    const isTop = req.user.is_admin || (await isCeoUser(req.user));
    const teamScope = !isAdmin ? await getTeamScopeForHead(userId) : { isHead: false, memberIds: [] };
    // Head's own items go to Admin/CEO, so exclude the head from their own task scope.
    const taskScopeIds = teamScope.memberIds.filter(id => id !== userId);
    const taskHeadScope   = !isTop && teamScope.isHead && taskScopeIds.length > 0;
    const ticketHeadScope = !isTop && teamScope.isHead && taskScopeIds.length > 0;
    const mp = taskScopeIds.length ? taskScopeIds.map(() => '?').join(',') : '';

    let taskCount = 0;
    let ticketCount = 0;

    // ── Task-related items (scoped by task approval permission) ──
    if (isTop) {
      const [[{ task_count }]] = await db.query(
        "SELECT COUNT(*) AS task_count FROM tasks WHERE deleted = 0 AND is_active IN (0, 2)"
      );
      const [[{ ext_count }]] = await db.query(
        "SELECT COUNT(*) AS ext_count FROM task_deadline_extension_requests WHERE deleted = 0 AND status = 'pending'"
      );
      const [[{ fwd_count }]] = await db.query(
        "SELECT COUNT(*) AS fwd_count FROM task_forward_requests WHERE deleted = 0 AND status = 'pending'"
      );
      const [[{ cls_count }]] = await db.query(
        "SELECT COUNT(*) AS cls_count FROM task_close_requests WHERE deleted = 0 AND status = 'pending'"
      );
      taskCount += task_count + ext_count + fwd_count + cls_count;
    } else if (taskHeadScope) {
      // Head: scope by the task's assignee being a team member (excluding the head).
      const ids = taskScopeIds;
      const taskMp = ids.map(() => '?').join(',');
      const [[{ task_count }]] = await db.query(
        `SELECT COUNT(*) AS task_count FROM tasks WHERE deleted = 0 AND is_active IN (0, 2) AND assigned_to IN (${taskMp})`,
        [...ids]
      );
      const [[{ ext_count }]] = await db.query(
        `SELECT COUNT(*) AS ext_count FROM task_deadline_extension_requests er WHERE er.deleted = 0 AND er.status = 'pending' AND EXISTS (SELECT 1 FROM tasks te WHERE te.id = er.task_id AND te.assigned_to IN (${taskMp}))`,
        [...ids]
      );
      const [[{ fwd_count }]] = await db.query(
        `SELECT COUNT(*) AS fwd_count FROM task_forward_requests fr WHERE fr.deleted = 0 AND fr.status = 'pending' AND EXISTS (SELECT 1 FROM tasks tf WHERE tf.id = fr.task_id AND tf.assigned_to IN (${taskMp}))`,
        [...ids]
      );
      const [[{ cls_count }]] = await db.query(
        `SELECT COUNT(*) AS cls_count FROM task_close_requests cr WHERE cr.deleted = 0 AND cr.status = 'pending' AND EXISTS (SELECT 1 FROM tasks tc WHERE tc.id = cr.task_id AND tc.assigned_to IN (${taskMp}))`,
        [...ids]
      );
      taskCount += task_count + ext_count + fwd_count + cls_count;
    } else {
      // Plain user: only their own items.
      const [[{ task_count }]] = await db.query(
        "SELECT COUNT(*) AS task_count FROM tasks WHERE deleted = 0 AND is_active IN (0, 2) AND (created_by = ? OR assigned_to = ?)",
        [userId, userId]
      );
      const [[{ ext_count }]] = await db.query(
        "SELECT COUNT(*) AS ext_count FROM task_deadline_extension_requests WHERE deleted = 0 AND status = 'pending' AND requested_by = ?",
        [userId]
      );
      const [[{ fwd_count }]] = await db.query(
        "SELECT COUNT(*) AS fwd_count FROM task_forward_requests WHERE deleted = 0 AND status = 'pending' AND (forwarded_by = ? OR forwarded_to = ?)",
        [userId, userId]
      );
      const [[{ cls_count }]] = await db.query(
        "SELECT COUNT(*) AS cls_count FROM task_close_requests WHERE deleted = 0 AND status = 'pending' AND requested_by = ?",
        [userId]
      );
      taskCount += task_count + ext_count + fwd_count + cls_count;
    }

    // ── Ticket-related items (scoped by ticket approval permission) ──
    let ticketPendingSql, ticketPendingParams, ticketExtSql, ticketExtParams;
    if (isTop) {
      ticketPendingSql = "SELECT COUNT(*) AS c FROM tickets WHERE deleted = 0 AND status = 'pending_done'";
      ticketPendingParams = [];
      ticketExtSql = "SELECT COUNT(*) AS c FROM ticket_deadline_extension_requests WHERE deleted = 0 AND status = 'pending'";
      ticketExtParams = [];
    } else if (ticketHeadScope) {
      ticketPendingSql = `SELECT COUNT(*) AS c FROM tickets WHERE deleted = 0 AND status = 'pending_done' AND assigned_to IN (${mp})`;
      ticketPendingParams = [...taskScopeIds];
      ticketExtSql = `SELECT COUNT(*) AS c FROM ticket_deadline_extension_requests ter WHERE ter.deleted = 0 AND ter.status = 'pending' AND EXISTS (SELECT 1 FROM tickets tke WHERE tke.id = ter.ticket_id AND tke.assigned_to IN (${mp}))`;
      ticketExtParams = [...taskScopeIds];
    } else {      ticketPendingSql = "SELECT COUNT(*) AS c FROM tickets WHERE deleted = 0 AND status = 'pending_done' AND (assigned_to = ? OR reported_by = ?)";
      ticketPendingParams = [userId, userId];
      ticketExtSql = "SELECT COUNT(*) AS c FROM ticket_deadline_extension_requests WHERE deleted = 0 AND status = 'pending' AND requested_by = ?";
      ticketExtParams = [userId];
    }
    const [[{ c: ticket_pending_count }]] = await db.query(ticketPendingSql, ticketPendingParams);
    const [[{ c: ticket_ext_count }]] = await db.query(ticketExtSql, ticketExtParams);
    ticketCount += ticket_pending_count + ticket_ext_count;

    // `count` kept for backward compatibility; task/ticket split lets the
    // Tasks nav show task-only and the Tickets nav show ticket-only badges.
    return res.json({
      count: taskCount + ticketCount,
      task_count: taskCount,
      ticket_count: ticketCount,
    });
  } catch (err) {
    console.error('Badge count error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
