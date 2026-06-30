const express = require('express');
const router  = express.Router();
const { body, param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { requireSocialAccess } = require('../middleware/socialAccess');
const shootsController = require('../controllers/shoots.controller');

router.use(authenticate);
router.use(requireSocialAccess('shoot_planning'));

// GET  /api/shoots
router.get('/', shootsController.list);

// GET  /api/shoots/:id
router.get('/:id', param('id').isInt(), shootsController.getOne);

// POST /api/shoots
router.post(
  '/',
  [
    body('project_campaign_name').notEmpty().withMessage('Project/Campaign name is required'),
    body('shoot_date').notEmpty().withMessage('Shoot date is required'),
    body('reporting_time').notEmpty().withMessage('Reporting time is required'),
    body('location_type').notEmpty().withMessage('Location type is required'),
  ],
  shootsController.create
);

// PUT  /api/shoots/:id
router.put('/:id', param('id').isInt(), shootsController.update);

// PUT  /api/shoots/:id/approve (admin)
router.put(
  '/:id/approve',
  param('id').isInt(),
  [body('action').isIn(['approve', 'reject']).withMessage('Action must be approve or reject')],
  shootsController.approve
);

// DELETE /api/shoots/:id
router.delete('/:id', param('id').isInt(), shootsController.remove);

module.exports = router;
