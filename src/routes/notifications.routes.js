const express = require('express');
const router  = express.Router();
const { authenticate } = require('../middleware/auth');
const notificationsController = require('../controllers/notifications.controller');

router.use(authenticate);

// GET /api/notifications/unified — unified notification feed (role-based)
router.get('/unified', notificationsController.getUnifiedNotifications);

module.exports = router;
