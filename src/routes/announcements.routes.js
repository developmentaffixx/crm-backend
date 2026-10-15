const express = require('express');
const router  = express.Router();
const { authenticate, requireAdminOrAnnouncementAccess } = require('../middleware/auth');
const ctrl = require('../controllers/announcements.controller');

router.use(authenticate);

// Everyone
router.get('/', ctrl.list);
router.get('/unread-count', ctrl.unreadCount);
router.post('/:id/read', ctrl.markRead);
router.post('/mark-all-read', ctrl.markAllRead);
router.post('/:id/react', ctrl.react);

// Admin or Announcement full access
router.get('/:id/read-analytics', requireAdminOrAnnouncementAccess, ctrl.readAnalytics);
router.get('/:id/reactions', requireAdminOrAnnouncementAccess, ctrl.getReactions);
router.post('/', requireAdminOrAnnouncementAccess, ctrl.create);
router.put('/:id', requireAdminOrAnnouncementAccess, ctrl.update);
router.delete('/:id', requireAdminOrAnnouncementAccess, ctrl.remove);

module.exports = router;

