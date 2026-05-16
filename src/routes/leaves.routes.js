const express = require('express');
const router  = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/leaves.controller');

router.use(authenticate);

// List leaves (admin sees all, employee sees own)
router.get('/', ctrl.list);

// Stats (admin only)
router.get('/stats', requireAdmin, ctrl.stats);

// Approve / Reject (admin only)
router.put('/:id/approve', requireAdmin, ctrl.approve);
router.put('/:id/reject', requireAdmin, ctrl.reject);

module.exports = router;
