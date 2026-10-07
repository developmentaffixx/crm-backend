const express = require('express');
const router  = express.Router();
const { param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const withdrawalReturnsController = require('../controllers/withdrawalReturns.controller');

// All withdrawal-return routes require authentication
router.use(authenticate);

// ── Withdrawal Returns CRUD ───────────────────────────────────────────────────

// GET  /api/withdrawal-returns — list all entries
router.get('/', withdrawalReturnsController.list);

// GET  /api/withdrawal-returns/:id — get single entry
router.get('/:id', param('id').isInt(), withdrawalReturnsController.getOne);

// POST /api/withdrawal-returns — create entry
router.post('/', withdrawalReturnsController.create);

// PUT  /api/withdrawal-returns/:id — update entry
router.put('/:id', param('id').isInt(), withdrawalReturnsController.update);

// DELETE /api/withdrawal-returns/:id — soft delete
router.delete('/:id', param('id').isInt(), withdrawalReturnsController.remove);

module.exports = router;
