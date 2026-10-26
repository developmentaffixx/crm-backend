const express = require('express');
const router  = express.Router();
const { body, param } = require('express-validator');
const {
  authenticate, requireAdmin, requireAdminOrTaskApprove,
  canApproveTasks, approveOrTeamHeadGuard,
} = require('../middleware/auth');
const db = require('../config/db');
const approvalsController = require('../controllers/approvals.controller');

router.use(authenticate);

// Owner resolver for a deadline-extension request: the task's assignee/creator
// and the requester. A team head of any of these may approve/reject.
async function extensionOwnerIds(req) {
  const [rows] = await db.query(
    `SELECT er.requested_by, t.assigned_to, t.created_by
       FROM task_deadline_extension_requests er
       LEFT JOIN tasks t ON t.id = er.task_id
      WHERE er.id = ? AND er.deleted = 0`,
    [req.params.id]
  );
  if (rows.length === 0) return [];
  const r = rows[0];
  return [r.requested_by, r.assigned_to, r.created_by].filter(Boolean);
}

// Owner resolver for a close request.
async function closeOwnerIds(req) {
  const [rows] = await db.query(
    `SELECT cr.requested_by, t.assigned_to, t.created_by
       FROM task_close_requests cr
       LEFT JOIN tasks t ON t.id = cr.task_id
      WHERE cr.id = ? AND cr.deleted = 0`,
    [req.params.id]
  );
  if (rows.length === 0) return [];
  const r = rows[0];
  return [r.requested_by, r.assigned_to, r.created_by].filter(Boolean);
}

const extensionGuard = approveOrTeamHeadGuard(canApproveTasks, extensionOwnerIds);
const closeGuard     = approveOrTeamHeadGuard(canApproveTasks, closeOwnerIds);

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

// POST /api/approvals/extensions/:id/approve  (admin, task approver, or team head)
router.post('/extensions/:id/approve', param('id').isInt(), extensionGuard, approvalsController.approveExtension);

// POST /api/approvals/extensions/:id/reject   (admin, task approver, or team head)
router.post('/extensions/:id/reject', param('id').isInt(), extensionGuard, approvalsController.rejectExtension);

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

// POST /api/approvals/closes/:id/approve  (admin, task approver, or team head)
router.post('/closes/:id/approve', param('id').isInt(), closeGuard, approvalsController.approveCloseRequest);

// POST /api/approvals/closes/:id/reject   (admin, task approver, or team head)
router.post('/closes/:id/reject', param('id').isInt(), closeGuard, approvalsController.rejectCloseRequest);

// DELETE /api/approvals/closes/:id/cancel (team member cancels own pending)
router.delete('/closes/:id/cancel', param('id').isInt(), approvalsController.cancelCloseRequest);

// ── Approvals Page Data ─────────────────────────────────────────────────────

// GET /api/approvals  — returns all sections based on role
router.get('/', approvalsController.getApprovalsPage);

// ── Badge Count ─────────────────────────────────────────────────────────────

// GET /api/approvals/badge  — pending count for nav badge
router.get('/badge', approvalsController.getBadgeCount);

module.exports = router;
