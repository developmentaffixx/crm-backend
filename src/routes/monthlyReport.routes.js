const express = require('express');
const router = express.Router();
const multer = require('multer');
const { param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const controller = require('../controllers/monthlyReport.controller');

// Multer for image uploads (max 1MB, images only)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'), false);
  },
});

router.use(authenticate);

// ── Static paths first (before :id param routes) ─────────────────────────────

// POST /api/monthly-reports/upload-image — upload post screenshot
router.post('/upload-image', upload.single('image'), controller.uploadImage);

// DELETE /api/monthly-reports/delete-image — remove uploaded image
router.delete('/delete-image', controller.deleteImage);

// ── CRUD routes ──────────────────────────────────────────────────────────────

// GET /api/monthly-reports — list reports
router.get('/', controller.list);

// POST /api/monthly-reports — create report
router.post('/', controller.create);

// GET /api/monthly-reports/:id — get single report
router.get('/:id', param('id').isInt(), controller.getOne);

// GET /api/monthly-reports/:id/pdf — export as PDF
router.get('/:id/pdf', param('id').isInt(), controller.exportPdf);

// PUT /api/monthly-reports/:id — update report
router.put('/:id', param('id').isInt(), controller.update);

// DELETE /api/monthly-reports/:id — delete report
router.delete('/:id', param('id').isInt(), controller.remove);

module.exports = router;
