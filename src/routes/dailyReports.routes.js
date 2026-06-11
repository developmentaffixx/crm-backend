const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const dailyReportsController = require('../controllers/dailyReports.controller');

// All routes require authentication
router.use(authenticate);

// GET /api/daily-reports/targets — static daily targets
router.get('/targets', dailyReportsController.getTargets);

// GET /api/daily-reports/auto-stats — auto-calculated stats from CRM data
router.get('/auto-stats', dailyReportsController.autoStats);

// GET /api/daily-reports/summary/weekly — weekly summary
router.get('/summary/weekly', dailyReportsController.weeklySummary);

// GET /api/daily-reports — list reports (paginated, filtered)
router.get('/', dailyReportsController.list);

// POST /api/daily-reports — submit daily report
router.post(
  '/',
  [body('report_date').notEmpty().withMessage('Report date is required')],
  dailyReportsController.create
);

// GET /api/daily-reports/:id — get single report
router.get('/:id', param('id').isInt(), dailyReportsController.getOne);

// PUT /api/daily-reports/:id — update report
router.put('/:id', param('id').isInt(), dailyReportsController.update);

// DELETE /api/daily-reports/:id — delete report
router.delete('/:id', param('id').isInt(), dailyReportsController.remove);

module.exports = router;
