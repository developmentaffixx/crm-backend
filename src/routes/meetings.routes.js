const express = require('express');
const router  = express.Router();
const { param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const meetingsController = require('../controllers/meetings.controller');

// All meeting routes require authentication
router.use(authenticate);

// GET  /api/meetings/today-count — badge count for sidebar
router.get('/today-count', meetingsController.todayCount);

// GET  /api/meetings          — list meetings
router.get('/', meetingsController.list);

// GET  /api/meetings/:id      — get single meeting
router.get('/:id', param('id').isInt(), meetingsController.getOne);

// POST /api/meetings          — create meeting
router.post('/', meetingsController.create);

// PUT  /api/meetings/:id      — update meeting
router.put('/:id', param('id').isInt(), meetingsController.update);

// DELETE /api/meetings/:id    — soft-delete meeting
router.delete('/:id', param('id').isInt(), meetingsController.remove);

module.exports = router;
