const express = require('express');
const router  = express.Router();
const { body, param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const controller = require('../controllers/projectServices.controller');

// All routes require authentication
router.use(authenticate);

// GET /api/projects/:projectId/services — list all services for a project
router.get(
  '/:projectId/services',
  param('projectId').isInt(),
  controller.list
);

// POST /api/projects/:projectId/services — add a service to a project
router.post(
  '/:projectId/services',
  [
    param('projectId').isInt(),
    body('service_id').isInt().withMessage('service_id is required'),
  ],
  controller.add
);

// GET /api/projects/:projectId/services/:serviceId — get single service detail
router.get(
  '/:projectId/services/:serviceId',
  [param('projectId').isInt(), param('serviceId').isInt()],
  controller.getOne
);

// PUT /api/projects/:projectId/services/:serviceId — update a project service
router.put(
  '/:projectId/services/:serviceId',
  [param('projectId').isInt(), param('serviceId').isInt()],
  controller.update
);

// DELETE /api/projects/:projectId/services/:serviceId — remove a service from project
router.delete(
  '/:projectId/services/:serviceId',
  [param('projectId').isInt(), param('serviceId').isInt()],
  controller.remove
);

// POST /api/projects/:projectId/services/:serviceId/pause — pause service
router.post(
  '/:projectId/services/:serviceId/pause',
  [param('projectId').isInt(), param('serviceId').isInt()],
  controller.pauseService
);

// POST /api/projects/:projectId/services/:serviceId/complete — complete service
router.post(
  '/:projectId/services/:serviceId/complete',
  [param('projectId').isInt(), param('serviceId').isInt()],
  controller.completeService
);

// POST /api/projects/:projectId/services/:serviceId/cancel — cancel service
router.post(
  '/:projectId/services/:serviceId/cancel',
  [param('projectId').isInt(), param('serviceId').isInt()],
  controller.cancelService
);

// POST /api/projects/:projectId/services/:serviceId/new-cycle — create new cycle (reactivates)
router.post(
  '/:projectId/services/:serviceId/new-cycle',
  [param('projectId').isInt(), param('serviceId').isInt()],
  controller.createNewCycle
);

module.exports = router;
