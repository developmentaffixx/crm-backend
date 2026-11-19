const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/meetingRequests.controller');

// Any logged-in employee can request a meeting; only the addressed Founder (or admin) can decide.
router.use(authenticate);

router.get('/founders', ctrl.founders);
router.get('/mine', ctrl.mine);
router.get('/inbox', ctrl.inbox);
router.post('/', ctrl.create);
router.patch('/:id/decision', ctrl.decide);
router.patch('/:id/cancel', ctrl.cancel);

module.exports = router;
