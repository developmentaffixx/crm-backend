const express = require('express');
const router  = express.Router();
const { body, param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const leadsController = require('../controllers/leads.controller');
const leadSummaryController = require('../controllers/leadSummary.controller');
const googleSheetSyncController = require('../controllers/googleSheetSync.controller');

// All lead routes require authentication
router.use(authenticate);

// GET  /api/leads/reminders/upcoming — follow-up reminders (must be before /:id)
router.get('/reminders/upcoming', leadsController.getFollowUpReminders);

// GET  /api/leads/dropdown — lightweight list for dropdowns (id, name, business_name)
router.get('/dropdown', leadsController.dropdown);

// GET  /api/leads          — list leads (filtered by role, paginated, sortable)
router.get('/', leadsController.list);

// POST /api/leads          — create lead
router.post(
  '/',
  [body('name').notEmpty().withMessage('Name is required')],
  leadsController.create
);

// POST /api/leads/sync-google-sheet — import leads from Google Sheet (must be before /:id)
router.post('/sync-google-sheet', googleSheetSyncController.syncFromGoogleSheet);

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

// PUT  /api/leads/:id/follow-ups/:followUpId — update follow-up
router.put(
  '/:id/follow-ups/:followUpId',
  [param('id').isInt(), param('followUpId').isInt()],
  leadsController.updateFollowUp
);

// POST /api/leads/:id/summary — generate AI summary + next action
router.post('/:id/summary', param('id').isInt(), leadSummaryController.generateSummary);

module.exports = router;
