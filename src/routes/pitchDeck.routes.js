const express = require('express');
const router  = express.Router();
const { param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const pitchDeckController = require('../controllers/pitchDeck.controller');

// PDF route BEFORE global auth (handles token via query param)
router.get('/:id/pdf', param('id').isInt(), (req, res, next) => {
  if (req.query.token) {
    req.headers['authorization'] = `Bearer ${req.query.token}`;
  }
  next();
}, authenticate, pitchDeckController.generatePdf);

// All other pitch deck routes require authentication via header
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
