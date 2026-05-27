const { validationResult } = require('express-validator');
const db = require('../config/db');

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function getTask(id) {
  const [rows] = await db.query('SELECT * FROM tasks WHERE id = ? AND deleted = 0', [id]);
  return rows[0] || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/tasks/:id/timer/start
// Any assignee/collaborator can start their own timer independently.
// Multiple users can have timers running on the same task simultaneously.
// ─────────────────────────────────────────────────────────────────────────────
exports.startTimer = async (req, res) => {
  try {
    const task = await getTask(req.params.id);
    if (!task) return res.status(404).json({ message: 'Task not found' });

    // Only assignee, collaborator, or admin
    if (!req.user.is_admin && task.assigned_to !== req.user.id) {
      const [collab] = await db.query(
        'SELECT 1 FROM task_assignees WHERE task_id = ? AND user_id = ?',
        [task.id, req.user.id]
      );
      if (collab.length === 0) {
        return res.status(403).json({ message: 'Only assigned users can track time' });
      }
    }

    if (task.is_active !== 1) {
      return res.status(400).json({ message: 'Timer can only run on active tasks' });
    }

    // ── Must be clocked in (attendance check) ─────────────────────────────
    const [attendance] = await db.query(
      `SELECT id, clock_in, clock_out FROM attendance
       WHERE user_id = ? AND date = CURDATE()
       ORDER BY id DESC LIMIT 1`,
      [req.user.id]
    );
    if (attendance.length === 0 || !attendance[0].clock_in) {
      return res.status(400).json({ message: 'You must clock in before starting a task timer' });
    }
    if (attendance[0].clock_out) {
      return res.status(400).json({ message: 'You have already clocked out. Task timer cannot be started after clock out.' });
    }

    // ── Block timer during AFS ────────────────────────────────────────────
    const [activeAfs] = await db.query(
      'SELECT id FROM afs_logs WHERE user_id = ? AND end_time IS NULL LIMIT 1',
      [req.user.id]
    );
    if (activeAfs.length > 0) {
      return res.status(400).json({ message: 'Cannot start timer while AFS is active. End your AFS break first.' });
    }
    // ──────────────────────────────────────────────────────────────────────

    // Check if THIS user already has a timer running on THIS task
    const [existingTimer] = await db.query(
      'SELECT 1 FROM task_active_timers WHERE task_id = ? AND user_id = ?',
      [task.id, req.user.id]
    );
    if (existingTimer.length > 0) {
      return res.status(400).json({ message: 'Your timer is already running on this task' });
    }

    // ── One active timer per user across all tasks ─────────────────────────
    const [running] = await db.query(
      `SELECT tat.task_id, t.title
       FROM task_active_timers tat
       JOIN tasks t ON t.id = tat.task_id
       WHERE tat.user_id = ? AND tat.task_id != ?
       LIMIT 1`,
      [req.user.id, task.id]
    );

    if (running.length > 0) {
      return res.status(400).json({
        message: `You already have a timer running on "${running[0].title}". Stop it first before starting a new one.`,
        conflicting_task_id: running[0].task_id,
        conflicting_task_title: running[0].title,
      });
    }
    // ──────────────────────────────────────────────────────────────────────

    const now = new Date();

    // Insert per-user active timer
    await db.query(
      'INSERT INTO task_active_timers (task_id, user_id, started_at) VALUES (?, ?, ?)',
      [task.id, req.user.id, now]
    );

    // Also update the legacy timer_started_at if no one else is running (backward compat)
    if (!task.timer_started_at) {
      await db.query('UPDATE tasks SET timer_started_at = ? WHERE id = ?', [now, task.id]);
    }

    // Auto-change status to "in_progress" when timer starts (if currently "to_do")
    if (task.status === 'to_do') {
      await db.query('UPDATE tasks SET status = ? WHERE id = ?', ['in_progress', task.id]);
    }

    return res.json({ timer_started_at: now, time_spent: task.time_spent, status: task.status === 'to_do' ? 'in_progress' : task.status });
  } catch (err) {
    console.error('startTimer error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/tasks/:id/timer/stop
// Stops the current user's timer, saves a time log entry, accumulates time_spent.
// ─────────────────────────────────────────────────────────────────────────────
exports.stopTimer = async (req, res) => {
  try {
    const task = await getTask(req.params.id);
    if (!task) return res.status(404).json({ message: 'Task not found' });

    if (!req.user.is_admin && task.assigned_to !== req.user.id) {
      const [collab] = await db.query(
        'SELECT 1 FROM task_assignees WHERE task_id = ? AND user_id = ?',
        [task.id, req.user.id]
      );
      if (collab.length === 0) {
        return res.status(403).json({ message: 'Only assigned users can track time' });
      }
    }

    // Check if this user has an active timer on this task
    const [activeTimer] = await db.query(
      'SELECT * FROM task_active_timers WHERE task_id = ? AND user_id = ?',
      [task.id, req.user.id]
    );

    if (activeTimer.length === 0) {
      // Fallback: check legacy timer_started_at for backward compat
      if (!task.timer_started_at) {
        return res.status(400).json({ message: 'Timer is not running' });
      }
      // Use legacy timer
      const now = new Date();
      const startedAt = new Date(task.timer_started_at);
      const duration = Math.max(1, Math.floor((now - startedAt) / 1000));
      const note = req.body.note || null;

      await db.query(
        `INSERT INTO task_time_logs (task_id, user_id, started_at, ended_at, duration, note)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [task.id, req.user.id, startedAt, now, duration, note]
      );

      const newTotal = task.time_spent + duration;
      await db.query(
        'UPDATE tasks SET time_spent = ?, timer_started_at = NULL WHERE id = ?',
        [newTotal, task.id]
      );

      return res.json({ time_spent: newTotal, duration, timer_started_at: null });
    }

    // Use per-user timer
    const timer = activeTimer[0];
    const now = new Date();
    const startedAt = new Date(timer.started_at);
    const duration = Math.max(1, Math.floor((now - startedAt) / 1000));
    const note = req.body.note || null;

    // Save log entry
    await db.query(
      `INSERT INTO task_time_logs (task_id, user_id, started_at, ended_at, duration, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [task.id, req.user.id, startedAt, now, duration, note]
    );

    // Remove the active timer for this user
    await db.query(
      'DELETE FROM task_active_timers WHERE task_id = ? AND user_id = ?',
      [task.id, req.user.id]
    );

    // Accumulate time_spent atomically
    await db.query('UPDATE tasks SET time_spent = time_spent + ? WHERE id = ?', [duration, task.id]);

    // Get updated total
    const [updatedTask] = await db.query('SELECT time_spent FROM tasks WHERE id = ?', [task.id]);
    const newTotal = updatedTask[0].time_spent;

    // If no more active timers on this task, clear legacy timer_started_at
    const [remainingTimers] = await db.query(
      'SELECT 1 FROM task_active_timers WHERE task_id = ?',
      [task.id]
    );
    if (remainingTimers.length === 0) {
      await db.query('UPDATE tasks SET timer_started_at = NULL WHERE id = ?', [task.id]);
    }

    return res.json({ time_spent: newTotal, duration, timer_started_at: null });
  } catch (err) {
    console.error('stopTimer error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/tasks/:id/time-logs
// Returns all time log entries + active timers (who's currently working)
// ─────────────────────────────────────────────────────────────────────────────
exports.getLogs = async (req, res) => {
  try {
    const task = await getTask(req.params.id);
    if (!task) return res.status(404).json({ message: 'Task not found' });

    if (!req.user.is_admin &&
        task.assigned_to !== req.user.id &&
        task.created_by  !== req.user.id) {
      const [collab] = await db.query(
        'SELECT 1 FROM task_assignees WHERE task_id = ? AND user_id = ?',
        [task.id, req.user.id]
      );
      if (collab.length === 0) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    const [logs] = await db.query(
      `SELECT tl.*,
              CONCAT(u.first_name, ' ', u.last_name) AS user_name
       FROM task_time_logs tl
       JOIN users u ON u.id = tl.user_id
       WHERE tl.task_id = ?
       ORDER BY tl.started_at DESC`,
      [task.id]
    );

    // Get active timers (who's currently working on this task)
    const [activeTimers] = await db.query(
      `SELECT tat.user_id, tat.started_at,
              CONCAT(u.first_name, ' ', u.last_name) AS user_name
       FROM task_active_timers tat
       JOIN users u ON u.id = tat.user_id
       WHERE tat.task_id = ?`,
      [task.id]
    );

    // Per-user time summary
    const [userSummary] = await db.query(
      `SELECT tl.user_id,
              CONCAT(u.first_name, ' ', u.last_name) AS user_name,
              SUM(tl.duration) AS total_seconds,
              COUNT(*) AS session_count
       FROM task_time_logs tl
       JOIN users u ON u.id = tl.user_id
       WHERE tl.task_id = ?
       GROUP BY tl.user_id
       ORDER BY total_seconds DESC`,
      [task.id]
    );

    // Calculate actual total from logs (source of truth)
    const actualTotal = userSummary.reduce((sum, u) => sum + parseInt(u.total_seconds || 0, 10), 0);

    // Ensure user_summary values are numbers for the frontend
    for (const u of userSummary) {
      u.total_seconds = parseInt(u.total_seconds || 0, 10);
      u.session_count = parseInt(u.session_count || 0, 10);
    }

    // Sync task.time_spent if it drifted
    if (actualTotal !== task.time_spent) {
      await db.query('UPDATE tasks SET time_spent = ? WHERE id = ?', [actualTotal, task.id]);
    }

    return res.json({
      logs,
      time_spent: actualTotal,
      timer_started_at: task.timer_started_at,
      active_timers: activeTimers,
      user_summary: userSummary,
    });
  } catch (err) {
    console.error('getLogs error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/tasks/:id/timer/status
// Returns the current user's timer status for this task
// ─────────────────────────────────────────────────────────────────────────────
exports.getTimerStatus = async (req, res) => {
  try {
    const [timer] = await db.query(
      'SELECT * FROM task_active_timers WHERE task_id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    const [allTimers] = await db.query(
      `SELECT tat.user_id, tat.started_at,
              CONCAT(u.first_name, ' ', u.last_name) AS user_name
       FROM task_active_timers tat
       JOIN users u ON u.id = tat.user_id
       WHERE tat.task_id = ?`,
      [req.params.id]
    );

    return res.json({
      my_timer: timer.length > 0 ? timer[0] : null,
      active_timers: allTimers,
    });
  } catch (err) {
    console.error('getTimerStatus error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/tasks/:id/time-logs  (admin only — manual entry)
// ─────────────────────────────────────────────────────────────────────────────
exports.createLog = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { started_at, ended_at, note, user_id } = req.body;

  try {
    const task = await getTask(req.params.id);
    if (!task) return res.status(404).json({ message: 'Task not found' });

    const start    = new Date(started_at);
    const end      = new Date(ended_at);
    const duration = Math.max(1, Math.floor((end - start) / 1000));

    if (end <= start) {
      return res.status(400).json({ message: 'ended_at must be after started_at' });
    }

    const logUserId = user_id || req.user.id;

    const [result] = await db.query(
      `INSERT INTO task_time_logs (task_id, user_id, started_at, ended_at, duration, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [task.id, logUserId, start, end, duration, note || null]
    );

    // Update accumulated time
    await db.query(
      'UPDATE tasks SET time_spent = time_spent + ? WHERE id = ?',
      [duration, task.id]
    );

    const [rows] = await db.query(
      `SELECT tl.*, CONCAT(u.first_name, ' ', u.last_name) AS user_name
       FROM task_time_logs tl JOIN users u ON u.id = tl.user_id
       WHERE tl.id = ?`,
      [result.insertId]
    );

    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('createLog error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/tasks/:taskId/time-logs/:logId  (admin only — edit entry)
// ─────────────────────────────────────────────────────────────────────────────
exports.updateLog = async (req, res) => {
  try {
    const [existing] = await db.query(
      'SELECT * FROM task_time_logs WHERE id = ? AND task_id = ?',
      [req.params.logId, req.params.id]
    );
    if (!existing.length) return res.status(404).json({ message: 'Log entry not found' });

    const log = existing[0];
    const { started_at, ended_at, note } = req.body;

    const start    = started_at ? new Date(started_at) : new Date(log.started_at);
    const end      = ended_at   ? new Date(ended_at)   : new Date(log.ended_at);

    if (end <= start) {
      return res.status(400).json({ message: 'ended_at must be after started_at' });
    }

    const newDuration = Math.max(1, Math.floor((end - start) / 1000));
    const diff        = newDuration - log.duration;

    await db.query(
      'UPDATE task_time_logs SET started_at = ?, ended_at = ?, duration = ?, note = ? WHERE id = ?',
      [start, end, newDuration, note !== undefined ? note : log.note, log.id]
    );

    // Adjust task total
    await db.query(
      'UPDATE tasks SET time_spent = GREATEST(0, time_spent + ?) WHERE id = ?',
      [diff, req.params.id]
    );

    const [rows] = await db.query(
      `SELECT tl.*, CONCAT(u.first_name, ' ', u.last_name) AS user_name
       FROM task_time_logs tl JOIN users u ON u.id = tl.user_id
       WHERE tl.id = ?`,
      [log.id]
    );

    return res.json(rows[0]);
  } catch (err) {
    console.error('updateLog error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/tasks/:taskId/time-logs/:logId  (admin only)
// ─────────────────────────────────────────────────────────────────────────────
exports.deleteLog = async (req, res) => {
  try {
    const [existing] = await db.query(
      'SELECT * FROM task_time_logs WHERE id = ? AND task_id = ?',
      [req.params.logId, req.params.id]
    );
    if (!existing.length) return res.status(404).json({ message: 'Log entry not found' });

    const log = existing[0];

    await db.query('DELETE FROM task_time_logs WHERE id = ?', [log.id]);

    // Subtract from task total
    await db.query(
      'UPDATE tasks SET time_spent = GREATEST(0, time_spent - ?) WHERE id = ?',
      [log.duration, req.params.id]
    );

    return res.json({ message: 'Log entry deleted' });
  } catch (err) {
    console.error('deleteLog error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/tasks/:id/time-logs/export  — CSV download
// ─────────────────────────────────────────────────────────────────────────────
exports.exportLogs = async (req, res) => {
  try {
    const task = await getTask(req.params.id);
    if (!task) return res.status(404).json({ message: 'Task not found' });

    if (!req.user.is_admin &&
        task.assigned_to !== req.user.id &&
        task.created_by  !== req.user.id) {
      const [collab] = await db.query(
        'SELECT 1 FROM task_assignees WHERE task_id = ? AND user_id = ?',
        [task.id, req.user.id]
      );
      if (collab.length === 0) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    const [logs] = await db.query(
      `SELECT tl.started_at, tl.ended_at, tl.duration,
              CONCAT(u.first_name, ' ', u.last_name) AS user_name,
              tl.note
       FROM task_time_logs tl
       JOIN users u ON u.id = tl.user_id
       WHERE tl.task_id = ?
       ORDER BY tl.started_at ASC`,
      [task.id]
    );

    const header = 'Task,User,Date,Start,End,Duration (min),Note\n';
    const rows   = logs.map(l => {
      const date  = new Date(l.started_at).toLocaleDateString('en-CA');
      const start = new Date(l.started_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      const end   = new Date(l.ended_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
      const mins  = (l.duration / 60).toFixed(1);
      const note  = (l.note || '').replace(/"/g, '""');
      return `"${task.title}","${l.user_name}","${date}","${start}","${end}","${mins}","${note}"`;
    }).join('\n');

    const csv = header + rows;
    const filename = `time-log-task-${task.id}.csv`;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(csv);
  } catch (err) {
    console.error('exportLogs error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
