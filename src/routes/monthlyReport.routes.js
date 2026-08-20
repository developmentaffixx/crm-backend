const express = require('express');
const router = express.Router();
const multer = require('multer');
const { param } = require('express-validator');
const { authenticate, requireAdmin } = require('../middleware/auth');
const controller = require('../controllers/monthlyReport.controller');
const promptCtrl = require('../controllers/mprPromptTemplates.controller');

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

// ── Prompt Templates (Settings) ──────────────────────────────────────────────

router.get('/prompt-templates', promptCtrl.list);
router.get('/prompt-templates/:id', param('id').isInt(), promptCtrl.getOne);
router.post('/prompt-templates', requireAdmin, promptCtrl.create);
router.put('/prompt-templates/:id', requireAdmin, param('id').isInt(), promptCtrl.update);
router.delete('/prompt-templates/:id', requireAdmin, param('id').isInt(), promptCtrl.remove);

// ── CRUD routes ──────────────────────────────────────────────────────────────

// GET /api/monthly-reports — list reports
router.get('/', controller.list);

// POST /api/monthly-reports — create report
router.post('/', controller.create);

// GET /api/monthly-reports/:id/pdf — export as PDF
router.get('/:id/pdf', param('id').isInt(), controller.exportPdf);

// POST /api/monthly-reports/:id/generate — AI generate content
router.post('/:id/generate', param('id').isInt(), controller.generateAI);

// POST /api/monthly-reports/:id/pptx — export as PPTX
router.post('/:id/pptx', param('id').isInt(), controller.exportPptx);

// GET /api/monthly-reports/:id — get single report
router.get('/:id', param('id').isInt(), controller.getOne);

// PUT /api/monthly-reports/:id — update report
router.put('/:id', param('id').isInt(), controller.update);

// DELETE /api/monthly-reports/:id — delete report
router.delete('/:id', param('id').isInt(), controller.remove);

module.exports = router;
