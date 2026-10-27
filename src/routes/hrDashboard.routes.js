const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate } = require('../middleware/auth');
const controller = require('../controllers/hrDashboard.controller');

router.use(authenticate);

/**
 * Resolves the effective `dashboard_hr` submenu access for a user.
 * User-level override wins over the role-level baseline.
 * Returns the numeric can_access level (0 = none).
 */
async function getHrSubmenuAccess(userId) {
  try {
    // 1. User-level override
    const [userSub] = await db.query(
      'SELECT can_access FROM user_submenu_permissions WHERE user_id = ? AND module = ? AND submenu = ?',
      [userId, 'dashboard', 'dashboard_hr']
    );
    if (userSub.length > 0) return userSub[0].can_access || 0;

    // 2. Role-level baseline
    const [userRole] = await db.query('SELECT role_id FROM users WHERE id = ?', [userId]);
    if (userRole.length > 0 && userRole[0].role_id) {
      const [roleSub] = await db.query(
        'SELECT can_access FROM role_submenu_permissions WHERE role_id = ? AND module = ? AND submenu = ?',
        [userRole[0].role_id, 'dashboard', 'dashboard_hr']
      );
      if (roleSub.length > 0) return roleSub[0].can_access || 0;
    }
  } catch (err) {
    console.error('getHrSubmenuAccess error:', err.message);
  }
  return 0;
}

// Middleware to verify dashboard_hr access (checks DB, not token)
const checkHrDashboardAccess = async (req, res, next) => {
  if (req.user.is_admin) return next();
  const hrAccess = await getHrSubmenuAccess(req.user.id);
  if (hrAccess >= 1) return next();

  return res.status(403).json({ message: 'Access denied: HR Dashboard access required' });
};

// GET /api/hr-dashboard/overview
router.get('/overview', checkHrDashboardAccess, controller.getOverview);

module.exports = router;
