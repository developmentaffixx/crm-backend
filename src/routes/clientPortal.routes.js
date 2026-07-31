const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/clientPortal.controller');
const v2 = require('../controllers/clientPortalV2.controller');

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

// V2 client-facing routes
router.get('/services/:serviceType', ctrl.authenticateClient, v2.getServiceModule);
router.get('/knowledge-hub', ctrl.authenticateClient, v2.getKnowledgeHub);
router.get('/weekly-updates', ctrl.authenticateClient, v2.getWeeklyUpdates);
router.get('/upsell', ctrl.authenticateClient, v2.getUpsell);
router.get('/milestones', ctrl.authenticateClient, v2.getMilestones);
router.put('/milestones/:id/celebrate', ctrl.authenticateClient, v2.celebrateMilestone);
router.get('/behind-the-scenes', ctrl.authenticateClient, v2.getBehindTheScenes);

// Content Calendar — client views shared calendar (only if access enabled)
const calendarSlotsCtrl = require('../controllers/contentCalendarSlots.controller');
router.get('/content-calendar', ctrl.authenticateClient, async (req, res, next) => {
  try {
    const [rows] = await require('../config/db').query(
      'SELECT content_calendar_access FROM client_portal_users WHERE client_id = ?',
      [req.clientUser.client_id]
    );
    if (!rows.length || !rows[0].content_calendar_access) {
      return res.status(403).json({ message: 'Content Calendar access is not enabled for your portal' });
    }
    req.clientId = req.clientUser.client_id;
    calendarSlotsCtrl.clientViewCalendar(req, res);
  } catch (err) {
    return res.status(500).json({ message: 'Server error' });
  }
});

// ═══════════════════════════════════════════════════════════════
// CRM-SIDE routes (requires CRM authentication)
// ═══════════════════════════════════════════════════════════════

router.post('/create-credentials', authenticate, ctrl.createCredentials);
router.get('/credentials/:clientId', authenticate, ctrl.getCredentials);
router.put('/credentials/:clientId', authenticate, ctrl.updateCredentials);
router.put('/toggle-access/:clientId', authenticate, ctrl.toggleAccess);
router.put('/toggle-calendar/:clientId', authenticate, ctrl.toggleCalendarAccess);
router.put('/menu-access/:clientId', authenticate, ctrl.updateMenuAccess);
router.post('/send-credentials/:clientId', authenticate, ctrl.sendCredentials);

// CRM managing portal content
router.post('/activities', authenticate, ctrl.addActivity);
router.post('/progress', authenticate, ctrl.upsertProgress);
router.post('/wins', authenticate, ctrl.addWin);
router.post('/approvals', authenticate, ctrl.createApproval);
router.post('/reports', authenticate, ctrl.addReport);
router.post('/team', authenticate, ctrl.upsertTeam);
router.post('/brand-health', authenticate, ctrl.updateBrandHealth);

// V2 CRM-side routes
router.post('/service-updates', authenticate, v2.addServiceUpdate);
router.post('/knowledge', authenticate, v2.addKnowledge);
router.post('/weekly-updates', authenticate, v2.addWeeklyUpdate);
router.post('/upsell', authenticate, v2.addUpsell);
router.post('/milestones', authenticate, v2.addMilestone);
router.post('/behind-the-scenes', authenticate, v2.addBTS);

module.exports = router;
