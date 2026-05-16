const express = require('express');
const router  = express.Router();
const { body, param } = require('express-validator');
const { authenticate, requireAdmin } = require('../middleware/auth');
const approvalsController = require('../controllers/approvals.controller');

router.use(authenticate);

// ── Extension Requests ──────────────────────────────────────────────────────

// POST /api/approvals/extensions
router.post(
  '/extensions',
  [
    body('task_id').isInt().withMessage('task_id required'),
    body('requested_deadline').isDate().withMessage('requested_deadline (YYYY-MM-DD) required'),
    body('reason').notEmpty().withMessage('reason required'),
  ],
  approvalsController.createExtension
);

// POST /api/approvals/extensions/:id/approve  (admin)
router.post('/extensions/:id/approve', param('id').isInt(), requireAdmin, approvalsController.approveExtension);

// POST /api/approvals/extensions/:id/reject   (admin)
router.post('/extensions/:id/reject', param('id').isInt(), requireAdmin, approvalsController.rejectExtension);

// DELETE /api/approvals/extensions/:id/cancel (team member cancels own pending)
router.delete('/extensions/:id/cancel', param('id').isInt(), approvalsController.cancelExtension);

// ── Forward Requests ────────────────────────────────────────────────────────

// POST /api/approvals/forwards
router.post(
  '/forwards',
  [
    body('task_id').isInt().withMessage('task_id required'),
    body('forwarded_to').isInt().withMessage('forwarded_to user id required'),
  ],
  approvalsController.createForward
);

// POST /api/approvals/forwards/:id/accept  (forwarded_to user accepts)
router.post('/forwards/:id/accept', param('id').isInt(), approvalsController.acceptForward);

// POST /api/approvals/forwards/:id/reject  (forwarded_to user declines)
router.post('/forwards/:id/reject', param('id').isInt(), approvalsController.rejectForward);

// DELETE /api/approvals/forwards/:id/cancel (team member cancels own pending)
router.delete('/forwards/:id/cancel', param('id').isInt(), approvalsController.cancelForward);

// ── Approvals Page Data ─────────────────────────────────────────────────────

// GET /api/approvals  — returns all sections based on role
router.get('/', approvalsController.getApprovalsPage);

// ── Badge Count ─────────────────────────────────────────────────────────────

// GET /api/approvals/badge  — pending count for nav badge
router.get('/badge', approvalsController.getBadgeCount);

module.exports = router;
