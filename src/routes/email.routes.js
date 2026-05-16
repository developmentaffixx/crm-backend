const express = require('express');
const router  = express.Router();
const { body, param } = require('express-validator');
const { authenticate, requireAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/email.controller');

// All email routes require admin
router.use(authenticate);
router.use(requireAdmin);

// ─── SMTP Settings ────────────────────────────────────────────────────────────
router.get('/',                    ctrl.getEmailSettings);
router.put('/',                    ctrl.updateEmailSettings);
router.post('/test-connection',    ctrl.testEmailConnection);
router.post('/send-test',
  [body('to').isEmail().withMessage('Valid recipient email required')],
  ctrl.sendTestEmail
);

// ─── Templates ────────────────────────────────────────────────────────────────
router.get('/templates',                    ctrl.getTemplates);
router.get('/templates/:slug',              ctrl.getTemplate);
router.put('/templates/:slug',              ctrl.updateTemplate);
router.post('/templates/:slug/reset',       ctrl.resetTemplate);

module.exports = router;
