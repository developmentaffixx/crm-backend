const express = require('express');
const router  = express.Router();
const { param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const meetingsController = require('../controllers/meetings.controller');

// All meeting routes require authentication
router.use(authenticate);

// GET  /api/meetings/today-count — badge count for sidebar
router.get('/today-count', meetingsController.todayCount);

// GET  /api/meetings/my-active-timer — current user's active meeting timer (for header)
router.get('/my-active-timer', meetingsController.getMyActiveTimer);

// GET  /api/meetings          — list meetings
router.get('/', meetingsController.list);

// GET  /api/meetings/:id      — get single meeting
router.get('/:id', param('id').isInt(), meetingsController.getOne);

// POST /api/meetings          — create meeting
router.post('/', meetingsController.create);

// PUT  /api/meetings/:id      — update meeting
router.put('/:id', param('id').isInt(), meetingsController.update);

// DELETE /api/meetings/:id    — soft-delete meeting
router.delete('/:id', param('id').isInt(), meetingsController.remove);

// ── Timer endpoints ──────────────────────────────────────────────────────────
// POST /api/meetings/:id/timer/start  — start meeting timer
router.post('/:id/timer/start', param('id').isInt(), meetingsController.startTimer);

// POST /api/meetings/:id/timer/stop   — stop meeting timer
router.post('/:id/timer/stop', param('id').isInt(), meetingsController.stopTimer);

// GET  /api/meetings/:id/timer/status — get timer status for a meeting
router.get('/:id/timer/status', param('id').isInt(), meetingsController.timerStatus);

// GET  /api/meetings/:id/timer/logs   — get time logs for a meeting
router.get('/:id/timer/logs', param('id').isInt(), meetingsController.timerLogs);

module.exports = router;
