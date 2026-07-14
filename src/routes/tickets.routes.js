const express = require('express');
const router  = express.Router();
const { body, param } = require('express-validator');
const multer  = require('multer');
const path    = require('path');
const { authenticate, requireAdmin } = require('../middleware/auth');
const ticketsController = require('../controllers/tickets.controller');

// Multer config for ticket attachments
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, path.join(__dirname, '../../uploads')),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `ticket-${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.pdf', '.doc', '.docx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(null, false); // silently skip unsupported files instead of throwing
    }
  },
});

// Wrapper to handle multer errors gracefully
function handleUpload(req, res, next) {
  upload.array('attachments', 5)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ message: err.message });
    }
    if (err) {
      return res.status(400).json({ message: err.message });
    }
    next();
  });
}

// All ticket routes require authentication
router.use(authenticate);

// GET  /api/tickets/stats   — dashboard stats
router.get('/stats', ticketsController.stats);

// GET  /api/tickets/my-active-timer — get current user's running ticket timer
router.get('/my-active-timer', ticketsController.getMyActiveTimer);

// GET  /api/tickets         — list tickets
router.get('/', ticketsController.list);

// POST /api/tickets         — create ticket
router.post(
  '/',
  handleUpload,
  [body('title').notEmpty().withMessage('Title is required')],
  ticketsController.create
);

// GET  /api/tickets/:id     — get single ticket detail
router.get('/:id', param('id').isInt(), ticketsController.getOne);

// PUT  /api/tickets/:id     — update ticket
router.put(
  '/:id',
  handleUpload,
  param('id').isInt(),
  ticketsController.update
);

// DELETE /api/tickets/:id   — soft-delete ticket
router.delete('/:id', param('id').isInt(), ticketsController.remove);

// ── Comments ──────────────────────────────────────────────────────────────────

// POST /api/tickets/:id/comments
router.post(
  '/:id/comments',
  [
    param('id').isInt(),
    body('comment').notEmpty().withMessage('Comment is required'),
  ],
  ticketsController.addComment
);

// ── Timer (Work mode — start/stop) ────────────────────────────────────────────

// POST /api/tickets/:id/timer/start
router.post('/:id/timer/start', param('id').isInt(), ticketsController.startTimer);

// POST /api/tickets/:id/timer/stop
router.post('/:id/timer/stop', param('id').isInt(), ticketsController.stopTimer);

// GET /api/tickets/:id/timer/status
router.get('/:id/timer/status', param('id').isInt(), ticketsController.getTimerStatus);

// GET /api/tickets/:id/timer/logs
router.get('/:id/timer/logs', param('id').isInt(), ticketsController.getTimerLogs);

// ── Time Logs (legacy manual entry) ──────────────────────────────────────────

// POST /api/tickets/:id/time-logs
router.post(
  '/:id/time-logs',
  [
    param('id').isInt(),
    body('minutes').isInt({ min: 1 }).withMessage('Minutes must be at least 1'),
  ],
  ticketsController.addTimeLog
);

// ── Attachments ───────────────────────────────────────────────────────────────

// DELETE /api/tickets/:id/attachments/:attachmentId
router.delete(
  '/:id/attachments/:attachmentId',
  [param('id').isInt(), param('attachmentId').isInt()],
  ticketsController.removeAttachment
);

// ── Mark as Done / Approve / Reject ──────────────────────────────────────────

// POST /api/tickets/:id/mark-done  — assigned user or reporter marks ticket done (pending approval)
router.post('/:id/mark-done', param('id').isInt(), ticketsController.markDone);

// POST /api/tickets/:id/approve-done  — admin approves completion
router.post('/:id/approve-done', param('id').isInt(), requireAdmin, ticketsController.approveDone);

// POST /api/tickets/:id/reject-done   — admin rejects completion
router.post('/:id/reject-done', param('id').isInt(), requireAdmin, ticketsController.rejectDone);

// ── Deadline Extension Requests ──────────────────────────────────────────────

// GET /api/tickets/:id/extension-requests — list extension requests for a ticket
router.get('/:id/extension-requests', param('id').isInt(), ticketsController.getExtensionRequests);

// POST /api/tickets/:id/extension-request — create new extension request
router.post(
  '/:id/extension-request',
  [
    param('id').isInt(),
    body('requested_deadline').isDate().withMessage('requested_deadline (YYYY-MM-DD) required'),
    body('reason').notEmpty().withMessage('reason required'),
  ],
  ticketsController.createExtensionRequest
);

// POST /api/tickets/:id/extension-request/:extId/approve  (admin)
router.post(
  '/:id/extension-request/:extId/approve',
  [param('id').isInt(), param('extId').isInt()],
  requireAdmin,
  ticketsController.approveExtensionRequest
);

// POST /api/tickets/:id/extension-request/:extId/reject   (admin)
router.post(
  '/:id/extension-request/:extId/reject',
  [param('id').isInt(), param('extId').isInt()],
  requireAdmin,
  ticketsController.rejectExtensionRequest
);

// DELETE /api/tickets/:id/extension-request/:extId/cancel  (requester cancels own)
router.delete(
  '/:id/extension-request/:extId/cancel',
  [param('id').isInt(), param('extId').isInt()],
  ticketsController.cancelExtensionRequest
);

module.exports = router;
