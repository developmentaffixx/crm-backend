const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const controller = require('../controllers/socialOverview.controller');

router.use(authenticate);

// GET /api/social-overview/dashboard — aggregated social ops stats
router.get('/dashboard', controller.dashboard);

module.exports = router;
