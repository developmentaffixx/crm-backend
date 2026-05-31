const express = require('express');
const router = express.Router();
const { param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const monthlyEvaluationsController = require('../controllers/monthlyEvaluations.controller');

// All routes require authentication
router.use(authenticate);

// GET /api/monthly-evaluations/dashboard — must be before /:id
router.get('/dashboard', monthlyEvaluationsController.dashboard);

// GET /api/monthly-evaluations — list evaluations
router.get('/', monthlyEvaluationsController.list);

// POST /api/monthly-evaluations/generate — auto-generate (admin only)
router.post('/generate', monthlyEvaluationsController.generate);

// GET /api/monthly-evaluations/:id — get single evaluation with details
router.get('/:id', param('id').isInt(), monthlyEvaluationsController.getOne);

// POST /api/monthly-evaluations/:id/manager-evaluation — submit manager evaluation
router.post('/:id/manager-evaluation', param('id').isInt(), monthlyEvaluationsController.submitManagerEvaluation);

// POST /api/monthly-evaluations/:id/decision — submit decision
router.post('/:id/decision', param('id').isInt(), monthlyEvaluationsController.submitDecision);

// POST /api/monthly-evaluations/:id/feedback — submit feedback
router.post('/:id/feedback', param('id').isInt(), monthlyEvaluationsController.submitFeedback);

module.exports = router;
