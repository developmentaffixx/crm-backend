const { validationResult } = require('express-validator');
const db = require('../config/db');

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

// ─────────────────────────────────────────────────────────────────────────────
// EXTENSION REQUESTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/approvals/extensions
 */
exports.createExtension = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

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

    const [result] = await db.query(
      'INSERT INTO task_deadline_extension_requests (task_id, requested_by, requested_deadline, reason) VALUES (?, ?, ?, ?)',
      [task_id, req.user.id, requested_deadline, reason]
    );

    // Log to task activity
    await logActivity(task_id, req.user.id, 'extension_requested', {
      note: `Requested new deadline: ${new Date(requested_deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}${reason ? ' — Reason: ' + reason : ''}`
    });

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

    if (fwd.forwarded_to !== req.user.id && !req.user.is_admin) {
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

    if (fwd.forwarded_to !== req.user.id && !req.user.is_admin) {
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
 * Admin: all pending items across all users.
 * Team member: only their own requests.
 */
exports.getApprovalsPage = async (req, res) => {
  try {
    const isAdmin = req.user.is_admin;
    const userId  = req.user.id;

    let pendingTasksWhere = "t.deleted = 0 AND t.is_active IN (0, 2)";
    let extWhere          = "er.deleted = 0";
    let fwdWhere          = "fr.deleted = 0";
    const params = [];

    if (!isAdmin) {
      pendingTasksWhere += ' AND (t.created_by = ? OR t.assigned_to = ?)';
      params.push(userId, userId);
      extWhere += ' AND er.requested_by = ?';
      fwdWhere += ' AND (fr.forwarded_by = ? OR fr.forwarded_to = ?)';
    }

    const [pendingTasks] = await db.query(
      `SELECT t.id, t.title, t.is_active, t.deadline, t.priority,
              CONCAT(u.first_name, ' ', u.last_name) AS assigned_to_name
       FROM tasks t
       LEFT JOIN users u ON u.id = t.assigned_to
       WHERE ${pendingTasksWhere}
       ORDER BY t.created_at DESC`,
      isAdmin ? [] : [userId, userId]
    );

    const extParams = isAdmin ? [] : [userId];
    const [extensions] = await db.query(
      `SELECT er.*, t.title AS task_title,
              CONCAT(u.first_name, ' ', u.last_name) AS requested_by_name
       FROM task_deadline_extension_requests er
       LEFT JOIN tasks t ON t.id = er.task_id
       LEFT JOIN users u ON u.id = er.requested_by
       WHERE ${extWhere}
       ORDER BY er.created_at DESC`,
      extParams
    );

    const fwdParams = isAdmin ? [] : [userId, userId];
    const [forwards] = await db.query(
      `SELECT fr.*, t.title AS task_title,
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

    // Pending ticket completions (pending_done status)
    let pendingTicketsWhere = "tk.deleted = 0 AND tk.status = 'pending_done'";
    if (!isAdmin) {
      pendingTicketsWhere += ' AND (tk.assigned_to = ? OR tk.reported_by = ?)';
    }
    const pendingTicketsParams = isAdmin ? [] : [userId, userId];
    const [pendingTickets] = await db.query(
      `SELECT tk.id, tk.title, tk.status, tk.due_date, tk.priority, tk.mode,
              CONCAT(u.first_name, ' ', u.last_name) AS assigned_to_name,
              CONCAT(u2.first_name, ' ', u2.last_name) AS marked_done_by_name
       FROM tickets tk
       LEFT JOIN users u ON u.id = tk.assigned_to
       LEFT JOIN users u2 ON u2.id = tk.marked_done_by
       WHERE ${pendingTicketsWhere}
       ORDER BY tk.marked_done_at DESC`,
      pendingTicketsParams
    );

    // Ticket extension requests
    let ticketExtWhere = "ter.deleted = 0";
    if (!isAdmin) {
      ticketExtWhere += ' AND ter.requested_by = ?';
    }
    const ticketExtParams = isAdmin ? [] : [userId];
    const [ticketExtensions] = await db.query(
      `SELECT ter.*, tk.title AS ticket_title,
              CONCAT(u.first_name, ' ', u.last_name) AS requested_by_name
       FROM ticket_deadline_extension_requests ter
       LEFT JOIN tickets tk ON tk.id = ter.ticket_id
       LEFT JOIN users u ON u.id = ter.requested_by
       WHERE ${ticketExtWhere}
       ORDER BY ter.created_at DESC`,
      ticketExtParams
    );

    return res.json({
      pending_tasks: pendingTasks,
      extension_requests: extensions,
      forward_requests: forwards,
      pending_tickets: pendingTickets,
      ticket_extension_requests: ticketExtensions,
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
 * Admin: total pending items across all users.
 * Team member: their own pending items only.
 */
exports.getBadgeCount = async (req, res) => {
  try {
    const isAdmin = req.user.is_admin;
    const userId  = req.user.id;

    let count = 0;

    if (isAdmin) {
      const [[{ task_count }]] = await db.query(
        "SELECT COUNT(*) AS task_count FROM tasks WHERE deleted = 0 AND is_active IN (0, 2)"
      );
      const [[{ ext_count }]] = await db.query(
        "SELECT COUNT(*) AS ext_count FROM task_deadline_extension_requests WHERE deleted = 0 AND status = 'pending'"
      );
      const [[{ fwd_count }]] = await db.query(
        "SELECT COUNT(*) AS fwd_count FROM task_forward_requests WHERE deleted = 0 AND status = 'pending'"
      );
      const [[{ ticket_pending_count }]] = await db.query(
        "SELECT COUNT(*) AS ticket_pending_count FROM tickets WHERE deleted = 0 AND status = 'pending_done'"
      );
      const [[{ ticket_ext_count }]] = await db.query(
        "SELECT COUNT(*) AS ticket_ext_count FROM ticket_deadline_extension_requests WHERE deleted = 0 AND status = 'pending'"
      );
      count = task_count + ext_count + fwd_count + ticket_pending_count + ticket_ext_count;
    } else {
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
      const [[{ ticket_pending_count }]] = await db.query(
        "SELECT COUNT(*) AS ticket_pending_count FROM tickets WHERE deleted = 0 AND status = 'pending_done' AND (assigned_to = ? OR reported_by = ?)",
        [userId, userId]
      );
      const [[{ ticket_ext_count }]] = await db.query(
        "SELECT COUNT(*) AS ticket_ext_count FROM ticket_deadline_extension_requests WHERE deleted = 0 AND status = 'pending' AND requested_by = ?",
        [userId]
      );
      count = task_count + ext_count + fwd_count + ticket_pending_count + ticket_ext_count;
    }

    return res.json({ count });
  } catch (err) {
    console.error('Badge count error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
