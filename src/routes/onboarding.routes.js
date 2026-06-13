const express    = require('express');
const router     = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const ctrl       = require('../controllers/onboarding.controller');

// All routes require authentication
router.use(authenticate);

// GET  /api/onboarding          — list all candidates
router.get('/',                  ctrl.list);

// POST /api/onboarding          — create candidate + send invitation (admin only)
router.post('/',                 requireAdmin, ctrl.create);

// GET  /api/onboarding/:afid    — get candidate detail
router.get('/:afid',             ctrl.getOne);

// PATCH /api/onboarding/:afid/status — update status (admin only)
router.patch('/:afid/status',    requireAdmin, ctrl.updateStatus);

// PATCH /api/onboarding/:afid       — update candidate name/email (admin only)
router.patch('/:afid',           requireAdmin, ctrl.update);

// POST /api/onboarding/:afid/extend  — extend candidate access (admin only)
router.post('/:afid/extend',     requireAdmin, ctrl.extendAccess);

// POST /api/onboarding/:afid/resend  — resend invitation email (admin only)
router.post('/:afid/resend',     requireAdmin, ctrl.resend);

module.exports = router;
