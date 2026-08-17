const express = require('express');
const router = express.Router();
const { param } = require('express-validator');
const { authenticate, requireAdmin } = require('../middleware/auth');
const controller = require('../controllers/smmDocuments.controller');

router.use(authenticate);

// GET /api/smm-documents — list all (admin settings)
router.get('/', controller.list);

// GET /api/smm-documents/page/:page — get visible documents for a specific page
router.get('/page/:page', controller.getByPage);

// GET /api/smm-documents/:id — get single document
router.get('/:id', param('id').isInt(), controller.getOne);

// POST /api/smm-documents — create (admin only)
router.post('/', requireAdmin, controller.create);

// PUT /api/smm-documents/:id — update (admin only)
router.put('/:id', requireAdmin, param('id').isInt(), controller.update);

// PATCH /api/smm-documents/:id/toggle — toggle visibility (admin only)
router.patch('/:id/toggle', requireAdmin, param('id').isInt(), controller.toggleVisibility);

// DELETE /api/smm-documents/:id — soft delete (admin only)
router.delete('/:id', requireAdmin, param('id').isInt(), controller.remove);

module.exports = router;
