const express = require('express');
const router = express.Router();
const multer = require('multer');
const { param } = require('express-validator');
const { authenticate, requireAdminOrProjectApprove } = require('../middleware/auth');
const cyclesController = require('../controllers/serviceCycles.controller');
const feedbackController = require('../controllers/cycleFeedback.controller');

// Audio uploads for feedback voice notes (max 25MB, in-memory for Cloudinary)
const audioUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// All routes require authentication
router.use(authenticate);

// GET /api/projects/:projectId/cycles — list all cycles for a project
router.get(
  '/:projectId/cycles',
  param('projectId').isInt(),
  cyclesController.listCycles
);

// POST /api/projects/:projectId/cycles/generate — generate initial cycles (requires project approvals)
router.post(
  '/:projectId/cycles/generate',
  requireAdminOrProjectApprove,
  param('projectId').isInt(),
  cyclesController.generateCycles
);

// POST /api/projects/:projectId/cycles/generate-next — generate next single cycle (requires project approvals)
router.post(
  '/:projectId/cycles/generate-next',
  requireAdminOrProjectApprove,
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

// PUT /api/projects/:projectId/cycles/:cycleId/extend — extend cycle end_date (admin or approvals)
router.put(
  '/:projectId/cycles/:cycleId/extend',
  requireAdminOrProjectApprove,
  [param('projectId').isInt(), param('cycleId').isInt()],
  cyclesController.extendCycle
);

// ── Feedback (legacy single free-text field) ──
router.put(
  '/:projectId/cycles/:cycleId/feedback',
  [param('projectId').isInt(), param('cycleId').isInt()],
  cyclesController.saveFeedback
);

// ── Feedback Points (point-wise, two lists: client + team, open to everyone) ──
router.get(
  '/:projectId/cycles/:cycleId/feedback-points',
  [param('projectId').isInt(), param('cycleId').isInt()],
  feedbackController.list
);

router.post(
  '/:projectId/cycles/:cycleId/feedback-points',
  [param('projectId').isInt(), param('cycleId').isInt()],
  audioUpload.single('audio'),
  feedbackController.create
);

router.put(
  '/:projectId/cycles/:cycleId/feedback-points/:pointId',
  [param('projectId').isInt(), param('cycleId').isInt(), param('pointId').isInt()],
  feedbackController.update
);

router.delete(
  '/:projectId/cycles/:cycleId/feedback-points/:pointId',
  [param('projectId').isInt(), param('cycleId').isInt(), param('pointId').isInt()],
  feedbackController.remove
);

// ── Hours Tracking (per-user hours for a cycle, open to anyone who can view) ──
router.get(
  '/:projectId/cycles/:cycleId/hours',
  [param('projectId').isInt(), param('cycleId').isInt()],
  cyclesController.getCycleHours
);

module.exports = router;
