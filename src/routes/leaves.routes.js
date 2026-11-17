const express = require('express');
const router  = express.Router();
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/leaves.controller');

// Middleware: allow admin OR users with "All" leaves access or people_ops can_approve
async function requireLeavesAdmin(req, res, next) {
  const allowed = await ctrl.hasLeavesAllAccess(req.user);
  if (!allowed) {
    return res.status(403).json({ message: 'Admin or People Ops leave approval access required' });
  }
  next();
}

router.use(authenticate);

// List leaves (admin sees all, employee sees own)
router.get('/', ctrl.list);

// Leaves tagged to the logged-in Head (coordinator dashboard)
router.get('/team', ctrl.team);

// Step 1 approval by the tagged Head (controller verifies the user is that Head)
router.put('/:id/head-approve', ctrl.headApprove);
router.put('/:id/head-reject', ctrl.headReject);

// Stats (admin or people ops with all/approve access)
router.get('/stats', requireLeavesAdmin, ctrl.stats);

// Admin apply leave on behalf of employee (auto-approved, past dates allowed)
router.post('/admin-apply', requireLeavesAdmin, ctrl.adminApply);

// Approve / Reject (admin or people ops with all/approve access)
router.put('/:id/approve', requireLeavesAdmin, ctrl.approve);
router.put('/:id/reject', requireLeavesAdmin, ctrl.reject);

module.exports = router;
