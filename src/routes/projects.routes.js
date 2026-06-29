const express = require('express');
const router  = express.Router();
const { body, param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const projectsController = require('../controllers/projects.controller');
const projectAllocationController = require('../controllers/projectAllocation.controller');

// All project routes require authentication
router.use(authenticate);

// GET  /api/projects/clients — get client list for dropdown
router.get('/clients', projectsController.getClients);

// GET  /api/projects/by-user/:userId — get projects for a specific user
router.get('/by-user/:userId', param('userId').isInt(), projectsController.getByUser);

// GET  /api/projects          — list projects
router.get('/', projectsController.list);

// POST /api/projects          — create project
router.post(
  '/',
  [body('title').notEmpty().withMessage('Title is required')],
  projectsController.create
);

// GET  /api/projects/:id      — get single project detail
router.get('/:id', param('id').isInt(), projectsController.getOne);

// PUT  /api/projects/:id      — update project
router.put('/:id', param('id').isInt(), projectsController.update);

// DELETE /api/projects/:id    — soft delete project
router.delete('/:id', param('id').isInt(), projectsController.remove);

// POST /api/projects/:id/tasks       — link task to project
router.post('/:id/tasks', param('id').isInt(), projectsController.addTask);

// DELETE /api/projects/:id/tasks/:taskId — unlink task
router.delete('/:id/tasks/:taskId', [param('id').isInt(), param('taskId').isInt()], projectsController.removeTask);

// POST /api/projects/:id/activities  — add activity/note
router.post('/:id/activities', param('id').isInt(), projectsController.addActivity);

// ── DRS ──
router.get('/:id/drs', param('id').isInt(), projectsController.getDrs);
router.post('/:id/drs/:section', param('id').isInt(), projectsController.saveDrs);

// ── IBRS ──
router.get('/:id/ibrs', param('id').isInt(), projectsController.getIbrs);
router.post('/:id/ibrs/:section', param('id').isInt(), projectsController.saveIbrs);

// ── Allocation Sheet ──
router.get('/:id/allocation', param('id').isInt(), projectAllocationController.get);
router.post('/:id/allocation', param('id').isInt(), projectAllocationController.save);

module.exports = router;
