const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const controller = require('../controllers/pmDashboard.controller');

router.use(authenticate);

// Middleware to verify dashboard_pm access
const checkPmDashboardAccess = (req, res, next) => {
  if (req.user.is_admin) return next();
  // Check if role or user has dashboard_pm submenu access
  const submenuAccess = req.user.submenuAccess;
  const pmAccess = submenuAccess?.dashboard?.dashboard_pm || 0;
  if (pmAccess >= 1) return next();

  // Also allow if user has general project coordinator / PM permissions
  return res.status(403).json({ message: 'Access denied: PM/PC Dashboard access required' });
};

// GET /api/pm-dashboard/overview
router.get('/overview', checkPmDashboardAccess, controller.getOverview);

// PUT /api/pm-dashboard/tasks/:id/status
router.put('/tasks/:id/status', checkPmDashboardAccess, controller.updateTaskStatus);

// POST /api/pm-dashboard/client-followup
router.post('/client-followup', checkPmDashboardAccess, controller.logClientFollowup);

module.exports = router;
