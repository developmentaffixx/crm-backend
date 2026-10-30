const express = require('express');
const router = express.Router();
const { param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { requireSocialAccess } = require('../middleware/socialAccess');
const dailyJournalController = require('../controllers/dailyJournal.controller');

router.use(authenticate);

// GET /api/daily-journal/report/productivity — team daily productivity report
// Guarded by report_centre access (this powers the SM Ops Report Centre → Daily tab).
// Registered BEFORE the generic routes/guard so it uses its own permission check.
router.get(
  '/report/productivity',
  requireSocialAccess('report_centre'),
  dailyJournalController.productivityReport
);

router.use(requireSocialAccess('daily_journal'));

// GET  /api/daily-journal         — list entries with filters
router.get('/', dailyJournalController.list);

// GET  /api/daily-journal/:id     — get single entry
router.get('/:id', param('id').isInt(), dailyJournalController.getOne);

// POST /api/daily-journal         — create new entry
router.post('/', dailyJournalController.create);

// PUT  /api/daily-journal/:id     — update entry
router.put('/:id', param('id').isInt(), dailyJournalController.update);

// DELETE /api/daily-journal/:id   — delete entry
router.delete('/:id', param('id').isInt(), dailyJournalController.remove);

module.exports = router;
