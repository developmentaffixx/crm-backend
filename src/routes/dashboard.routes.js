const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/dashboard.controller');
const advCtrl = require('../controllers/dashboardAdvanced.controller');

// All routes require authentication
router.use(authenticate);

// ── Member routes ─────────────────────────────────────────────────────────────
router.get('/member', ctrl.memberStats);
router.get('/birthdays', ctrl.getBirthdays);
router.get('/deadlines', ctrl.getDeadlines);
router.get('/timeline', ctrl.getTimeline);

// ── Chart routes (member) ─────────────────────────────────────────────────────
router.get('/charts/my-productivity', ctrl.chartsMyProductivity);
router.get('/charts/my-attendance', ctrl.chartsMyAttendance);

// ── Advanced Member routes ────────────────────────────────────────────────────
router.get('/member/performance-score', advCtrl.getMemberPerformanceScore);
router.get('/member/meetings-today', advCtrl.getMemberMeetingsToday);
router.get('/member/streak', advCtrl.getMemberStreak);
router.get('/member/weekly-comparison', advCtrl.getMemberWeeklyComparison);
router.get('/member/leave-balance', advCtrl.getMemberLeaveBalance);
router.get('/member/tasks-summary', advCtrl.getMemberTasksSummary);
router.get('/member/monthly-calendar', advCtrl.getMemberMonthlyCalendar);

// ── Admin routes ──────────────────────────────────────────────────────────────
router.get('/admin', requireAdmin, ctrl.adminStats);
router.get('/charts/team-attendance', requireAdmin, ctrl.chartsTeamAttendance);
router.get('/charts/team-productivity', requireAdmin, ctrl.chartsTeamProductivity);
router.get('/charts/revenue', requireAdmin, ctrl.chartsRevenue);
router.get('/charts/leads-pipeline', requireAdmin, ctrl.chartsLeadsPipeline);

// ── Advanced Admin routes ─────────────────────────────────────────────────────
router.get('/admin/approvals', requireAdmin, advCtrl.getAdminApprovals);
router.get('/admin/overdue', requireAdmin, advCtrl.getAdminOverdue);
router.get('/admin/workload', requireAdmin, advCtrl.getAdminWorkload);
router.get('/admin/top-performers', requireAdmin, advCtrl.getAdminTopPerformers);
router.get('/admin/project-health', requireAdmin, advCtrl.getAdminProjectHealth);
router.get('/admin/expense-breakdown', requireAdmin, advCtrl.getAdminExpenseBreakdown);
router.get('/admin/lead-funnel', requireAdmin, advCtrl.getAdminLeadFunnel);
router.get('/admin/cash-forecast', requireAdmin, advCtrl.getAdminCashForecast);
router.get('/admin/trends', requireAdmin, advCtrl.getAdminTrends);

module.exports = router;
