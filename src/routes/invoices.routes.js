const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const { param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const invoicesController = require('../controllers/invoices.controller');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// All invoice routes require authentication
router.use(authenticate);

// ── Invoices CRUD ─────────────────────────────────────────────────────────────

// GET  /api/invoices/preview-number — preview next invoice number (must be before /:id)
router.get('/preview-number', invoicesController.previewNumber);

// GET  /api/invoices/expected-cost — total expected cost from active client plans
router.get('/expected-cost', invoicesController.getExpectedCost);

// GET  /api/invoices — list all invoices
router.get('/', invoicesController.list);

// GET  /api/invoices/:id — get single invoice with items & payments
router.get('/:id', param('id').isInt(), invoicesController.getOne);

// POST /api/invoices — create invoice
router.post('/', invoicesController.create);

// PUT  /api/invoices/:id — update invoice
router.put('/:id', param('id').isInt(), invoicesController.update);

// DELETE /api/invoices/:id — soft delete
router.delete('/:id', param('id').isInt(), invoicesController.remove);

// ── Payments ──────────────────────────────────────────────────────────────────

// POST /api/invoices/:id/payments — record a payment
router.post('/:id/payments', param('id').isInt(), invoicesController.recordPayment);

// GET  /api/invoices/:id/payments — get payment history
router.get('/:id/payments', param('id').isInt(), invoicesController.getPayments);

// ── QR Upload ─────────────────────────────────────────────────────────────────

// POST /api/invoices/:id/upload-qr — upload QR code image
router.post('/:id/upload-qr', param('id').isInt(), upload.single('qr'), invoicesController.uploadQR);

// ── Email ─────────────────────────────────────────────────────────────────────

// POST /api/invoices/:id/send-email — send invoice PDF to client via email
router.post('/:id/send-email', param('id').isInt(), upload.single('pdf'), invoicesController.sendEmail);

// POST /api/invoices/:id/send-reminder — send payment reminder to client
router.post('/:id/send-reminder', param('id').isInt(), invoicesController.sendReminder);

module.exports = router;
