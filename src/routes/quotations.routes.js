const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/quotations.controller');
const pdfCtrl = require('../controllers/quotationPdf.controller');

router.use(authenticate);

router.get('/', ctrl.list);
router.get('/:id', ctrl.getOne);
router.get('/:id/pdf', pdfCtrl.generatePdf);
router.post('/', ctrl.create);
router.put('/:id', ctrl.update);
router.patch('/:id/status', ctrl.updateStatus);
router.delete('/:id', ctrl.remove);
router.post('/:id/send-email', upload.single('pdf'), ctrl.sendEmail);

module.exports = router;
