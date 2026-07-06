const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const salesPlanController = require('../controllers/salesPlan.controller');

// All routes require authentication
router.use(authenticate);

// GET /api/sales-plan — all authenticated users can view
router.get('/', salesPlanController.getAll);

// PUT /api/sales-plan/:section — admin only can update
router.put('/:section', requireAdmin, salesPlanController.updateSection);

// PATCH /api/sales-plan/:section/visibility — admin only toggle visibility for users
router.patch('/:section/visibility', requireAdmin, salesPlanController.toggleVisibility);

module.exports = router;
