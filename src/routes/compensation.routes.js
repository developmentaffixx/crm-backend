const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/compensation.controller');

router.use(authenticate);

// ── Member routes ─────────────────────────────────────────────────────────────
router.get('/my-deficits', ctrl.getMyDeficits);
router.post('/request', ctrl.createRequest);
router.patch('/:id/cancel', ctrl.cancelRequest);

// ── Admin routes ──────────────────────────────────────────────────────────────
router.get('/admin/pending', requireAdmin, ctrl.getAdminPending);
router.get('/admin/all', requireAdmin, ctrl.getAdminAll);
router.patch('/:id/approve', requireAdmin, ctrl.approveRequest);
router.patch('/:id/reject', requireAdmin, ctrl.rejectRequest);
router.post('/:id/complete', requireAdmin, ctrl.completeRequest);

// ── Cron/System route ─────────────────────────────────────────────────────────
router.post('/log-weekly-deficit', requireAdmin, ctrl.logWeeklyDeficit);

module.exports = router;
