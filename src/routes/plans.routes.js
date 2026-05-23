const express = require('express');
const router  = express.Router();
const { body, param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const plansController = require('../controllers/plans.controller');

// All plan routes require authentication
router.use(authenticate);

// ── Services ──────────────────────────────────────────────────────────────────

// GET  /api/plans/services — list all services with plans
router.get('/services', plansController.listServices);

// POST /api/plans/services — create service
router.post(
  '/services',
  [body('name').notEmpty().withMessage('Service name is required')],
  plansController.createService
);

// PUT  /api/plans/services/:id — update service
router.put('/services/:id', param('id').isInt(), plansController.updateService);

// DELETE /api/plans/services/:id — soft-delete service
router.delete('/services/:id', param('id').isInt(), plansController.deleteService);

// ── Plans ─────────────────────────────────────────────────────────────────────

// PUT /api/plans/plans/reorder — reorder plans within a service (must be before :id routes)
router.put('/plans/reorder', plansController.reorderPlans);

// POST /api/plans/services/:serviceId/plans — create plan for a service
router.post(
  '/services/:serviceId/plans',
  [
    param('serviceId').isInt(),
    body('name').notEmpty().withMessage('Plan name is required'),
  ],
  plansController.createPlan
);

// PUT  /api/plans/plans/:id — update plan
router.put('/plans/:id', param('id').isInt(), plansController.updatePlan);

// DELETE /api/plans/plans/:id — soft-delete plan
router.delete('/plans/:id', param('id').isInt(), plansController.deletePlan);

// PUT /api/plans/plans/:id/toggle-active — toggle plan active status
router.put('/plans/:id/toggle-active', param('id').isInt(), plansController.togglePlanActive);

// ── Service Features (comparison table) ───────────────────────────────────────

// PUT /api/plans/service-features/reorder — reorder features within a service (must be before :id routes)
router.put('/service-features/reorder', plansController.reorderServiceFeatures);

// POST /api/plans/services/:serviceId/features — add feature row
router.post(
  '/services/:serviceId/features',
  [
    param('serviceId').isInt(),
    body('name').notEmpty().withMessage('Feature name is required'),
  ],
  plansController.addServiceFeature
);

// DELETE /api/plans/service-features/:id — delete feature row
router.delete('/service-features/:id', param('id').isInt(), plansController.deleteServiceFeature);

// PUT /api/plans/service-features/:id — update feature name
router.put('/service-features/:id', param('id').isInt(), plansController.updateServiceFeature);

// PUT /api/plans/services/:serviceId/feature-values — bulk update comparison values
router.put(
  '/services/:serviceId/feature-values',
  param('serviceId').isInt(),
  plansController.updateFeatureValues
);

module.exports = router;
