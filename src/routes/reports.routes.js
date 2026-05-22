const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const reportsController = require('../controllers/reports.controller');

// All report routes require authentication
router.use(authenticate);

// GET /api/reports/leads — comprehensive leads analytics
router.get('/leads', reportsController.getLeadsReport);

module.exports = router;
