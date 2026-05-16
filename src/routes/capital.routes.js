const express = require('express');
const router  = express.Router();
const { param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const capitalController = require('../controllers/capital.controller');

// All capital routes require authentication
router.use(authenticate);

// ── P&L Summary (must be before /:id to avoid conflict) ───────────────────────
router.get('/summary/totals', capitalController.totals);

// ── Capital CRUD ──────────────────────────────────────────────────────────────

// GET  /api/capital — list all capital entries
router.get('/', capitalController.list);

// GET  /api/capital/:id — get single entry
router.get('/:id', param('id').isInt(), capitalController.getOne);

// POST /api/capital — create entry
router.post('/', capitalController.create);

// PUT  /api/capital/:id — update entry
router.put('/:id', param('id').isInt(), capitalController.update);

// DELETE /api/capital/:id — soft delete
router.delete('/:id', param('id').isInt(), capitalController.remove);

module.exports = router;
