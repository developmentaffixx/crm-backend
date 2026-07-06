const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireSocialAccess } = require('../middleware/socialAccess');
const controller = require('../controllers/contentCalendarSlots.controller');

router.use(authenticate);
router.use(requireSocialAccess('content_calendar'));

// GET  /api/content-calendar-slots              — list slots (with filters)
router.get('/', controller.listSlots);

// POST /api/content-calendar-slots/pickup       — pick up an open slot
router.post('/pickup', controller.pickupSlot);

// PUT  /api/content-calendar-slots/fill         — fill a slot and submit for approval
router.put('/fill', controller.fillSlot);

// PUT  /api/content-calendar-slots/approve      — admin approves a slot
router.put('/approve', controller.approveSlot);

// PUT  /api/content-calendar-slots/reject       — admin rejects a slot (with reason)
router.put('/reject', controller.rejectSlot);

// PUT  /api/content-calendar-slots/bulk-approve — admin bulk approves multiple slots
router.put('/bulk-approve', controller.bulkApprove);

// GET  /api/content-calendar-slots/pending-count — count of pending approvals (admin)
router.get('/pending-count', controller.pendingCount);

// POST /api/content-calendar-slots/share        — share calendar with client
router.post('/share', controller.shareWithClient);

// POST /api/content-calendar-slots/unshare      — revoke client access
router.post('/unshare', controller.unshareWithClient);

module.exports = router;
