const express = require('express');
const router  = express.Router();
const { param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const clientsController = require('../controllers/clients.controller');

// All client routes require authentication
router.use(authenticate);

// GET  /api/clients          — list clients (won leads)
router.get('/', clientsController.list);

// GET  /api/clients/:id      — get single client detail
router.get('/:id', param('id').isInt(), clientsController.getOne);

module.exports = router;
