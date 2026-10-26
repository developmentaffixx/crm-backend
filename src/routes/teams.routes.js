const express = require('express');
const router  = express.Router();
const { body, param } = require('express-validator');
const { authenticate, requireAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/teams.controller');

// All team-management routes require authentication + admin.
router.use(authenticate);
router.use(requireAdmin);

router.get('/',                 ctrl.list);
router.get('/available-users',  ctrl.availableUsers);

router.post('/',
  [body('name').trim().notEmpty().withMessage('Team name is required')],
  ctrl.create
);

router.put('/:id',
  [param('id').isInt({ min: 1 })],
  ctrl.update
);

router.delete('/:id',
  [param('id').isInt({ min: 1 })],
  ctrl.remove
);

module.exports = router;
