const express = require('express');
const router  = express.Router();
const { authenticate } = require('../middleware/auth');
const c = require('../controllers/payroll.controller');

router.use(authenticate);

// ── Employee Salary ────────────────────────────────────────────────────────
router.get('/salaries',     c.listSalaries);
router.post('/salaries',    c.setSalary);
router.put('/salaries/:id', c.updateSalary);

// ── Payroll ────────────────────────────────────────────────────────────────
router.post('/generate',             c.generate);
router.get('/',                      c.list);
router.get('/:id',                   c.getOne);
router.put('/:id',                   c.update);
router.put('/:id/mark-paid',         c.markPaid);
router.post('/:id/payslip-pdf',      c.generatePayslipPdf);
router.delete('/:id',                c.remove);

module.exports = router;
