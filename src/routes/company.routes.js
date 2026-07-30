const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const { authenticate, requireAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/company.controller');

// Multer — store in memory, max 2MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/x-icon', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only PNG, JPG, SVG, ICO, WEBP files are allowed'));
  },
});

// GET is fully public — no auth needed (logo/favicon shown on login page)
router.get('/', ctrl.getCompanySettings);

// All other routes require authentication + admin
router.put('/', authenticate, requireAdmin, ctrl.updateCompanySettings);

// Upload images
router.post('/upload-logo',        authenticate, requireAdmin, upload.single('logo'),        ctrl.uploadLogo);
router.post('/upload-favicon',     authenticate, requireAdmin, upload.single('favicon'),     ctrl.uploadFavicon);
router.post('/upload-upi-qr',      authenticate, requireAdmin, upload.single('upi_qr'),     ctrl.uploadUpiQr);
router.post('/upload-letterhead',  authenticate, requireAdmin, upload.single('letterhead'),  ctrl.uploadLetterhead);
router.post('/upload-quotation-letterhead', authenticate, requireAdmin, upload.single('letterhead'), ctrl.uploadQuotationLetterhead);

// Remove images
router.delete('/remove-logo',        authenticate, requireAdmin, ctrl.removeLogo);
router.delete('/remove-favicon',     authenticate, requireAdmin, ctrl.removeFavicon);
router.delete('/remove-upi-qr',      authenticate, requireAdmin, ctrl.removeUpiQr);
router.delete('/remove-letterhead',  authenticate, requireAdmin, ctrl.removeLetterhead);
router.delete('/remove-quotation-letterhead', authenticate, requireAdmin, ctrl.removeQuotationLetterhead);

module.exports = router;
