const express = require('express');
const router  = express.Router();
const { param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/salesMeetings.controller');

router.use(authenticate);
// Resolves the user's Sales → Meetings access (menu level + on/off switches from
// Settings → Roles & Permissions). Each handler then enforces its own switch.
router.use(ctrl.loadAccess);

// GET  /api/sales-meetings            list (date range, person, lead filter), scoped by access level
router.get('/', ctrl.list);

// GET  /api/sales-meetings/stats      weekly + monthly progress, attendance rate
router.get('/stats', ctrl.stats);

// GET  /api/sales-meetings/attendees  people who can attend (?scope=any: anyone who can book or attend)
router.get('/attendees', ctrl.attendees);

// GET  /api/sales-meetings/report     Team Meetings report (needs the Team Reports switch)
router.get('/report', ctrl.report);

// POST /api/sales-meetings            book a meeting (needs the Book switch)
router.post('/', ctrl.create);

// GET  /api/sales-meetings/:id        single meeting
router.get('/:id', param('id').isInt(), ctrl.getOne);

// PUT  /api/sales-meetings/:id        edit / reschedule (needs the Edit switch)
router.put('/:id', param('id').isInt(), ctrl.update);

// PATCH /api/sales-meetings/:id/pre-confirm   pre-meeting confirmation
router.patch('/:id/pre-confirm', param('id').isInt(), ctrl.preConfirm);

// PATCH /api/sales-meetings/:id/post-confirm  outcome (needs the Attend switch)
router.patch('/:id/post-confirm', param('id').isInt(), ctrl.postConfirm);

// DELETE /api/sales-meetings/:id      soft delete (needs the Delete switch)
router.delete('/:id', param('id').isInt(), ctrl.remove);

module.exports = router;
