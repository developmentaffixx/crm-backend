const express = require('express');
const router  = express.Router();
const { body, param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { requireSocialAccess } = require('../middleware/socialAccess');
const contentWriteController = require('../controllers/contentWrite.controller');

// All routes require authentication
router.use(authenticate);
router.use(requireSocialAccess('content_writing'));

// GET  /api/content-write         — list all content write requests
router.get('/', contentWriteController.list);

// GET  /api/content-write/:id     — get single request
router.get('/:id', param('id').isInt(), contentWriteController.getOne);

// POST /api/content-write         — create new request
router.post(
  '/',
  [
    body('project_id').notEmpty().withMessage('Project is required'),
    body('content_type').notEmpty().withMessage('Content type is required'),
  ],
  contentWriteController.create
);

// PUT  /api/content-write/:id     — update request
router.put(
  '/:id',
  param('id').isInt(),
  contentWriteController.update
);

// PUT  /api/content-write/:id/approve — admin approve/reject
router.put(
  '/:id/approve',
  param('id').isInt(),
  [body('action').isIn(['approve', 'reject']).withMessage('Action must be approve or reject')],
  contentWriteController.approve
);

// DELETE /api/content-write/:id   — soft delete
router.delete('/:id', param('id').isInt(), contentWriteController.remove);

module.exports = router;
