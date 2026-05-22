const express = require('express');
const router  = express.Router();
const { body, param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const leadsController = require('../controllers/leads.controller');

// All lead routes require authentication
router.use(authenticate);

// GET  /api/leads/reminders/upcoming — follow-up reminders (must be before /:id)
router.get('/reminders/upcoming', leadsController.getFollowUpReminders);

// GET  /api/leads          — list leads (filtered by role, paginated, sortable)
router.get('/', leadsController.list);

// POST /api/leads          — create lead
router.post(
  '/',
  [body('name').notEmpty().withMessage('Name is required')],
  leadsController.create
);

// GET  /api/leads/:id      — get single lead detail
router.get('/:id', param('id').isInt(), leadsController.getOne);

// PUT  /api/leads/:id      — update lead
router.put('/:id', param('id').isInt(), leadsController.update);

// PATCH /api/leads/:id/status — quick status change
router.patch(
  '/:id/status',
  [param('id').isInt(), body('status').notEmpty().withMessage('Status is required')],
  leadsController.updateStatus
);

// DELETE /api/leads/:id    — soft-delete lead
router.delete('/:id', param('id').isInt(), leadsController.remove);

// POST /api/leads/:id/convert — convert lead to client (admin only)
router.post('/:id/convert', param('id').isInt(), leadsController.convert);

// ── Follow-ups ────────────────────────────────────────────────────────────────

// GET  /api/leads/:id/follow-ups   — list follow-ups
router.get('/:id/follow-ups', param('id').isInt(), leadsController.getFollowUps);

// POST /api/leads/:id/follow-ups   — add follow-up
router.post(
  '/:id/follow-ups',
  [
    param('id').isInt(),
    body('note').notEmpty().withMessage('Note is required'),
  ],
  leadsController.addFollowUp
);

module.exports = router;
