const { validationResult } = require('express-validator');
const db = require('../config/db');

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Log activity
// ─────────────────────────────────────────────────────────────────────────────

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
// HELPER: Sync task_assignees junction table
// ─────────────────────────────────────────────────────────────────────────────

async function syncAssignees(taskId, primaryUserId, collaboratorIds = []) {
  // Remove existing assignees
  await db.query('DELETE FROM task_assignees WHERE task_id = ?', [taskId]);

  // Insert primary
  await db.query(
    "INSERT INTO task_assignees (task_id, user_id, role) VALUES (?, ?, 'primary')",
    [taskId, primaryUserId]
  );

  // Insert collaborators
  for (const uid of collaboratorIds) {
    if (uid !== primaryUserId) {
      await db.query(
        "INSERT IGNORE INTO task_assignees (task_id, user_id, role) VALUES (?, ?, 'collaborator')",
        [taskId, uid]
      );
    }
  }
}

/**
 * GET /api/tasks
 * Supports: pagination, search, sorting, filtering
 * Query params: page, limit, search, sort_by, sort_order, status, is_active, priority
 */
exports.list = async (req, res) => {
  try {
    const {
      status, is_active, priority, search, exclude_done, assigned_to,
      page = 1, limit = 25,
      sort_by = 'deadline', sort_order = 'ASC'
    } = req.query;

    const pageNum  = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset   = (pageNum - 1) * limitNum;

    // Allowed sort columns (prevent SQL injection)
    const allowedSorts = ['created_at', 'deadline', 'priority', 'title', 'time_spent', 'updated_at'];
    const sortCol = allowedSorts.includes(sort_by) ? `t.${sort_by}` : 't.deadline';
    const sortDir = sort_order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // When sorting by deadline, push NULLs to the bottom regardless of direction
    const orderClause = sort_by === 'deadline'
      ? `t.deadline IS NULL, t.deadline ${sortDir}`
      : `${sortCol} ${sortDir}`;

    let where = 't.deleted = 0';
    const params = [];

    if (!req.user.is_admin) {
      // Team member sees:
      // 1. Active tasks (is_active >= 1) where they are assigned_to, created_by, or collaborator
      // 2. Rejected tasks (is_active = 4) that THEY created, within 8 hours of rejection
      where += ` AND (
        (t.is_active >= 1 AND (t.assigned_to = ? OR t.created_by = ? OR EXISTS (
          SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = ?
        )))
        OR
        (t.is_active = 4 AND t.created_by = ? AND t.rejected_at IS NOT NULL AND t.rejected_at >= NOW() - INTERVAL 8 HOUR)
      )`;
      params.push(req.user.id, req.user.id, req.user.id, req.user.id);
    }

    if (status)    { where += ' AND t.status = ?';    params.push(status); }
    if (is_active !== undefined && is_active !== '') {
      where += ' AND t.is_active = ?';
      params.push(is_active);
    }
    if (exclude_done === '1') { where += ' AND t.is_active != 3'; }
    if (priority)  { where += ' AND t.priority = ?';  params.push(priority); }
    if (assigned_to) { where += ' AND t.assigned_to = ?'; params.push(assigned_to); }

    // Search by title or description
    if (search && search.trim()) {
      where += ' AND (t.title LIKE ? OR t.description LIKE ?)';
      const searchTerm = `%${search.trim()}%`;
      params.push(searchTerm, searchTerm);
    }

    // Get total count for pagination
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM tasks t WHERE ${where}`,
      params
    );

    // Get paginated results (GROUP BY to avoid duplicates from JOINs)
    const [rows] = await db.query(
      `SELECT t.id, t.task_id_code, t.title, t.description, t.assigned_to, t.created_by,
              t.start_date, t.deadline, t.priority, t.status, t.is_active,
              t.deleted, t.created_at, t.updated_at, t.rejected_at,
              COALESCE((SELECT SUM(tl.duration) FROM task_time_logs tl WHERE tl.task_id = t.id), 0) AS time_spent,
              t.timer_started_at,
              CONCAT(u_assigned.first_name, ' ', u_assigned.last_name) AS assigned_to_name,
              u_assigned.avatar_url AS assigned_to_avatar,
              u_assigned.first_name AS assigned_to_first_name,
              u_assigned.last_name AS assigned_to_last_name,
              CONCAT(u_created.first_name,  ' ', u_created.last_name)  AS created_by_name,
              (SELECT pt2.project_id FROM project_tasks pt2 WHERE pt2.task_id = t.id LIMIT 1) AS project_id,
              (SELECT p2.title FROM project_tasks pt2 JOIN projects p2 ON p2.id = pt2.project_id AND p2.deleted = 0 WHERE pt2.task_id = t.id LIMIT 1) AS project_name,
              (SELECT pt2.service_id FROM project_tasks pt2 WHERE pt2.task_id = t.id LIMIT 1) AS service_id,
              (SELECT s2.name FROM project_tasks pt2 JOIN services s2 ON s2.id = pt2.service_id WHERE pt2.task_id = t.id LIMIT 1) AS service_name,
              COALESCE(
                (SELECT sc2.id FROM cycle_tasks ct2 JOIN service_cycles sc2 ON sc2.id = ct2.cycle_id WHERE ct2.task_id = t.id LIMIT 1),
                (SELECT sc3.id FROM project_tasks pt3 JOIN service_cycles sc3 ON sc3.project_id = pt3.project_id AND sc3.status = 'active' WHERE pt3.task_id = t.id AND pt3.service_id IS NOT NULL LIMIT 1)
              ) AS cycle_id,
              COALESCE(
                (SELECT sc2.title FROM cycle_tasks ct2 JOIN service_cycles sc2 ON sc2.id = ct2.cycle_id WHERE ct2.task_id = t.id LIMIT 1),
                (SELECT sc3.title FROM project_tasks pt3 JOIN service_cycles sc3 ON sc3.project_id = pt3.project_id AND sc3.status = 'active' WHERE pt3.task_id = t.id AND pt3.service_id IS NOT NULL LIMIT 1)
              ) AS cycle_name
       FROM tasks t
       LEFT JOIN users u_assigned ON u_assigned.id = t.assigned_to
       LEFT JOIN users u_created  ON u_created.id  = t.created_by
       WHERE ${where}
       ORDER BY ${orderClause}
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    // Fetch collaborators for each task
    const taskIds = rows.map(r => r.id);
    let assigneesMap = {};
    if (taskIds.length > 0) {
      const [assigneeRows] = await db.query(
        `SELECT ta.task_id, ta.user_id, ta.role,
                CONCAT(u.first_name, ' ', u.last_name) AS name,
                u.avatar_url AS avatar
         FROM task_assignees ta
         JOIN users u ON u.id = ta.user_id
         WHERE ta.task_id IN (?)`,
        [taskIds]
      );
      for (const row of assigneeRows) {
        if (!assigneesMap[row.task_id]) assigneesMap[row.task_id] = [];
        assigneesMap[row.task_id].push({ user_id: row.user_id, role: row.role, name: row.name, avatar: row.avatar });
      }
    }

    // Attach assignees to each task
    for (const task of rows) {
      task.assignees = assigneesMap[task.id] || [];
    }

    // Summary counts (over ALL matching tasks, not just current page)
    // We need a separate query for accurate counts
    const summaryWhere = 't.deleted = 0' + (!req.user.is_admin
      ? ` AND (
        (t.is_active >= 1 AND (t.assigned_to = ? OR t.created_by = ? OR EXISTS (
          SELECT 1 FROM task_assignees ta WHERE ta.task_id = t.id AND ta.user_id = ?
        )))
        OR
        (t.is_active = 4 AND t.created_by = ? AND t.rejected_at IS NOT NULL AND t.rejected_at >= NOW() - INTERVAL 8 HOUR)
      )`
      : '');
    const summaryParams = !req.user.is_admin ? [req.user.id, req.user.id, req.user.id, req.user.id] : [];

    const [allRows] = await db.query(
      `SELECT t.status, t.is_active FROM tasks t WHERE ${summaryWhere}`,
      summaryParams
    );

    const summary = {
      to_do:            allRows.filter(r => r.status === 'to_do' && r.is_active === 1).length,
      in_progress:      allRows.filter(r => r.status === 'in_progress' && r.is_active === 1).length,
      done:             allRows.filter(r => r.is_active === 3).length,
      pending_approval: req.user.is_admin ? allRows.filter(r => r.is_active === 0).length : 0,
      rejected:         allRows.filter(r => r.is_active === 4).length,
    };

    return res.json({
      tasks: rows,
      summary,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        total_pages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    console.error('Tasks list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/tasks/:id
 */
exports.getOne = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT t.id, t.task_id_code, t.title, t.description, t.assigned_to, t.created_by,
              t.start_date, t.deadline, t.priority, t.status, t.is_active,
              t.deleted, t.created_at, t.updated_at, t.timer_started_at,
              COALESCE((SELECT SUM(tl.duration) FROM task_time_logs tl WHERE tl.task_id = t.id), 0) AS time_spent,
              CONCAT(u_assigned.first_name, ' ', u_assigned.last_name) AS assigned_to_name,
              CONCAT(u_created.first_name,  ' ', u_created.last_name)  AS created_by_name,
              ext.id   AS pending_extension_id,
              ext.requested_deadline,
              fwd.id   AS pending_forward_id,
              fwd.forwarded_to AS forwarded_to_user_id,
              pt.project_id,
              p.title AS project_name,
              pt.service_id,
              sv.name AS service_name,
              COALESCE(sc.id, sc_active.id) AS cycle_id,
              COALESCE(sc.title, sc_active.title) AS cycle_name
       FROM tasks t
       LEFT JOIN users u_assigned ON u_assigned.id = t.assigned_to
       LEFT JOIN users u_created  ON u_created.id  = t.created_by
       LEFT JOIN task_deadline_extension_requests ext
              ON ext.task_id = t.id AND ext.status = 'pending' AND ext.deleted = 0
       LEFT JOIN task_forward_requests fwd
              ON fwd.task_id = t.id AND fwd.status = 'pending' AND fwd.deleted = 0
       LEFT JOIN project_tasks pt ON pt.task_id = t.id
       LEFT JOIN projects p ON p.id = pt.project_id AND p.deleted = 0
       LEFT JOIN services sv ON sv.id = pt.service_id
       LEFT JOIN cycle_tasks ct ON ct.task_id = t.id
       LEFT JOIN service_cycles sc ON sc.id = ct.cycle_id
       LEFT JOIN service_cycles sc_active ON sc_active.project_id = pt.project_id AND sc_active.status = 'active' AND ct.id IS NULL AND pt.service_id IS NOT NULL
       WHERE t.id = ? AND t.deleted = 0`,
      [req.params.id]
    );

    if (rows.length === 0) return res.status(404).json({ message: 'Task not found' });

    const task = rows[0];

    // Team member can only see their own tasks or tasks they collaborate on
    if (!req.user.is_admin &&
        task.assigned_to !== req.user.id &&
        task.created_by  !== req.user.id) {
      // Check if collaborator
      const [collab] = await db.query(
        'SELECT 1 FROM task_assignees WHERE task_id = ? AND user_id = ?',
        [task.id, req.user.id]
      );
      if (collab.length === 0) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    // Fetch all assignees
    const [assignees] = await db.query(
      `SELECT ta.user_id, ta.role,
              CONCAT(u.first_name, ' ', u.last_name) AS name
       FROM task_assignees ta
       JOIN users u ON u.id = ta.user_id
       WHERE ta.task_id = ?`,
      [task.id]
    );
    task.assignees = assignees;

    return res.json(task);
  } catch (err) {
    console.error('Task getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/tasks
 * Admin: task is immediately active (is_active = 1, no approval needed).
 * Team member: task goes to pending approval (is_active = 0).
 * Supports: assigned_to (primary), collaborators (array of user IDs)
 */
exports.create = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { title, description, assigned_to, start_date, deadline, priority, project_id, service_id, collaborators, cycle_id } = req.body;

  try {
    const assignee  = assigned_to || req.user.id;
    const isActive  = req.user.is_admin ? 1 : 0;

    // Generate task_id_code: TSK-YYMMDD-### (sequence resets per Financial Year: April–March)
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const datePrefix = `TSK-${yy}${mm}${dd}`;

    // Determine FY start: if month >= April, FY started this year's April 1; else last year's April 1
    const fyStartYear = (now.getMonth() + 1) >= 4 ? now.getFullYear() : now.getFullYear() - 1;
    const fyStart = `${fyStartYear}-04-01`;

    // Get the max sequence number used in the current FY
    const [lastTask] = await db.query(
      `SELECT task_id_code FROM tasks WHERE created_at >= ? ORDER BY id DESC LIMIT 1`,
      [fyStart]
    );
    let taskSeq = 1;
    if (lastTask.length > 0 && lastTask[0].task_id_code) {
      const parts = lastTask[0].task_id_code.split('-');
      taskSeq = parseInt(parts[parts.length - 1], 10) + 1;
    }
    const task_id_code = `${datePrefix}-${String(taskSeq).padStart(3, '0')}`;

    const [result] = await db.query(
      `INSERT INTO tasks (task_id_code, title, description, assigned_to, created_by, start_date, deadline, priority, status, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'to_do', ?)`,
      [task_id_code, title, description || null, assignee, req.user.id, start_date || null, deadline || null, priority || 'medium', isActive]
    );

    const taskId = result.insertId;

    // Sync assignees (primary + collaborators)
    const collabIds = Array.isArray(collaborators) ? collaborators.map(Number).filter(Boolean) : [];
    await syncAssignees(taskId, assignee, collabIds);

    // Link task to project if project_id provided
    if (project_id) {
      await db.query(
        'INSERT IGNORE INTO project_tasks (project_id, task_id, service_id) VALUES (?, ?, ?)',
        [project_id, taskId, service_id || null]
      );

      // Log project activity for task creation
      await db.query(
        `INSERT INTO project_activities (project_id, type, note, created_by) VALUES (?, 'update', ?, ?)`,
        [project_id, `Task created: ${title}`, req.user.id]
      );
    }

    // Link task to cycle if cycle_id provided
    if (cycle_id) {
      await db.query(
        'INSERT IGNORE INTO cycle_tasks (cycle_id, task_id) VALUES (?, ?)',
        [cycle_id, taskId]
      );
    }

    // Log activity
    await logActivity(taskId, req.user.id, 'created', {
      note: `Task "${title}" created and assigned to user #${assignee}`
    });

    const [rows] = await db.query('SELECT * FROM tasks WHERE id = ?', [taskId]);
    res.emitSocket('tasks:created', rows[0]);
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Task create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/tasks/:id
 * Admin: can update any task (except closed).
 * Team member: only the task CREATOR can edit.
 * Closed tasks (is_active = 3) cannot be edited by anyone.
 * Supports: collaborators array
 */
exports.update = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM tasks WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Task not found' });

    const task = rows[0];

    // Closed tasks cannot be edited (except by admin)
    if (task.is_active === 3 && !req.user.is_admin) {
      return res.status(400).json({ message: 'Closed tasks cannot be edited' });
    }

    // Admin has full access, otherwise only creator can edit
    if (!req.user.is_admin && task.created_by !== req.user.id) {
      return res.status(403).json({ message: 'Only the task creator can edit this task' });
    }

    const allowed = ['title', 'description', 'assigned_to', 'start_date', 'deadline', 'priority', 'status'];
    const updates = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });

    if (Object.keys(updates).length === 0 && req.body.project_id === undefined && req.body.service_id === undefined && req.body.collaborators === undefined) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }

    // Log field changes
    for (const [field, newVal] of Object.entries(updates)) {
      const oldVal = task[field];
      if (String(oldVal) !== String(newVal)) {
        await logActivity(task.id, req.user.id, 'updated', {
          field_name: field,
          old_value: oldVal != null ? String(oldVal) : null,
          new_value: newVal != null ? String(newVal) : null,
        });
      }
    }

    if (Object.keys(updates).length > 0) {
      const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
      const values     = [...Object.values(updates), req.params.id];
      await db.query(`UPDATE tasks SET ${setClauses} WHERE id = ?`, values);
    }

    // Update project link if project_id provided
    if (req.body.project_id !== undefined) {
      await db.query('DELETE FROM project_tasks WHERE task_id = ?', [req.params.id]);
      if (req.body.project_id) {
        await db.query(
          'INSERT IGNORE INTO project_tasks (project_id, task_id, service_id) VALUES (?, ?, ?)',
          [req.body.project_id, req.params.id, req.body.service_id || null]
        );
      }
    } else if (req.body.service_id !== undefined) {
      // Update only the service_id on existing project_tasks link
      await db.query(
        'UPDATE project_tasks SET service_id = ? WHERE task_id = ?',
        [req.body.service_id || null, req.params.id]
      );
    }

    // Update collaborators if provided
    if (req.body.collaborators !== undefined) {
      const primaryUser = updates.assigned_to || task.assigned_to;
      const collabIds = Array.isArray(req.body.collaborators) ? req.body.collaborators.map(Number).filter(Boolean) : [];
      await syncAssignees(task.id, primaryUser, collabIds);
      await logActivity(task.id, req.user.id, 'assigned', {
        note: `Collaborators updated: [${collabIds.join(', ')}]`
      });
    }

    const [updated] = await db.query('SELECT * FROM tasks WHERE id = ?', [req.params.id]);
    res.emitSocket('tasks:updated', updated[0]);
    return res.json(updated[0]);
  } catch (err) {
    console.error('Task update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/tasks/:id/mark-done
 * Primary assignee marks task done: is_active 1 → 2 (pending closing approval).
 * Requires a closing_statement with minimum 30 words.
 */
exports.markDone = async (req, res) => {
  try {
    const { closing_statement } = req.body;

    // Validate closing statement — minimum 30 words
    if (!closing_statement || closing_statement.trim().split(/\s+/).filter(Boolean).length < 30) {
      return res.status(400).json({ message: 'Closing statement must be at least 30 words' });
    }

    const [rows] = await db.query('SELECT * FROM tasks WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Task not found' });

    const task = rows[0];

    // Only primary assignee or admin can mark done
    if (task.assigned_to !== req.user.id && !req.user.is_admin) {
      return res.status(403).json({ message: 'Only the primary assigned user can mark this task done' });
    }

    if (task.is_active !== 1) {
      return res.status(400).json({ message: 'Task must be active (is_active=1) to mark as done' });
    }

    await db.query("UPDATE tasks SET is_active = 2, status = 'done', closing_statement = ? WHERE id = ?", [closing_statement.trim(), task.id]);

    await logActivity(task.id, req.user.id, 'marked_done', { note: closing_statement.trim() });

    const [updated] = await db.query('SELECT * FROM tasks WHERE id = ?', [task.id]);
    res.emitSocket('tasks:updated', updated[0]);
    return res.json(updated[0]);
  } catch (err) {
    console.error('Mark done error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/tasks/:id/approve  (admin only)
 * is_active 0 → 1  (new task approved)
 * is_active 2 → 3  (closing approved)
 */
exports.approve = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM tasks WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Task not found' });

    const task = rows[0];

    if (task.is_active === 0) {
      await db.query("UPDATE tasks SET is_active = 1, status = 'to_do' WHERE id = ?", [task.id]);
      await logActivity(task.id, req.user.id, 'approved', { note: 'Task creation approved' });
    } else if (task.is_active === 2) {
      await db.query("UPDATE tasks SET is_active = 3, status = 'done' WHERE id = ?", [task.id]);
      await logActivity(task.id, req.user.id, 'approved', { note: 'Task completion approved' });
    } else {
      return res.status(400).json({ message: 'Task is not in a pending approval state' });
    }

    const [updated] = await db.query('SELECT * FROM tasks WHERE id = ?', [task.id]);
    res.emitSocket('tasks:updated', updated[0]);
    return res.json(updated[0]);
  } catch (err) {
    console.error('Task approve error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/tasks/:id/reject  (admin only)
 * is_active 0 → 4 (rejected, can be resubmitted)
 * is_active 2 → 1 (completion rejected, back to active)
 */
exports.reject = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM tasks WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Task not found' });

    const task = rows[0];
    const reason = req.body.reason || null;

    if (task.is_active === 0) {
      // Instead of deleting, set to rejected state (is_active = 4) with timestamp
      await db.query("UPDATE tasks SET is_active = 4, rejected_at = NOW() WHERE id = ?", [task.id]);
      await logActivity(task.id, req.user.id, 'rejected', { note: reason || 'Task creation rejected' });

      const [updated] = await db.query('SELECT * FROM tasks WHERE id = ?', [task.id]);
      res.emitSocket('tasks:updated', updated[0]);
      return res.json({ message: 'Task rejected', task: updated[0] });
    } else if (task.is_active === 2) {
      await db.query("UPDATE tasks SET is_active = 1, status = 'in_progress' WHERE id = ?", [task.id]);
      await logActivity(task.id, req.user.id, 'rejected', { note: reason || 'Task completion rejected' });

      const [updated] = await db.query('SELECT * FROM tasks WHERE id = ?', [task.id]);
      res.emitSocket('tasks:updated', updated[0]);
      return res.json(updated[0]);
    } else {
      return res.status(400).json({ message: 'Task is not in a pending approval state' });
    }
  } catch (err) {
    console.error('Task reject error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/tasks/:id/resubmit
 * Creator resubmits a rejected task (is_active 4 → 0)
 */
exports.resubmit = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM tasks WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Task not found' });

    const task = rows[0];

    if (task.is_active !== 4) {
      return res.status(400).json({ message: 'Only rejected tasks can be resubmitted' });
    }

    // Only creator can resubmit
    if (task.created_by !== req.user.id && !req.user.is_admin) {
      return res.status(403).json({ message: 'Only the task creator can resubmit' });
    }

    // Allow updating fields during resubmit
    const { title, description, assigned_to, start_date, deadline, priority } = req.body;
    const updates = {};
    if (title)       updates.title = title;
    if (description !== undefined) updates.description = description;
    if (assigned_to) updates.assigned_to = assigned_to;
    if (start_date !== undefined)  updates.start_date = start_date || null;
    if (deadline !== undefined)    updates.deadline = deadline || null;
    if (priority)    updates.priority = priority;

    updates.is_active = 0; // Back to pending approval
    updates.rejected_at = null; // Clear rejection timestamp

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values     = [...Object.values(updates), task.id];
    await db.query(`UPDATE tasks SET ${setClauses} WHERE id = ?`, values);

    await logActivity(task.id, req.user.id, 'resubmitted', { note: 'Task resubmitted for approval' });

    // Update project/service link during resubmit
    if (req.body.project_id !== undefined) {
      await db.query('DELETE FROM project_tasks WHERE task_id = ?', [task.id]);
      if (req.body.project_id) {
        await db.query(
          'INSERT IGNORE INTO project_tasks (project_id, task_id, service_id) VALUES (?, ?, ?)',
          [req.body.project_id, task.id, req.body.service_id || null]
        );
      }
    }

    const [updated] = await db.query('SELECT * FROM tasks WHERE id = ?', [task.id]);
    res.emitSocket('tasks:updated', updated[0]);
    return res.json(updated[0]);
  } catch (err) {
    console.error('Task resubmit error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * DELETE /api/tasks/:id
 * Admin: can delete any task (except closed).
 * Team member: only the task CREATOR can delete.
 * Closed tasks cannot be deleted.
 */
exports.remove = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM tasks WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Task not found' });

    const task = rows[0];

    // Closed tasks cannot be deleted
    if (task.is_active === 3) {
      return res.status(400).json({ message: 'Closed tasks cannot be deleted' });
    }

    // Admin has full access, otherwise only creator can delete
    if (!req.user.is_admin && task.created_by !== req.user.id) {
      return res.status(403).json({ message: 'Only the task creator can delete this task' });
    }

    await db.query('UPDATE tasks SET deleted = 1 WHERE id = ?', [req.params.id]);
    await logActivity(task.id, req.user.id, 'deleted');

    res.emitSocket('tasks:deleted', { id: req.params.id });
    return res.json({ message: 'Task deleted' });
  } catch (err) {
    console.error('Task delete error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/tasks/:id/activity
 * Returns the activity log for a task.
 */
exports.getActivity = async (req, res) => {
  try {
    const [task] = await db.query('SELECT id, assigned_to, created_by FROM tasks WHERE id = ? AND deleted = 0', [req.params.id]);
    if (task.length === 0) return res.status(404).json({ message: 'Task not found' });

    // Access check
    if (!req.user.is_admin &&
        task[0].assigned_to !== req.user.id &&
        task[0].created_by  !== req.user.id) {
      const [collab] = await db.query(
        'SELECT 1 FROM task_assignees WHERE task_id = ? AND user_id = ?',
        [req.params.id, req.user.id]
      );
      if (collab.length === 0) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    const [logs] = await db.query(
      `SELECT tal.*,
              CONCAT(u.first_name, ' ', u.last_name) AS user_name
       FROM task_activity_log tal
       JOIN users u ON u.id = tal.user_id
       WHERE tal.task_id = ?
       ORDER BY tal.created_at DESC
       LIMIT 100`,
      [req.params.id]
    );

    // Also fetch extension request history for this task
    const [extHistory] = await db.query(
      `SELECT er.id, er.task_id, er.requested_by AS user_id, er.status, er.requested_deadline, er.reason, er.created_at,
              er.actioned_by,
              CONCAT(u.first_name, ' ', u.last_name) AS requested_by_name,
              CONCAT(a.first_name, ' ', a.last_name) AS actioned_by_name
       FROM task_deadline_extension_requests er
       JOIN users u ON u.id = er.requested_by
       LEFT JOIN users a ON a.id = er.actioned_by
       WHERE er.task_id = ? AND er.deleted = 0
       ORDER BY er.created_at DESC`,
      [req.params.id]
    );

    // Merge extension history into activity log format
    const extLogs = extHistory.map(ext => {
      const deadline = new Date(ext.requested_deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      return {
        id: `ext-${ext.id}`,
        task_id: ext.task_id,
        user_id: ext.status === 'pending' ? ext.user_id : (ext.actioned_by || ext.user_id),
        action: ext.status === 'approved' ? 'extension_approved'
              : ext.status === 'rejected' ? 'extension_rejected'
              : 'extension_requested',
        field_name: null,
        old_value: null,
        new_value: null,
        note: ext.status === 'approved'
          ? `Deadline extended to ${deadline}`
          : ext.status === 'rejected'
          ? `Extension request rejected${ext.reason ? ' — Reason: ' + ext.reason : ''}`
          : `Requested new deadline: ${deadline}${ext.reason ? ' — Reason: ' + ext.reason : ''}`,
        created_at: ext.created_at,
        user_name: ext.status === 'pending'
          ? ext.requested_by_name
          : (ext.actioned_by_name || ext.requested_by_name),
      };
    });

    // Combine and sort by created_at descending, remove duplicate extension entries from activity log
    const activityActions = ['extension_requested', 'extension_approved', 'extension_rejected'];
    const filteredLogs = logs.filter(l => !activityActions.includes(l.action));
    const combined = [...filteredLogs, ...extLogs].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    return res.json({ activity: combined });
  } catch (err) {
    console.error('Task activity error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};


// ─────────────────────────────────────────────────────────────────────────────
// TASK PINS (per-user, max 3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/tasks/pinned
 * Returns the current user's pinned tasks (full task data).
 */
exports.getPinnedTasks = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT t.id, t.task_id_code, t.title, t.description, t.assigned_to, t.created_by,
              t.start_date, t.deadline, t.priority, t.status, t.is_active,
              t.created_at, t.updated_at,
              CONCAT(u_assigned.first_name, ' ', u_assigned.last_name) AS assigned_to_name,
              u_assigned.avatar_url AS assigned_to_avatar,
              CONCAT(u_created.first_name, ' ', u_created.last_name) AS created_by_name,
              tp.pinned_at
       FROM task_pins tp
       JOIN tasks t ON t.id = tp.task_id AND t.deleted = 0
       LEFT JOIN users u_assigned ON u_assigned.id = t.assigned_to
       LEFT JOIN users u_created ON u_created.id = t.created_by
       WHERE tp.user_id = ?
       ORDER BY tp.pinned_at DESC`,
      [req.user.id]
    );

    return res.json({ pinned: rows });
  } catch (err) {
    console.error('Get pinned tasks error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/tasks/:id/pin
 * Pin a task for the current user (max 3 pins).
 */
exports.pinTask = async (req, res) => {
  try {
    const taskId = req.params.id;

    // Verify task exists
    const [task] = await db.query('SELECT id FROM tasks WHERE id = ? AND deleted = 0', [taskId]);
    if (task.length === 0) {
      return res.status(404).json({ message: 'Task not found' });
    }

    // Check current pin count
    const [[{ count }]] = await db.query(
      'SELECT COUNT(*) AS count FROM task_pins WHERE user_id = ?',
      [req.user.id]
    );

    if (count >= 3) {
      return res.status(400).json({ message: 'Maximum 3 pinned tasks allowed. Unpin a task first.' });
    }

    // Check if already pinned
    const [existing] = await db.query(
      'SELECT id FROM task_pins WHERE user_id = ? AND task_id = ?',
      [req.user.id, taskId]
    );

    if (existing.length > 0) {
      return res.status(400).json({ message: 'Task is already pinned' });
    }

    await db.query(
      'INSERT INTO task_pins (user_id, task_id) VALUES (?, ?)',
      [req.user.id, taskId]
    );

    return res.json({ message: 'Task pinned', task_id: Number(taskId) });
  } catch (err) {
    console.error('Pin task error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * DELETE /api/tasks/:id/pin
 * Unpin a task for the current user.
 */
exports.unpinTask = async (req, res) => {
  try {
    const taskId = req.params.id;

    const [result] = await db.query(
      'DELETE FROM task_pins WHERE user_id = ? AND task_id = ?',
      [req.user.id, taskId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Pin not found' });
    }

    return res.json({ message: 'Task unpinned', task_id: Number(taskId) });
  } catch (err) {
    console.error('Unpin task error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
