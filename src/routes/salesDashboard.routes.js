const express = require('express');
const router = express.Router();
const { authenticate, getSubmenuAccess } = require('../middleware/auth');
const controller = require('../controllers/salesDashboard.controller');

router.use(authenticate);

// Admins, or users granted "Dashboard 5 (Sales)" (module 'dashboard', submenu 'dashboard_sales').
// Access level: 1 = own data only, 2 = whole team. Admins always see everything.
const checkSalesDashboardAccess = async (req, res, next) => {
  if (req.user.is_admin) {
    req.salesScope = 'all';
    return next();
  }
  const level = await getSubmenuAccess(req.user.id, 'dashboard', 'dashboard_sales');
  if (level >= 1) {
    req.salesScope = level >= 2 ? 'all' : 'own';
    return next();
  }
  return res.status(403).json({ message: 'Access denied: Sales Dashboard access required' });
};

// GET /api/sales-dashboard/overview
router.get('/overview', checkSalesDashboardAccess, controller.getOverview);

module.exports = router;
