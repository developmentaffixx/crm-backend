const express = require('express');
const router  = express.Router();
const { body, param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const controller = require('../controllers/contentCalendar.controller');

router.use(authenticate);

// GET  /api/content-calendar              — list all plans
router.get('/', controller.list);

// GET  /api/content-calendar/view         — calendar view data (posts/shoots/ads for a month)
router.get('/view', controller.calendarView);

// GET  /api/content-calendar/approved-briefs — approved briefs for linking
router.get('/approved-briefs', controller.approvedBriefs);

// GET  /api/content-calendar/approved-shoots — approved shoots for linking
router.get('/approved-shoots', controller.approvedShoots);

// GET  /api/content-calendar/:id          — get single plan with children
router.get('/:id', param('id').isInt(), controller.getOne);

// POST /api/content-calendar              — create new plan
router.post(
  '/',
  [
    body('client_id').notEmpty().withMessage('Client is required'),
    body('plan_month').notEmpty().withMessage('Month is required'),
  ],
  controller.create
);

// PUT  /api/content-calendar/:id          — update plan
router.put('/:id', param('id').isInt(), controller.update);

// DELETE /api/content-calendar/:id        — soft delete
router.delete('/:id', param('id').isInt(), controller.remove);

module.exports = router;
