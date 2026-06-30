const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireSocialAccess } = require('../middleware/socialAccess');
const controller = require('../controllers/socialOverview.controller');

router.use(authenticate);

// GET /api/social-overview/dashboard — aggregated social ops stats
router.get('/dashboard', requireSocialAccess('social_overview'), controller.dashboard);

module.exports = router;
