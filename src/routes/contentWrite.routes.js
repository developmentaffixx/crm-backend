const express = require('express');
const router  = express.Router();
const { param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { requireSocialAccess } = require('../middleware/socialAccess');
const c = require('../controllers/contentWrite.controller');

// All routes require authentication + Contents access
router.use(authenticate);
router.use(requireSocialAccess('content_writing'));

// GET  /api/content-write                 — list (search, status, project ▸ service ▸ cycle, pagination)
router.get('/', c.list);

// POST /api/content-write/slot/:slotId/open — open a calendar post slot to write (creates Draft if missing)
router.post('/slot/:slotId/open', param('slotId').isInt(), c.openSlot);

// GET  /api/content-write/:id             — detail (+ approval history)
router.get('/:id', param('id').isInt(), c.getOne);

// GET  /api/content-write/:id/history     — approval history
router.get('/:id/history', param('id').isInt(), c.getHistory);

// POST /api/content-write                 — legacy fill (requires calendar_slot_id; no direct creation)
router.post('/', c.create);

// PUT  /api/content-write/:id/draft       — autosave (no status change)
router.put('/:id/draft', param('id').isInt(), c.saveDraft);

// POST /api/content-write/:id/submit      — save + submit for approval
router.post('/:id/submit', param('id').isInt(), c.submit);

// PUT  /api/content-write/:id             — edit (writer: resubmit · PC/PM: save only)
router.put('/:id', param('id').isInt(), c.update);

// POST /api/content-write/:id/review      — smm_accept | approve | send_back
router.post('/:id/review', param('id').isInt(), c.review);

// PUT  /api/content-write/:id/approve     — legacy approve / reject
router.put('/:id/approve', param('id').isInt(), c.approve);

// POST /api/content-write/:id/complete    — Mark as Done
router.post('/:id/complete', param('id').isInt(), c.complete);

// POST /api/content-write/:id/remodify    — writer reopens approved content
router.post('/:id/remodify', param('id').isInt(), c.remodify);

// DELETE /api/content-write/:id           — admin only; frees the calendar slot
router.delete('/:id', param('id').isInt(), c.remove);

module.exports = router;
