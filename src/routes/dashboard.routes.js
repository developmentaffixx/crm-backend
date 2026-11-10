const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin, requireAdminOrSubmenu } = require('../middleware/auth');
const ctrl = require('../controllers/dashboard.controller');
const advCtrl = require('../controllers/dashboardAdvanced.controller');

// Admin OR anyone granted "Dashboard 4 (CEO)" — used for the business widgets
// shown on the CEO dashboard.
const adminOrCeo = requireAdminOrSubmenu('dashboard', 'dashboard_ceo');

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
router.get('/charts/revenue', adminOrCeo, ctrl.chartsRevenue);
router.get('/charts/leads-pipeline', adminOrCeo, ctrl.chartsLeadsPipeline);

// ── Advanced Admin routes ─────────────────────────────────────────────────────
router.get('/admin/approvals', requireAdmin, advCtrl.getAdminApprovals);
router.get('/admin/overdue', adminOrCeo, advCtrl.getAdminOverdue);
router.get('/admin/workload', requireAdmin, advCtrl.getAdminWorkload);
router.get('/admin/top-performers', adminOrCeo, advCtrl.getAdminTopPerformers);
router.get('/admin/top-revenue-clients', adminOrCeo, advCtrl.getAdminTopRevenueClients);
router.get('/admin/project-health', adminOrCeo, advCtrl.getAdminProjectHealth);
router.get('/admin/expense-breakdown', adminOrCeo, advCtrl.getAdminExpenseBreakdown);
router.get('/admin/lead-funnel', adminOrCeo, advCtrl.getAdminLeadFunnel);
router.get('/admin/cash-forecast', adminOrCeo, advCtrl.getAdminCashForecast);
router.get('/admin/trends', requireAdmin, advCtrl.getAdminTrends);

module.exports = router;
