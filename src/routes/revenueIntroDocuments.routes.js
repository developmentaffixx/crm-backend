const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticate, requireAdmin } = require('../middleware/auth');
const controller = require('../controllers/revenueIntroDocuments.controller');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
  fileFilter: (req, file, cb) => {
    // Allow PDFs and images
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF and image files are allowed'), false);
    }
  }
});

// All routes require authentication
router.use(authenticate);

// GET — list all documents (all authenticated users)
router.get('/', controller.list);

// POST — upload new document (admin only)
router.post('/', requireAdmin, upload.single('file'), controller.create);

// PUT — update document name / replace file (admin only)
router.put('/:id', requireAdmin, upload.single('file'), controller.update);

// DELETE — remove document (admin only)
router.delete('/:id', requireAdmin, controller.remove);

module.exports = router;
