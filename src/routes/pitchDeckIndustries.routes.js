const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const { param } = require('express-validator');
const { authenticate, requireAdmin } = require('../middleware/auth');
const controller = require('../controllers/pitchDeckIndustries.controller');

// Multer for image uploads (max 5MB, images only)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only PNG, JPG, WEBP files are allowed'));
  },
});

// All routes require authentication
router.use(authenticate);

// GET  /api/pitch-deck-industries — list all active industries
router.get('/', controller.list);

// GET  /api/pitch-deck-industries/:id — get single industry
router.get('/:id', param('id').isInt(), controller.getOne);

// POST /api/pitch-deck-industries — create industry
router.post('/', requireAdmin, controller.create);

// PUT  /api/pitch-deck-industries/:id — update industry
router.put('/:id', requireAdmin, param('id').isInt(), controller.update);

// POST /api/pitch-deck-industries/:id/upload/:slot — upload image for a slide slot
router.post('/:id/upload/:slot', requireAdmin, upload.single('image'), controller.uploadImage);

// DELETE /api/pitch-deck-industries/:id — soft delete (deactivate)
router.delete('/:id', requireAdmin, param('id').isInt(), controller.remove);

module.exports = router;
