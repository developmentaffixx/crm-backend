const express = require('express');
const router  = express.Router();
const { body, param } = require('express-validator');
const { authenticate, requireAdmin, requireAdminOrTaskApprove } = require('../middleware/auth');
const approvalsController = require('../controllers/approvals.controller');

router.use(authenticate);

// ── Extension Requests ──────────────────────────────────────────────────────

// POST /api/approvals/extensions
router.post(
  '/extensions',
  [
    body('task_id').isInt().withMessage('task_id required'),
    body('requested_deadline').isDate().withMessage('requested_deadline (YYYY-MM-DD) required'),
    body('reason')
      .trim()
      .notEmpty().withMessage('reason required')
      .custom((value) => {
        const letterCount = (value.match(/[a-zA-Z]/g) || []).length;
        if (letterCount < 30) {
          throw new Error('Reason must contain at least 30 letters');
        }
        return true;
      }),
  ],
  approvalsController.createExtension
);

// POST /api/approvals/extensions/:id/approve  (admin or task approver)
router.post('/extensions/:id/approve', param('id').isInt(), requireAdminOrTaskApprove, approvalsController.approveExtension);

// POST /api/approvals/extensions/:id/reject   (admin or task approver)
router.post('/extensions/:id/reject', param('id').isInt(), requireAdminOrTaskApprove, approvalsController.rejectExtension);

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

// ── Close Requests ──────────────────────────────────────────────────────────

// POST /api/approvals/closes
router.post(
  '/closes',
  [
    body('task_id').isInt().withMessage('task_id required'),
    body('reason').notEmpty().withMessage('reason required'),
  ],
  approvalsController.createCloseRequest
);

// POST /api/approvals/closes/:id/approve  (admin or task approver)
router.post('/closes/:id/approve', param('id').isInt(), requireAdminOrTaskApprove, approvalsController.approveCloseRequest);

// POST /api/approvals/closes/:id/reject   (admin or task approver)
router.post('/closes/:id/reject', param('id').isInt(), requireAdminOrTaskApprove, approvalsController.rejectCloseRequest);

// DELETE /api/approvals/closes/:id/cancel (team member cancels own pending)
router.delete('/closes/:id/cancel', param('id').isInt(), approvalsController.cancelCloseRequest);

// ── Approvals Page Data ─────────────────────────────────────────────────────

// GET /api/approvals  — returns all sections based on role
router.get('/', approvalsController.getApprovalsPage);

// ── Badge Count ─────────────────────────────────────────────────────────────

// GET /api/approvals/badge  — pending count for nav badge
router.get('/badge', approvalsController.getBadgeCount);

module.exports = router;
