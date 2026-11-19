const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/meetingMoms.controller');

router.use(authenticate);

// :source = sales | general. Access is checked per meeting in guardMeeting.
router.get('/:source/:meetingId', ctrl.guardMeeting, ctrl.get);
router.put('/:source/:meetingId', ctrl.guardMeeting, ctrl.save);
router.post('/:source/:meetingId/action-items', ctrl.guardMeeting, ctrl.addItem);
router.delete('/:source/:meetingId/action-items/:itemId', ctrl.guardMeeting, ctrl.removeItem);
router.patch('/:source/:meetingId/action-items/:itemId/link', ctrl.guardMeeting, ctrl.linkItem);

module.exports = router;
