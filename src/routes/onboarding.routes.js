const express    = require('express');
const router     = express.Router();
const { authenticate } = require('../middleware/auth');
const ctrl       = require('../controllers/onboarding.controller');

async function requireOnboardingCreate(req, res, next) {
  const allowed = await ctrl.hasOnboardingAccess(req.user, 'create');
  if (!allowed) return res.status(403).json({ message: 'On-boarding create access required' });
  next();
}

async function requireOnboardingEdit(req, res, next) {
  const allowed = await ctrl.hasOnboardingAccess(req.user, 'edit');
  if (!allowed) return res.status(403).json({ message: 'On-boarding edit access required' });
  next();
}

async function requireOnboardingApprove(req, res, next) {
  const allowed = await ctrl.hasOnboardingAccess(req.user, 'approve');
  if (!allowed) return res.status(403).json({ message: 'On-boarding approval access required' });
  next();
}

// All routes require authentication
router.use(authenticate);

// GET  /api/onboarding          — list all candidates
router.get('/',                  ctrl.list);

// POST /api/onboarding          — create candidate + send invitation
router.post('/',                 requireOnboardingCreate, ctrl.create);

// GET  /api/onboarding/:afid    — get candidate detail
router.get('/:afid',             ctrl.getOne);

// PATCH /api/onboarding/:afid/status — update status (Approve / Reject)
router.patch('/:afid/status',    requireOnboardingApprove, ctrl.updateStatus);

// PATCH /api/onboarding/:afid/details — update section data
router.patch('/:afid/details',   requireOnboardingEdit, ctrl.updateDetails);

// PATCH /api/onboarding/:afid       — update candidate name/email
router.patch('/:afid',           requireOnboardingEdit, ctrl.update);

// POST /api/onboarding/:afid/extend  — extend candidate access
router.post('/:afid/extend',     requireOnboardingEdit, ctrl.extendAccess);

// POST /api/onboarding/:afid/resend  — resend invitation email
router.post('/:afid/resend',     requireOnboardingEdit, ctrl.resend);

module.exports = router;
