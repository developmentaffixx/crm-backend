const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/attendance.controller');

// All routes require authentication
router.use(authenticate);

// ── Member routes ─────────────────────────────────────────────────────────────
router.post('/clock-in', ctrl.clockIn);
router.post('/clock-out', ctrl.clockOut);
router.get('/today', ctrl.getToday);
router.get('/my-week', ctrl.getMyWeek);
router.get('/my-month', ctrl.getMyMonth);
router.post('/afs/start', ctrl.afsStart);
router.post('/afs/end', ctrl.afsEnd);

// ── Settings ──────────────────────────────────────────────────────────────────
router.get('/settings', ctrl.getSettings);
router.put('/settings', requireAdmin, ctrl.updateSettings);

// ── Admin routes ──────────────────────────────────────────────────────────────
router.get('/admin/today', requireAdmin, ctrl.adminGetToday);
router.get('/admin/week-report', requireAdmin, ctrl.adminWeekReport);
router.get('/admin/plans/:userId/:date', requireAdmin, ctrl.adminGetPlans);

module.exports = router;
