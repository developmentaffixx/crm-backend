const express = require('express');
const router  = express.Router();
const { param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const withdrawalsController = require('../controllers/withdrawals.controller');

// All withdrawal routes require authentication
router.use(authenticate);

// ── Withdrawals CRUD ──────────────────────────────────────────────────────────

// GET  /api/withdrawals — list all withdrawals
router.get('/', withdrawalsController.list);

// GET  /api/withdrawals/:id — get single entry
router.get('/:id', param('id').isInt(), withdrawalsController.getOne);

// POST /api/withdrawals — create entry
router.post('/', withdrawalsController.create);

// PUT  /api/withdrawals/:id — update entry
router.put('/:id', param('id').isInt(), withdrawalsController.update);

// DELETE /api/withdrawals/:id — soft delete
router.delete('/:id', param('id').isInt(), withdrawalsController.remove);

module.exports = router;
