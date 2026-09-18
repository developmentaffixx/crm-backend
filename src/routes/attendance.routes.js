const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin, requireAdminOrAttendanceAccess } = require('../middleware/auth');
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
router.put('/settings', requireAdminOrAttendanceAccess, ctrl.updateSettings);

// ── Admin routes ──────────────────────────────────────────────────────────────
router.get('/admin/today', requireAdminOrAttendanceAccess, ctrl.adminGetToday);
router.get('/admin/timesheet/team', requireAdminOrAttendanceAccess, ctrl.adminTimesheetTeam);
router.get('/admin/timesheet', requireAdminOrAttendanceAccess, ctrl.adminTimesheet);
router.get('/admin/timesheet/day', requireAdminOrAttendanceAccess, ctrl.adminTimesheetDay);
router.get('/admin/week-report', requireAdminOrAttendanceAccess, ctrl.adminWeekReport);
router.get('/admin/month-balance-report', requireAdminOrAttendanceAccess, ctrl.adminMonthBalanceReport);
router.get('/admin/plans/:userId/:date', requireAdminOrAttendanceAccess, ctrl.adminGetPlans);
router.get('/admin/pending-resolution/:userId', requireAdminOrAttendanceAccess, ctrl.adminGetPendingResolution);
router.post('/admin/resolve-pending/:userId', requireAdminOrAttendanceAccess, ctrl.adminResolvePending);
router.get('/admin/all-pending', requireAdminOrAttendanceAccess, ctrl.adminGetAllPending);


module.exports = router;
