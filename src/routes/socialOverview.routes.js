const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireSocialAccess } = require('../middleware/socialAccess');
const controller = require('../controllers/socialOverview.controller');

router.use(authenticate);

// GET /api/social-overview/projects — aggregated project list from content calendar
router.get('/projects', requireSocialAccess('social_overview'), controller.getProjects);

// GET /api/social-overview/summary — summary cards data
router.get('/summary', requireSocialAccess('social_overview'), controller.getSummary);

module.exports = router;
