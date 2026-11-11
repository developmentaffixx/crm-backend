const express = require('express');
const router = express.Router();
const { authenticate, getSubmenuAccess } = require('../middleware/auth');
const ctrl = require('../controllers/ceoReminders.controller');

router.use(authenticate);

/**
 * Resolves whether the user is "CEO side": admin OR has "Dashboard 4 (CEO)"
 * (module 'dashboard', submenu 'dashboard_ceo'). Checked live from DB.
 */
async function resolveCeo(req, _res, next) {
  try {
    req.isCeoUser = !!req.user.is_admin
      || (await getSubmenuAccess(req.user.id, 'dashboard', 'dashboard_ceo')) >= 1;
  } catch {
    req.isCeoUser = false;
  }
  next();
}

function requireCeo(req, res, next) {
  if (req.isCeoUser) return next();
  return res.status(403).json({ message: 'Access denied: CEO Dashboard access required' });
}

router.use(resolveCeo);

// ── Head side (recipient only — checked inside the controller) ──────────────
// Registered before '/:id' so 'my' isn't captured as an id.
router.get('/my', ctrl.myReminders);
router.patch('/my/:id/status', ctrl.updateMyStatus);
router.post('/my/:id/note', ctrl.addMyNote);

// ── CEO side ────────────────────────────────────────────────────────────────
router.get('/heads', requireCeo, ctrl.listHeads);
router.get('/link-search', requireCeo, ctrl.linkSearch);
router.get('/summary', requireCeo, ctrl.summary);
router.get('/', requireCeo, ctrl.list);
router.post('/', requireCeo, ctrl.create);

// Detail: CEO or the recipient (checked in controller)
router.get('/:id', ctrl.getOne);

router.put('/:id', requireCeo, ctrl.update);
router.post('/:id/follow-up', requireCeo, ctrl.followUp);
router.patch('/:id/close', requireCeo, ctrl.close);
router.patch('/:id/reopen', requireCeo, ctrl.reopen);
router.delete('/:id', requireCeo, ctrl.remove);

module.exports = router;
