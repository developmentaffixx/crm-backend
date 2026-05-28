const express = require('express');
const router  = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const ctrl    = require('../controllers/interviewScheduler.controller');

// Public route — joinus form submits here (no auth required)
router.post('/applications', ctrl.submitApplication);

// All other routes require authentication
router.use(authenticate);

// Candidates
router.get('/candidates',           ctrl.listCandidates);
router.get('/candidates/:id',       ctrl.getCandidate);
router.post('/candidates',          ctrl.createCandidate);
router.patch('/candidates/:id/status', ctrl.updateStatus);
router.delete('/candidates/:id',    requireAdmin, ctrl.deleteCandidate);

// Rounds
router.post('/candidates/:id/rounds', ctrl.createRound);
router.patch('/rounds/:id',           ctrl.updateRound);

// Schedule & Stats
router.get('/schedule', ctrl.getSchedule);
router.get('/stats',    ctrl.getStats);

module.exports = router;
