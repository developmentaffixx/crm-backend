const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/dashboard.controller');

// All routes require authentication
router.use(authenticate);

// ── Member routes ─────────────────────────────────────────────────────────────
router.get('/member', ctrl.memberStats);
router.get('/deadlines', ctrl.getDeadlines);
router.get('/timeline', ctrl.getTimeline);

// ── Chart routes (member) ─────────────────────────────────────────────────────
router.get('/charts/my-productivity', ctrl.chartsMyProductivity);
router.get('/charts/my-attendance', ctrl.chartsMyAttendance);

// ── Admin routes ──────────────────────────────────────────────────────────────
router.get('/admin', requireAdmin, ctrl.adminStats);
router.get('/charts/team-attendance', requireAdmin, ctrl.chartsTeamAttendance);
router.get('/charts/team-productivity', requireAdmin, ctrl.chartsTeamProductivity);
router.get('/charts/revenue', requireAdmin, ctrl.chartsRevenue);
router.get('/charts/leads-pipeline', requireAdmin, ctrl.chartsLeadsPipeline);

module.exports = router;
