const express = require('express');
const router  = express.Router();
const db      = require('../config/db');
const { authenticate } = require('../middleware/auth');
const controller = require('../controllers/financeDashboard.controller');

router.use(authenticate);

/**
 * Resolves the effective `dashboard_finance` submenu access for a user.
 * User-level override wins over the role-level baseline.
 * Returns the numeric can_access level (0 = none).
 */
async function getFinanceSubmenuAccess(userId) {
  try {
    // 1. User-level override
    const [userSub] = await db.query(
      'SELECT can_access FROM user_submenu_permissions WHERE user_id = ? AND module = ? AND submenu = ?',
      [userId, 'dashboard', 'dashboard_finance']
    );
    if (userSub.length > 0) return userSub[0].can_access || 0;

    // 2. Role-level baseline
    const [userRole] = await db.query('SELECT role_id FROM users WHERE id = ?', [userId]);
    if (userRole.length > 0 && userRole[0].role_id) {
      const [roleSub] = await db.query(
        'SELECT can_access FROM role_submenu_permissions WHERE role_id = ? AND module = ? AND submenu = ?',
        [userRole[0].role_id, 'dashboard', 'dashboard_finance']
      );
      if (roleSub.length > 0) return roleSub[0].can_access || 0;
    }
  } catch (err) {
    console.error('getFinanceSubmenuAccess error:', err.message);
  }
  return 0;
}

// Middleware: Admins always pass; others need dashboard_finance submenu ≥ 1
const checkFinanceDashboardAccess = async (req, res, next) => {
  if (req.user.is_admin) return next();
  const access = await getFinanceSubmenuAccess(req.user.id);
  if (access >= 1) return next();
  return res.status(403).json({ message: 'Access denied: Finance Dashboard access required' });
};

// GET /api/finance-dashboard/overview
router.get('/overview', checkFinanceDashboardAccess, controller.getOverview);

module.exports = router;
