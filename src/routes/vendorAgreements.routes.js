const express = require('express');
const router  = express.Router();
const { param, body } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/vendorAgreements.controller');

// All routes require authentication
router.use(authenticate);

// ─── Templates (must be before /:id to avoid conflict) ────────────────────────
router.get('/templates/list',       ctrl.listTemplates);
router.get('/templates/:key',       ctrl.getTemplate);
router.put('/templates/:key',       ctrl.updateTemplate);

// ─── Generate PDF ─────────────────────────────────────────────────────────────
router.post('/generate', ctrl.generate);

// ─── Agreements CRUD ──────────────────────────────────────────────────────────
router.get('/',    ctrl.list);
router.get('/:id', param('id').isInt(), ctrl.getOne);
router.post('/',   ctrl.create);
router.put('/:id', param('id').isInt(), ctrl.update);
router.delete('/:id', param('id').isInt(), ctrl.remove);

module.exports = router;
