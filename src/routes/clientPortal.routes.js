const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/clientPortal.controller');

// ═══════════════════════════════════════════════════════════════
// PUBLIC (client-facing) routes — no CRM auth required
// ═══════════════════════════════════════════════════════════════

// Client login
router.post('/login', ctrl.clientLogin);

// ═══════════════════════════════════════════════════════════════
// CLIENT-AUTHENTICATED routes (client portal token)
// ═══════════════════════════════════════════════════════════════

router.get('/dashboard', ctrl.authenticateClient, ctrl.getDashboard);
router.get('/approvals', ctrl.authenticateClient, ctrl.getApprovals);
router.put('/approvals/:id', ctrl.authenticateClient, ctrl.respondApproval);
router.get('/reports', ctrl.authenticateClient, ctrl.getReports);
router.get('/notifications', ctrl.authenticateClient, ctrl.getNotifications);
router.put('/notifications/read-all', ctrl.authenticateClient, ctrl.markAllRead);
router.post('/support', ctrl.authenticateClient, ctrl.createSupportRequest);
router.get('/support', ctrl.authenticateClient, ctrl.getSupportRequests);
router.get('/roadmap', ctrl.authenticateClient, ctrl.getRoadmap);
router.get('/ideas', ctrl.authenticateClient, ctrl.getIdeas);
router.get('/meetings', ctrl.authenticateClient, ctrl.getMeetings);
router.get('/files', ctrl.authenticateClient, ctrl.getFiles);
router.get('/profile', ctrl.authenticateClient, ctrl.getProfile);

// ═══════════════════════════════════════════════════════════════
// CRM-SIDE routes (requires CRM authentication)
// ═══════════════════════════════════════════════════════════════

router.post('/create-credentials', authenticate, ctrl.createCredentials);
router.get('/credentials/:clientId', authenticate, ctrl.getCredentials);
router.put('/credentials/:clientId', authenticate, ctrl.updateCredentials);
router.put('/toggle-access/:clientId', authenticate, ctrl.toggleAccess);
router.post('/send-credentials/:clientId', authenticate, ctrl.sendCredentials);

// CRM managing portal content
router.post('/activities', authenticate, ctrl.addActivity);
router.post('/progress', authenticate, ctrl.upsertProgress);
router.post('/wins', authenticate, ctrl.addWin);
router.post('/approvals', authenticate, ctrl.createApproval);
router.post('/reports', authenticate, ctrl.addReport);
router.post('/team', authenticate, ctrl.upsertTeam);
router.post('/brand-health', authenticate, ctrl.updateBrandHealth);

module.exports = router;
