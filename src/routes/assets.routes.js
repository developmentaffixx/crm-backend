const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const { param } = require('express-validator');
const { authenticate, requireAdmin } = require('../middleware/auth');
const assetsController = require('../controllers/assets.controller');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const uploadFields = upload.fields([
  { name: 'invoice_photo', maxCount: 1 },
  { name: 'asset_photo', maxCount: 1 },
]);

// All asset routes require authentication
router.use(authenticate);

// ── Categories ────────────────────────────────────────────────────────────────

// GET  /api/assets/categories — list active categories
router.get('/categories', assetsController.getCategories);

// POST /api/assets/categories — create new category (admin only)
router.post('/categories', requireAdmin, assetsController.createCategory);

// DELETE /api/assets/categories/:id — soft delete category (admin only)
router.delete('/categories/:id', [requireAdmin, param('id').isInt()], assetsController.deleteCategory);

// ── Assets CRUD ───────────────────────────────────────────────────────────────

// GET  /api/assets — list all assets
router.get('/', assetsController.list);

// GET  /api/assets/:id — get single asset with components
router.get('/:id', param('id').isInt(), assetsController.getOne);

// GET  /api/assets/:id/history — get assignment history
router.get('/:id/history', param('id').isInt(), assetsController.getHistory);

// GET  /api/assets/:id/components — get components
router.get('/:id/components', param('id').isInt(), assetsController.getComponents);

// POST /api/assets — create asset (with optional file uploads)
router.post('/', uploadFields, assetsController.create);

// PUT  /api/assets/:id — update asset (with optional file uploads)
router.put('/:id', [param('id').isInt(), uploadFields], assetsController.update);

// POST /api/assets/:id/assign — assign asset to employee
router.post('/:id/assign', param('id').isInt(), assetsController.assign);

// POST /api/assets/:id/return — return asset from employee
router.post('/:id/return', param('id').isInt(), assetsController.returnAsset);

// POST /api/assets/:id/components — add component
router.post('/:id/components', param('id').isInt(), assetsController.addComponent);

// DELETE /api/assets/:id/components/:componentId — remove component
router.delete('/:id/components/:componentId', assetsController.removeComponent);

// DELETE /api/assets/:id — soft delete
router.delete('/:id', [requireAdmin, param('id').isInt()], assetsController.remove);

module.exports = router;
