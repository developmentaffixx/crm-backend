const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const { authenticate, requireAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/reimbursements.controller');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

router.use(authenticate);

// List (admin sees all, employee sees own)
router.get('/', ctrl.list);

// Stats (admin)
router.get('/stats', requireAdmin, ctrl.stats);

// Create (employee submits)
router.post('/', upload.single('receipt'), ctrl.create);

// Admin actions
router.put('/:id/edit', requireAdmin, upload.single('receipt'), ctrl.edit);
router.put('/:id/approve', requireAdmin, ctrl.approve);
router.put('/:id/reject', requireAdmin, ctrl.reject);
router.put('/:id/mark-paid', requireAdmin, ctrl.markPaid);

// Employee cancels own
router.delete('/:id', ctrl.cancel);

module.exports = router;
