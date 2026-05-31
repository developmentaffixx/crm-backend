const express = require('express');
const router  = express.Router();
const { param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const payrollController = require('../controllers/payroll.controller');

// All payroll routes require authentication
router.use(authenticate);

// ── Salary Structures ─────────────────────────────────────────────────────────

// GET  /api/payroll/structures — list all salary structures
router.get('/structures', payrollController.listStructures);

// GET  /api/payroll/structures/:id — get single structure
router.get('/structures/:id', param('id').isInt(), payrollController.getStructure);

// POST /api/payroll/structures — create salary structure
router.post('/structures', payrollController.createStructure);

// PUT  /api/payroll/structures/:id — update salary structure
router.put('/structures/:id', param('id').isInt(), payrollController.updateStructure);

// DELETE /api/payroll/structures/:id — soft delete
router.delete('/structures/:id', param('id').isInt(), payrollController.removeStructure);

// ── Payroll CRUD ──────────────────────────────────────────────────────────────

// POST /api/payroll/generate — bulk generate payroll for a month
router.post('/generate', payrollController.generate);

// GET  /api/payroll/cron-logs — last 10 auto-generate run logs
router.get('/cron-logs', payrollController.cronLogs);

// GET  /api/payroll — list all payroll records
router.get('/', payrollController.list);

// GET  /api/payroll/:id — get single payroll record
router.get('/:id', param('id').isInt(), payrollController.getOne);

// POST /api/payroll — create single payroll record
router.post('/', payrollController.create);

// PUT  /api/payroll/:id — update payroll record
router.put('/:id', param('id').isInt(), payrollController.update);

// PUT  /api/payroll/:id/mark-paid — mark as paid
router.put('/:id/mark-paid', param('id').isInt(), payrollController.markPaid);

// POST /api/payroll/:id/payslip-pdf — generate & download payslip PDF
router.post('/:id/payslip-pdf', param('id').isInt(), payrollController.generatePayslipPdf);

// POST /api/payroll/payslip-range-pdf — generate multi-month payslip PDF for one employee
router.post('/payslip-range-pdf', payrollController.generatePayslipRangePdf);

// DELETE /api/payroll/:id — soft delete
router.delete('/:id', param('id').isInt(), payrollController.remove);

module.exports = router;
