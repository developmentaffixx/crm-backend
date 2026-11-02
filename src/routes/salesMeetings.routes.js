const express = require('express');
const router  = express.Router();
const { body, param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/salesMeetings.controller');

router.use(authenticate);

// GET  /api/sales-meetings          — list (date range, user, lead filter)
router.get('/', ctrl.list);

// GET  /api/sales-meetings/stats    — weekly + monthly target progress
router.get('/stats', ctrl.stats);

// POST /api/sales-meetings          — create meeting
router.post('/',
  [
    body('meeting_date').notEmpty().withMessage('meeting_date is required'),
    body('slot').isIn(['morning','afternoon','evening']).withMessage('Invalid slot'),
  ],
  ctrl.create
);

// GET  /api/sales-meetings/:id      — get single meeting
router.get('/:id', param('id').isInt(), ctrl.getOne);

// PUT  /api/sales-meetings/:id      — full update
router.put('/:id', param('id').isInt(), ctrl.update);

// PATCH /api/sales-meetings/:id/pre-confirm   — pre-meeting confirmation
router.patch('/:id/pre-confirm', param('id').isInt(), ctrl.preConfirm);

// PATCH /api/sales-meetings/:id/post-confirm  — post-meeting confirmation + outcome
router.patch('/:id/post-confirm',
  [
    param('id').isInt(),
    body('outcome').isIn(['attended','no_show','rescheduled','converted','follow_up']).withMessage('Invalid outcome'),
  ],
  ctrl.postConfirm
);

// DELETE /api/sales-meetings/:id    — soft delete
router.delete('/:id', param('id').isInt(), ctrl.remove);

module.exports = router;
