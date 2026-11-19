const express = require('express');
const router = express.Router();
const { authenticate, requireAdminOrSubmenu } = require('../middleware/auth');
const controller = require('../controllers/ceoDashboard.controller');
const todaysMeetings = require('../controllers/todaysMeetings.controller');

router.use(authenticate);

// Admins, or users granted "Dashboard 4 (CEO)" (module 'dashboard', submenu 'dashboard_ceo')
const checkCeoDashboardAccess = requireAdminOrSubmenu('dashboard', 'dashboard_ceo');

// GET /api/ceo-dashboard/overview
router.get('/overview', checkCeoDashboardAccess, controller.getOverview);

// GET /api/ceo-dashboard/todays-meetings  (Lead / Client / Team meetings involving me, today)
router.get('/todays-meetings', checkCeoDashboardAccess, todaysMeetings.getTodaysMeetings);

module.exports = router;
