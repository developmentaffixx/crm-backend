const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireSocialAccess } = require('../middleware/socialAccess');
const controller = require('../controllers/contentCalendarSlots.controller');

router.use(authenticate);
router.use(requireSocialAccess('content_calendar'));

// GET  /api/content-calendar-slots              — list slots (with filters)
router.get('/', controller.listSlots);

// POST /api/content-calendar-slots/assign       — assign a slot to a user (admin/SMM)
router.post('/assign', controller.assignSlot);

// PUT  /api/content-calendar-slots/submit       — submit filled slot for approval
router.put('/submit', controller.submitSlot);

// PUT  /api/content-calendar-slots/approve      — approve a submitted slot
router.put('/approve', controller.approveSlot);

// PUT  /api/content-calendar-slots/reject       — reject a slot (with reason)
router.put('/reject', controller.rejectSlot);

// PUT  /api/content-calendar-slots/complete     — mark approved slot as completed
router.put('/complete', controller.completeSlot);

// PUT  /api/content-calendar-slots/bulk-approve — bulk approve multiple slots
router.put('/bulk-approve', controller.bulkApprove);

// GET  /api/content-calendar-slots/pending-count — badge counts
router.get('/pending-count', controller.pendingCount);

// GET  /api/content-calendar-slots/notifications — get SMM notifications
router.get('/notifications', controller.getSmmNotifications);

// PUT  /api/content-calendar-slots/notifications/read — mark as read
router.put('/notifications/read', controller.markNotificationRead);

// POST /api/content-calendar-slots/share        — share calendar with client
router.post('/share', controller.shareWithClient);

// POST /api/content-calendar-slots/unshare      — revoke client access
router.post('/unshare', controller.unshareWithClient);

module.exports = router;
