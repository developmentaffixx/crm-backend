const express = require('express');
const router = express.Router();
const { param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const dailyJournalController = require('../controllers/dailyJournal.controller');

router.use(authenticate);

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
