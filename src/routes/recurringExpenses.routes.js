const express = require('express');
const router  = express.Router();
const { param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/recurringExpenses.controller');

// All recurring expense routes require authentication
router.use(authenticate);

// GET  /api/recurring-expenses — list all
router.get('/', ctrl.list);

// GET  /api/recurring-expenses/:id — get single
router.get('/:id', param('id').isInt(), ctrl.getOne);

// POST /api/recurring-expenses — create
router.post('/', ctrl.create);

// PUT  /api/recurring-expenses/:id — update
router.put('/:id', param('id').isInt(), ctrl.update);

// PATCH /api/recurring-expenses/:id/pause — pause
router.patch('/:id/pause', param('id').isInt(), ctrl.pause);

// PATCH /api/recurring-expenses/:id/resume — resume
router.patch('/:id/resume', param('id').isInt(), ctrl.resume);

// DELETE /api/recurring-expenses/:id — soft delete
router.delete('/:id', param('id').isInt(), ctrl.remove);

module.exports = router;
