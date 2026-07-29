const express = require('express');
const router  = express.Router();
const { authenticate } = require('../middleware/auth');
const notificationsController = require('../controllers/notifications.controller');

router.use(authenticate);

// GET /api/notifications/unified — unified notification feed (role-based)
router.get('/unified', notificationsController.getUnifiedNotifications);

// POST /api/notifications/task-comments/mark-read — mark task comment notifications as read
router.post('/task-comments/mark-read', notificationsController.markTaskCommentsRead);

module.exports = router;
