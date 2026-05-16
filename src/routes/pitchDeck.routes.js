const express = require('express');
const router  = express.Router();
const { param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const pitchDeckController = require('../controllers/pitchDeck.controller');

// All pitch deck routes require authentication
router.use(authenticate);

// GET  /api/pitch-decks — list all pitch decks
router.get('/', pitchDeckController.list);

// GET  /api/pitch-decks/:id — get single pitch deck with all data
router.get('/:id', param('id').isInt(), pitchDeckController.getOne);

// POST /api/pitch-decks — create pitch deck
router.post('/', pitchDeckController.create);

// PUT  /api/pitch-decks/:id — update pitch deck
router.put('/:id', param('id').isInt(), pitchDeckController.update);

// DELETE /api/pitch-decks/:id — soft delete
router.delete('/:id', param('id').isInt(), pitchDeckController.remove);

module.exports = router;
