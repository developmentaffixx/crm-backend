const express = require('express');
const router  = express.Router();
const { param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/softwareLicenses.controller');

router.use(authenticate);

// GET  /api/software-licenses — list all
router.get('/', ctrl.list);

// GET  /api/software-licenses/:id — get single
router.get('/:id', param('id').isInt(), ctrl.getOne);

// POST /api/software-licenses — create
router.post('/', ctrl.create);

// PUT  /api/software-licenses/:id — update
router.put('/:id', param('id').isInt(), ctrl.update);

// DELETE /api/software-licenses/:id — soft delete
router.delete('/:id', param('id').isInt(), ctrl.remove);

// POST /api/software-licenses/:id/renew — renew a license
router.post('/:id/renew', param('id').isInt(), ctrl.renew);

// GET /api/software-licenses/:id/history — get renewal history
router.get('/:id/history', param('id').isInt(), ctrl.getHistory);

module.exports = router;
