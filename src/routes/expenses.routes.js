const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const { param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const expensesController = require('../controllers/expenses.controller');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// All expense routes require authentication
router.use(authenticate);

// ── Expenses CRUD ─────────────────────────────────────────────────────────────

// GET  /api/expenses — list all expenses
router.get('/', expensesController.list);

// GET  /api/expenses/:id — get single expense
router.get('/:id', param('id').isInt(), expensesController.getOne);

// POST /api/expenses — create expense (with optional bill upload)
router.post('/', upload.single('bill_copy'), expensesController.create);

// PUT  /api/expenses/:id — update expense (with optional bill upload)
router.put('/:id', param('id').isInt(), upload.single('bill_copy'), expensesController.update);

// DELETE /api/expenses/:id — soft delete
router.delete('/:id', param('id').isInt(), expensesController.remove);

module.exports = router;
