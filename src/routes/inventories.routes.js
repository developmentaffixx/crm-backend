const express = require('express');
const router  = express.Router();
const { param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/inventories.controller');

router.use(authenticate);

// ─── Categories ───────────────────────────────────────────────────────────────
router.get('/categories', ctrl.getCategories);
router.post('/categories', ctrl.createCategory);

// ─── Recent Transactions (dashboard) ──────────────────────────────────────────
router.get('/recent-transactions', ctrl.recentTransactions);

// ─── CRUD ─────────────────────────────────────────────────────────────────────
router.get('/', ctrl.list);
router.get('/:id', param('id').isInt(), ctrl.getOne);
router.post('/', ctrl.create);
router.put('/:id', param('id').isInt(), ctrl.update);
router.delete('/:id', param('id').isInt(), ctrl.remove);

// ─── Stock Actions ────────────────────────────────────────────────────────────
router.post('/:id/stock-in', param('id').isInt(), ctrl.stockIn);
router.post('/:id/stock-out', param('id').isInt(), ctrl.stockOut);
router.get('/:id/history', param('id').isInt(), ctrl.getHistory);

module.exports = router;
