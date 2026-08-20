const express = require('express');
const router  = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/announcements.controller');

router.use(authenticate);

// Everyone
router.get('/', ctrl.list);
router.get('/unread-count', ctrl.unreadCount);
router.post('/:id/read', ctrl.markRead);
router.post('/mark-all-read', ctrl.markAllRead);
router.post('/:id/react', ctrl.react);

// Admin only
router.get('/:id/read-analytics', requireAdmin, ctrl.readAnalytics);
router.get('/:id/reactions', requireAdmin, ctrl.getReactions);
router.post('/', requireAdmin, ctrl.create);
router.put('/:id', requireAdmin, ctrl.update);
router.delete('/:id', requireAdmin, ctrl.remove);

module.exports = router;
