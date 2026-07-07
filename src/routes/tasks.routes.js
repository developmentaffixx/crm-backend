const express = require('express');
const router  = express.Router();
const { body, param } = require('express-validator');
const { authenticate, requireAdmin } = require('../middleware/auth');
const tasksController = require('../controllers/tasks.controller');

// All task routes require authentication
router.use(authenticate);

// GET  /api/tasks          — list tasks (filtered by role, paginated, searchable, sortable)
router.get('/', tasksController.list);

// GET  /api/tasks/pinned          — get current user's pinned tasks
router.get('/pinned', tasksController.getPinnedTasks);

// POST /api/tasks/:id/pin         — pin a task (max 3 per user)
router.post('/:id/pin', param('id').isInt(), tasksController.pinTask);

// DELETE /api/tasks/:id/pin       — unpin a task
router.delete('/:id/pin', param('id').isInt(), tasksController.unpinTask);

// GET  /api/tasks/my-active-timer — get current user's running timer (if any)
router.get('/my-active-timer', async (req, res) => {
  try {
    const db = require('../config/db');
    const [rows] = await db.query(
      `SELECT tat.task_id, tat.started_at, t.title AS task_title
       FROM task_active_timers tat
       JOIN tasks t ON t.id = tat.task_id
       WHERE tat.user_id = ?
       LIMIT 1`,
      [req.user.id]
    );
    if (rows.length === 0) {
      return res.json({ active: false });
    }

    // Check if AFS is currently active (timer should show as paused)
    const [activeAfs] = await db.query(
      'SELECT id FROM afs_logs WHERE user_id = ? AND end_time IS NULL LIMIT 1',
      [req.user.id]
    );
    const paused = activeAfs.length > 0;

    res.json({ active: true, paused, task_id: rows[0].task_id, task_title: rows[0].task_title, started_at: rows[0].started_at });
  } catch (err) {
    console.error('my-active-timer error:', err);
    res.json({ active: false });
  }
});

// POST /api/tasks          — create task (team member)
router.post(
  '/',
  [body('title').notEmpty().withMessage('Title is required')],
  tasksController.create
);

// GET  /api/tasks/:id      — get single task detail
router.get('/:id', param('id').isInt(), tasksController.getOne);

// PUT  /api/tasks/:id      — update task fields
router.put('/:id', param('id').isInt(), tasksController.update);

// POST /api/tasks/:id/mark-done  — primary assignee marks task done (is_active 1→2)
router.post('/:id/mark-done', param('id').isInt(), tasksController.markDone);

// POST /api/tasks/:id/approve    — admin approves (0→1 or 2→3)
router.post('/:id/approve', param('id').isInt(), requireAdmin, tasksController.approve);

// POST /api/tasks/:id/reject     — admin rejects (0→4 or 2→1)
router.post('/:id/reject', param('id').isInt(), requireAdmin, tasksController.reject);

// POST /api/tasks/:id/resubmit   — creator resubmits rejected task (4→0)
router.post('/:id/resubmit', param('id').isInt(), tasksController.resubmit);

// GET  /api/tasks/:id/activity   — get activity log for a task
router.get('/:id/activity', param('id').isInt(), tasksController.getActivity);

// DELETE /api/tasks/:id          — creator or admin soft-deletes a task
router.delete('/:id', param('id').isInt(), authenticate, tasksController.remove);

// ── Time Tracking ─────────────────────────────────────────────────────────────
const timeLogsController = require('../controllers/timeLogs.controller');
const { body: bodyV } = require('express-validator');

// POST /api/tasks/:id/timer/start  — start live timer (assignee or admin)
router.post('/:id/timer/start', param('id').isInt(), timeLogsController.startTimer);

// POST /api/tasks/:id/timer/stop   — stop live timer, save log entry
router.post('/:id/timer/stop',  param('id').isInt(), timeLogsController.stopTimer);

// GET  /api/tasks/:id/timer/status — get current user's timer status + who's working
router.get('/:id/timer/status', param('id').isInt(), timeLogsController.getTimerStatus);

// GET  /api/tasks/:id/time-logs         — list all log entries
router.get('/:id/time-logs', param('id').isInt(), timeLogsController.getLogs);

// GET  /api/tasks/:id/time-logs/export  — CSV download
router.get('/:id/time-logs/export', param('id').isInt(), timeLogsController.exportLogs);

// POST /api/tasks/:id/time-logs         — manual entry (admin only)
router.post(
  '/:id/time-logs',
  param('id').isInt(),
  requireAdmin,
  [
    bodyV('started_at').notEmpty().withMessage('started_at required'),
    bodyV('ended_at').notEmpty().withMessage('ended_at required'),
  ],
  timeLogsController.createLog
);

// PUT  /api/tasks/:taskId/time-logs/:logId  — edit entry (admin only)
router.put(
  '/:id/time-logs/:logId',
  [param('id').isInt(), param('logId').isInt()],
  requireAdmin,
  timeLogsController.updateLog
);

// DELETE /api/tasks/:taskId/time-logs/:logId  — delete entry (admin only)
router.delete(
  '/:id/time-logs/:logId',
  [param('id').isInt(), param('logId').isInt()],
  requireAdmin,
  timeLogsController.deleteLog
);

module.exports = router;
