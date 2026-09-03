const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/attendance.controller');

// All routes require authentication
router.use(authenticate);

// ── Member routes ─────────────────────────────────────────────────────────────
router.post('/clock-in', ctrl.clockIn);
router.post('/clock-out', ctrl.clockOut);
router.post('/force-clock-out', ctrl.forceClockOut);
router.get('/today', ctrl.getToday);
router.get('/history', ctrl.getHistory);
router.get('/check-running-timers', ctrl.checkRunningTimers);
router.get('/check-overdue-tasks', ctrl.checkOverdueTasks);
router.get('/check-auto-clockout', ctrl.checkAutoClockOut);
router.post('/correct-clockout', ctrl.correctClockOut);
router.get('/pending-resolution', ctrl.getPendingResolution);
router.post('/resolve-pending', ctrl.resolvePending);
router.get('/my-week', ctrl.getMyWeek);
router.get('/my-month', ctrl.getMyMonth);
router.get('/my-month-balance', ctrl.getMyMonthBalance);
router.post('/afs/start', ctrl.afsStart);
router.post('/afs/end', ctrl.afsEnd);

// ── Settings ──────────────────────────────────────────────────────────────────
router.get('/settings', ctrl.getSettings);
router.put('/settings', requireAdmin, ctrl.updateSettings);

// ── Admin routes ──────────────────────────────────────────────────────────────
router.get('/admin/today', requireAdmin, ctrl.adminGetToday);
router.get('/admin/timesheet/team', requireAdmin, ctrl.adminTimesheetTeam);
router.get('/admin/timesheet', requireAdmin, ctrl.adminTimesheet);
router.get('/admin/timesheet/day', requireAdmin, ctrl.adminTimesheetDay);
router.get('/admin/week-report', requireAdmin, ctrl.adminWeekReport);
router.get('/admin/month-balance-report', requireAdmin, ctrl.adminMonthBalanceReport);
router.get('/admin/plans/:userId/:date', requireAdmin, ctrl.adminGetPlans);
router.get('/admin/pending-resolution/:userId', requireAdmin, ctrl.adminGetPendingResolution);
router.post('/admin/resolve-pending/:userId', requireAdmin, ctrl.adminResolvePending);
router.get('/admin/all-pending', requireAdmin, ctrl.adminGetAllPending);

module.exports = router;
