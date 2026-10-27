const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const controller = require('../controllers/hrDashboard.controller');

router.use(authenticate);

// Middleware to verify dashboard_hr access (mirrors dashboard_pm pattern)
const checkHrDashboardAccess = (req, res, next) => {
  if (req.user.is_admin) return next();
  // Check if role or user has dashboard_hr submenu access (baked into token)
  const submenuAccess = req.user.submenuAccess;
  const hrAccess = submenuAccess?.dashboard?.dashboard_hr || 0;
  if (hrAccess >= 1) return next();

  return res.status(403).json({ message: 'Access denied: HR Dashboard access required' });
};

// GET /api/hr-dashboard/overview
router.get('/overview', checkHrDashboardAccess, controller.getOverview);

module.exports = router;
