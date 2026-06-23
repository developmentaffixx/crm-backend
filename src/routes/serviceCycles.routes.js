const express = require('express');
const router = express.Router();
const { param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const cyclesController = require('../controllers/serviceCycles.controller');

// All routes require authentication
router.use(authenticate);

// GET /api/projects/:projectId/cycles — list all cycles for a project
router.get(
  '/:projectId/cycles',
  param('projectId').isInt(),
  cyclesController.listCycles
);

// POST /api/projects/:projectId/cycles/generate — generate initial cycles (default 3)
router.post(
  '/:projectId/cycles/generate',
  param('projectId').isInt(),
  cyclesController.generateCycles
);

// POST /api/projects/:projectId/cycles/generate-next — generate next single cycle
router.post(
  '/:projectId/cycles/generate-next',
  param('projectId').isInt(),
  cyclesController.generateNextCycle
);

// GET /api/projects/:projectId/cycles/:cycleId — get cycle detail with sections
router.get(
  '/:projectId/cycles/:cycleId',
  [param('projectId').isInt(), param('cycleId').isInt()],
  cyclesController.getCycleDetail
);

// PUT /api/projects/:projectId/cycles/:cycleId — update cycle status/notes
router.put(
  '/:projectId/cycles/:cycleId',
  [param('projectId').isInt(), param('cycleId').isInt()],
  cyclesController.updateCycle
);

// PUT /api/projects/:projectId/cycles/:cycleId/sections/:sectionId — update section
router.put(
  '/:projectId/cycles/:cycleId/sections/:sectionId',
  [param('projectId').isInt(), param('cycleId').isInt(), param('sectionId').isInt()],
  cyclesController.updateSection
);

// POST /api/projects/:projectId/cycles/:cycleId/tasks — link task to cycle
router.post(
  '/:projectId/cycles/:cycleId/tasks',
  [param('projectId').isInt(), param('cycleId').isInt()],
  cyclesController.addCycleTask
);

// DELETE /api/projects/:projectId/cycles/:cycleId/tasks/:taskId — unlink task
router.delete(
  '/:projectId/cycles/:cycleId/tasks/:taskId',
  [param('projectId').isInt(), param('cycleId').isInt(), param('taskId').isInt()],
  cyclesController.removeCycleTask
);

// ── Approvals ──
router.post(
  '/:projectId/cycles/:cycleId/approvals',
  [param('projectId').isInt(), param('cycleId').isInt()],
  cyclesController.addApproval
);

router.put(
  '/:projectId/cycles/:cycleId/approvals/:approvalId',
  [param('projectId').isInt(), param('cycleId').isInt(), param('approvalId').isInt()],
  cyclesController.updateApproval
);

router.delete(
  '/:projectId/cycles/:cycleId/approvals/:approvalId',
  [param('projectId').isInt(), param('cycleId').isInt(), param('approvalId').isInt()],
  cyclesController.deleteApproval
);

// ── Feedback ──
router.put(
  '/:projectId/cycles/:cycleId/feedback',
  [param('projectId').isInt(), param('cycleId').isInt()],
  cyclesController.saveFeedback
);

module.exports = router;
