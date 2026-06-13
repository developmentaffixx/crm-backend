const express = require('express');
const router  = express.Router();
const { body, param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const leadsController = require('../controllers/leads.controller');
const leadSummaryController = require('../controllers/leadSummary.controller');
const leadSwotController = require('../controllers/leadSwot.controller');
const googleSheetSyncController = require('../controllers/googleSheetSync.controller');

// All lead routes require authentication
router.use(authenticate);

// GET  /api/leads/reminders/upcoming — follow-up reminders (must be before /:id)
router.get('/reminders/upcoming', leadsController.getFollowUpReminders);

// GET  /api/leads/dropdown — lightweight list for dropdowns (id, name, business_name)
router.get('/dropdown', leadsController.dropdown);

// GET  /api/leads/filter-options — distinct values for filter dropdowns
router.get('/filter-options', leadsController.getFilterOptions);

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

// GET  /api/leads/follow-ups/custom-options — get custom types/outcomes (must be before /:id/follow-ups)
router.get('/follow-ups/custom-options', leadsController.getFollowUpCustomOptions);

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

// ── SWOT (Talk) ───────────────────────────────────────────────────────────────

// GET  /api/leads/:id/swot — get all SWOT points
router.get('/:id/swot', param('id').isInt(), leadSwotController.getSwot);

// POST /api/leads/:id/swot — add a SWOT point
router.post(
  '/:id/swot',
  [
    param('id').isInt(),
    body('category').isIn(['strength', 'weakness', 'opportunity']).withMessage('Invalid category'),
    body('point').notEmpty().withMessage('Point is required'),
  ],
  leadSwotController.addSwotPoint
);

// PUT  /api/leads/:id/swot/:pointId — update a SWOT point
router.put(
  '/:id/swot/:pointId',
  [param('id').isInt(), param('pointId').isInt(), body('point').notEmpty()],
  leadSwotController.updateSwotPoint
);

// DELETE /api/leads/:id/swot/:pointId — delete a SWOT point
router.delete(
  '/:id/swot/:pointId',
  [param('id').isInt(), param('pointId').isInt()],
  leadSwotController.deleteSwotPoint
);

module.exports = router;
