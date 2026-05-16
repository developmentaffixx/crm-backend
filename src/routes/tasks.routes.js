const express = require('express');
const router  = express.Router();
const { body, param } = require('express-validator');
const { authenticate, requireAdmin } = require('../middleware/auth');
const tasksController = require('../controllers/tasks.controller');

// All task routes require authentication
router.use(authenticate);

// GET  /api/tasks          — list tasks (filtered by role, paginated, searchable, sortable)
router.get('/', tasksController.list);

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
