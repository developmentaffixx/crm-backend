const express = require('express');
const router = express.Router();
const { param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const clientPlansController = require('../controllers/clientPlans.controller');

// All routes require authentication
router.use(authenticate);

// GET /api/client-plans/analytics — plan analytics (popularity, growth)
router.get('/analytics', clientPlansController.getAnalytics);

// GET /api/client-plans/client/:clientId — get plans for a client
router.get('/client/:clientId', param('clientId').isInt(), clientPlansController.getClientPlans);

// GET /api/client-plans/plan/:planId/subscribers — get subscribers for a plan
router.get('/plan/:planId/subscribers', param('planId').isInt(), clientPlansController.getPlanSubscribers);

// POST /api/client-plans — assign a plan to a client
router.post('/', clientPlansController.assignPlan);

// PUT /api/client-plans/:id — update a client plan assignment
router.put('/:id', param('id').isInt(), clientPlansController.updateClientPlan);

// DELETE /api/client-plans/:id — remove a plan assignment
router.delete('/:id', param('id').isInt(), clientPlansController.deleteClientPlan);

module.exports = router;
