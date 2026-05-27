const express = require('express');
const router = express.Router();
const { param } = require('express-validator');
const { authenticate, requireAdmin } = require('../middleware/auth');
const controller = require('../controllers/ibrsSettings.controller');

router.use(authenticate);

// GET /api/ibrs-settings — list all IBRS templates (optionally ?industry_id=X)
router.get('/', controller.list);

// GET /api/ibrs-settings/project/:projectId — get IBRS for a specific project
router.get('/project/:projectId', param('projectId').isInt(), controller.getByProject);

// GET /api/ibrs-settings/:id — get single template
router.get('/:id', param('id').isInt(), controller.getOne);

// POST /api/ibrs-settings — create (admin only)
router.post('/', requireAdmin, controller.create);

// PUT /api/ibrs-settings/:id — update (admin only)
router.put('/:id', requireAdmin, param('id').isInt(), controller.update);

// DELETE /api/ibrs-settings/:id — soft delete (admin only)
router.delete('/:id', requireAdmin, param('id').isInt(), controller.remove);

module.exports = router;
