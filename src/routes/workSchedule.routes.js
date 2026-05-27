const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/workSchedule.controller');

router.use(authenticate);

// Anyone can view the schedule and today's info
router.get('/', ctrl.getSchedule);
router.get('/today', ctrl.getToday);
router.get('/week-preview', ctrl.weekPreview);

// Only admin can update
router.put('/', requireAdmin, ctrl.updateSchedule);
router.post('/override', requireAdmin, ctrl.createOverride);
router.delete('/override/:weekStart', requireAdmin, ctrl.deleteOverride);

module.exports = router;
