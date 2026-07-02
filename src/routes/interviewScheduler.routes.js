const express = require('express');
const router  = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const ctrl    = require('../controllers/interviewScheduler.controller');

// ── Public route — joinus form (no auth) ─────────────────────────────────────
router.post('/applications', ctrl.submitApplication);

// ── All routes below require authentication ───────────────────────────────────
router.use(authenticate);

// Candidates
router.get('/candidates',                ctrl.listCandidates);
router.get('/candidates/:id',            ctrl.getCandidate);
router.get('/candidates/:id/resume',     ctrl.getResume);
router.patch('/candidates/:id/status',   ctrl.updateStatus);
router.delete('/candidates/:id',         requireAdmin, ctrl.deleteCandidate);

// Rounds
router.post('/candidates/:id/rounds',    ctrl.createRound);
router.patch('/rounds/:id',              ctrl.updateRound);

// Schedule, Today & Stats
router.get('/schedule',  ctrl.getSchedule);
router.get('/today',     ctrl.getToday);
router.get('/stats',     ctrl.getStats);

// Question Bank (Admin only)
router.get('/questions',           ctrl.listQuestions);
router.get('/questions/positions', ctrl.listPositions);
router.post('/questions',          requireAdmin, ctrl.createQuestion);
router.patch('/questions/:id',     requireAdmin, ctrl.updateQuestion);
router.delete('/questions/:id',    requireAdmin, ctrl.deleteQuestion);

module.exports = router;
