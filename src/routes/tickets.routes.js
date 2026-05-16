const express = require('express');
const router  = express.Router();
const { body, param } = require('express-validator');
const multer  = require('multer');
const path    = require('path');
const { authenticate } = require('../middleware/auth');
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

// ── Time Logs ─────────────────────────────────────────────────────────────────

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

module.exports = router;
