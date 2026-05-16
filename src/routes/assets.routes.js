const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const { param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const assetsController = require('../controllers/assets.controller');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const uploadFields = upload.fields([
  { name: 'invoice_photo', maxCount: 1 },
  { name: 'asset_photo', maxCount: 1 },
]);

// All asset routes require authentication
router.use(authenticate);

// ── Assets CRUD ───────────────────────────────────────────────────────────────

// GET  /api/assets — list all assets
router.get('/', assetsController.list);

// GET  /api/assets/:id — get single asset
router.get('/:id', param('id').isInt(), assetsController.getOne);

// GET  /api/assets/:id/history — get assignment history
router.get('/:id/history', param('id').isInt(), assetsController.getHistory);

// POST /api/assets — create asset (with optional file uploads)
router.post('/', uploadFields, assetsController.create);

// PUT  /api/assets/:id — update asset (with optional file uploads)
router.put('/:id', param('id').isInt(), uploadFields, assetsController.update);

// DELETE /api/assets/:id — soft delete
router.delete('/:id', param('id').isInt(), assetsController.remove);

module.exports = router;
