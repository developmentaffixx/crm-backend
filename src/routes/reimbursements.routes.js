const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/reimbursements.controller');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Allows admins OR users granted "All" access on the reimbursements submenu.
// "All" (can_access >= 2) means create/edit/view plus approvals.
async function requireReimbursementsAccess(req, res, next) {
  try {
    if (await ctrl.hasReimbursementsAllAccess(req.user)) return next();
    return res.status(403).json({ message: 'Reimbursement management access required' });
  } catch (err) {
    console.error('requireReimbursementsAccess error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

router.use(authenticate);

// List (admin sees all, employee sees own; support ?mine=true)
router.get('/', ctrl.list);

// Personal stats for user profile page
router.get('/my-stats', ctrl.myStats);

// Stats (admin or "All" access)
router.get('/stats', requireReimbursementsAccess, ctrl.stats);

// Create (employee submits)
router.post('/', upload.single('receipt'), ctrl.create);

// Management actions (admin or "All" access)
router.put('/:id/edit', requireReimbursementsAccess, upload.single('receipt'), ctrl.edit);
router.put('/:id/approve', requireReimbursementsAccess, ctrl.approve);
router.put('/:id/reject', requireReimbursementsAccess, ctrl.reject);
router.put('/:id/mark-paid', requireReimbursementsAccess, ctrl.markPaid);

// Employee cancels own
router.delete('/:id', ctrl.cancel);

module.exports = router;
