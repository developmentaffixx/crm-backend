const express = require('express');
const router  = express.Router();
const { param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/inventories.controller');

router.use(authenticate);

// GET  /api/inventories — list all
router.get('/', ctrl.list);

// GET  /api/inventories/:id — get single
router.get('/:id', param('id').isInt(), ctrl.getOne);

// POST /api/inventories — create
router.post('/', ctrl.create);

// PUT  /api/inventories/:id — update
router.put('/:id', param('id').isInt(), ctrl.update);

// DELETE /api/inventories/:id — soft delete
router.delete('/:id', param('id').isInt(), ctrl.remove);

module.exports = router;
