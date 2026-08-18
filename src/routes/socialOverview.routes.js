const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireSocialAccess } = require('../middleware/socialAccess');
const controller = require('../controllers/socialOverview.controller');

router.use(authenticate);

// GET /api/social-overview/summary — summary cards data
router.get('/summary', requireSocialAccess('social_overview'), controller.getSummary);

// GET /api/social-overview/projects — list all tracking entries
router.get('/projects', requireSocialAccess('social_overview'), controller.getProjects);

// GET /api/social-overview/projects-list — project dropdown for add modal
router.get('/projects-list', requireSocialAccess('social_overview'), controller.getProjectsList);

// POST /api/social-overview/projects — create new entry
router.post('/projects', requireSocialAccess('social_overview'), controller.createProject);

// PUT /api/social-overview/projects/:id — full update
router.put('/projects/:id', requireSocialAccess('social_overview'), controller.updateProject);

// PATCH /api/social-overview/projects/:id/inline — inline count update
router.patch('/projects/:id/inline', requireSocialAccess('social_overview'), controller.inlineUpdate);

// DELETE /api/social-overview/projects/:id — delete entry
router.delete('/projects/:id', requireSocialAccess('social_overview'), controller.deleteProject);

module.exports = router;
