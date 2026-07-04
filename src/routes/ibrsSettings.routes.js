const express = require('express');
const router = express.Router();
const multer = require('multer');
const { param } = require('express-validator');
const { authenticate, requireAdmin } = require('../middleware/auth');
const controller = require('../controllers/ibrsSettings.controller');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF and image files are allowed'), false);
    }
  }
});

router.use(authenticate);

// GET /api/ibrs-settings — list all IBRS templates (optionally ?industry_id=X)
router.get('/', controller.list);

// GET /api/ibrs-settings/project/:projectId — get IBRS for a specific project
router.get('/project/:projectId', param('projectId').isInt(), controller.getByProject);

// GET /api/ibrs-settings/:id — get single template
router.get('/:id', param('id').isInt(), controller.getOne);

// POST /api/ibrs-settings — create (admin only, with file upload)
router.post('/', requireAdmin, upload.single('file'), controller.create);

// PUT /api/ibrs-settings/:id — update (admin only, with optional file upload)
router.put('/:id', requireAdmin, param('id').isInt(), upload.single('file'), controller.update);

// DELETE /api/ibrs-settings/:id — soft delete (admin only)
router.delete('/:id', requireAdmin, param('id').isInt(), controller.remove);

module.exports = router;
