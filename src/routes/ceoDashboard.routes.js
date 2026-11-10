const express = require('express');
const router = express.Router();
const { authenticate, requireAdminOrSubmenu } = require('../middleware/auth');
const controller = require('../controllers/ceoDashboard.controller');

router.use(authenticate);

// Admins, or users granted "Dashboard 4 (CEO)" (module 'dashboard', submenu 'dashboard_ceo')
const checkCeoDashboardAccess = requireAdminOrSubmenu('dashboard', 'dashboard_ceo');

// GET /api/ceo-dashboard/overview
router.get('/overview', checkCeoDashboardAccess, controller.getOverview);

module.exports = router;
