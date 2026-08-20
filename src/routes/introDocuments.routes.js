const express = require('express');
const router = express.Router();
const { param } = require('express-validator');
const { authenticate, requireAdmin } = require('../middleware/auth');
const controller = require('../controllers/introDocuments.controller');

router.use(authenticate);

// GET /api/intro-documents — list all (admin management view)
router.get('/', requireAdmin, controller.list);

// GET /api/intro-documents/visible — list permission-filtered documents for current user
router.get('/visible', controller.listVisible);

// GET /api/intro-documents/:id — get single document
router.get('/:id', param('id').isInt(), controller.getOne);

// POST /api/intro-documents — create (admin only)
router.post('/', requireAdmin, controller.create);

// PUT /api/intro-documents/:id — update (admin only)
router.put('/:id', requireAdmin, param('id').isInt(), controller.update);

// DELETE /api/intro-documents/:id — soft delete (admin only)
router.delete('/:id', requireAdmin, param('id').isInt(), controller.remove);

module.exports = router;
