const express = require('express');
const router  = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/aiLabs.controller');

router.use(authenticate);

// ── Dashboard & Stats (everyone) ─────────────────────────────────────────────
router.get('/dashboard',     ctrl.dashboard);
router.get('/my-stats',      ctrl.myStats);
router.get('/leaderboard',   ctrl.leaderboard);
router.get('/daily-nudge',   ctrl.dailyNudge);
router.get('/categories',    ctrl.getCategories);

// ── Tool Tests (everyone) ────────────────────────────────────────────────────
router.get('/tests',         ctrl.listTests);
router.get('/tests/check-existing', ctrl.checkExisting);
router.post('/tests',        ctrl.createTest);
router.put('/tests/:id',     ctrl.updateTest);
router.delete('/tests/:id',  ctrl.deleteTest);
router.post('/tests/:id/upvote',    ctrl.toggleUpvote);
router.get('/tests/:id/comments',   ctrl.listComments);
router.post('/tests/:id/comments',  ctrl.addComment);

// ── Tool Library (everyone) ──────────────────────────────────────────────────
router.get('/tools', ctrl.listTools);

// ── Reports (everyone can create, admin approves) ────────────────────────────
router.get('/reports',              ctrl.listReports);
router.post('/reports',             ctrl.createReport);
router.put('/reports/:id',          ctrl.updateReport);
router.delete('/reports/:id',       ctrl.deleteReport);
router.patch('/reports/:id/approve', requireAdmin, ctrl.approveReport);
router.patch('/reports/:id/reject',  requireAdmin, ctrl.rejectReport);

module.exports = router;
