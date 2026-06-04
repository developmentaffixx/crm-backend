const express = require('express');
const router  = express.Router();
const { body, param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/proposals.controller');

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC routes (no authentication — client-facing)
// Must be defined BEFORE router.use(authenticate)
// ─────────────────────────────────────────────────────────────────────────────

// GET  /api/proposals/public/:token — client views proposal
router.get('/public/:token', ctrl.getPublic);

// PATCH /api/proposals/public/:token/respond — client accepts / rejects
router.patch(
  '/public/:token/respond',
  [
    body('action')
      .isIn(['accepted', 'rejected'])
      .withMessage('Action must be accepted or rejected'),
  ],
  ctrl.respond
);

// ─────────────────────────────────────────────────────────────────────────────
// AUTHENTICATED routes (CRM side — requires login)
// ─────────────────────────────────────────────────────────────────────────────
router.use(authenticate);

// GET  /api/proposals          — list proposals
router.get('/', ctrl.list);

// POST /api/proposals          — create proposal
router.post(
  '/',
  [
    body('title').notEmpty().withMessage('Title is required'),
    body('client_name').notEmpty().withMessage('Client name is required'),
  ],
  ctrl.create
);

// GET  /api/proposals/:id      — get single proposal
router.get('/:id', param('id').isInt(), ctrl.getOne);

// PUT  /api/proposals/:id      — update proposal
router.put('/:id', param('id').isInt(), ctrl.update);

// PATCH /api/proposals/:id/mark-sent — mark as sent when link is copied
router.patch('/:id/mark-sent', param('id').isInt(), ctrl.markSent);

// DELETE /api/proposals/:id    — soft delete
router.delete('/:id', param('id').isInt(), ctrl.remove);

module.exports = router;
