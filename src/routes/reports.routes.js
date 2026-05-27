const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const reportsController = require('../controllers/reports.controller');
const clientsReportController = require('../controllers/clientsReport.controller');
const projectsReportController = require('../controllers/projectsReport.controller');
const ticketsReportController = require('../controllers/ticketsReport.controller');
const employeesReportController = require('../controllers/employeesReport.controller');
const financeReportController = require('../controllers/financeReport.controller');

// All report routes require authentication
router.use(authenticate);

// GET /api/reports/leads — comprehensive leads analytics
router.get('/leads', reportsController.getLeadsReport);

// GET /api/reports/clients — comprehensive client analytics
router.get('/clients', clientsReportController.getClientsReport);

// GET /api/reports/clients/:id — single client detailed report
router.get('/clients/:id', clientsReportController.getSingleClientReport);

// GET /api/reports/tickets — comprehensive ticket analytics
router.get('/tickets', ticketsReportController.getTicketsReport);

// GET /api/reports/projects/search — search projects for autocomplete
router.get('/projects/search', projectsReportController.searchProjects);

// GET /api/reports/projects — comprehensive project analytics
router.get('/projects', projectsReportController.getProjectsReport);

// GET /api/reports/projects/:id — single project detailed report
router.get('/projects/:id', projectsReportController.getSingleProjectReport);

// GET /api/reports/employees — advanced employee analytics
router.get('/employees', employeesReportController.getEmployeesReport);

// GET /api/reports/finance — advanced finance analytics
router.get('/finance', financeReportController.getFinanceReport);

module.exports = router;
