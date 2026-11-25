const express = require('express');
const { param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { requireSocialAccess } = require('../middleware/socialAccess');
const ctrl = require('../controllers/smmReports.controller');
const { ensureSmmReportSchemaOnce } = require('../helpers/smmReportSchema');

const router = express.Router();
const id = param('id').isInt();

router.use(authenticate);
router.use(async (_req, res, next) => {
  try { await ensureSmmReportSchemaOnce(); next(); } catch (err) {
    console.error('SMM report schema error:', err);
    res.status(500).json({ message: `Report tables could not be created: ${err.code || ''} ${err.message}` });
  }
});
router.use(requireSocialAccess('report_centre'));

router.get('/', ctrl.list);
router.get('/prefill', ctrl.prefill);
router.post('/', ctrl.create);

router.get('/:id', id, ctrl.getOne);
router.put('/:id', id, ctrl.updateInputs);
router.put('/:id/narrative', id, ctrl.updateNarrative);
router.post('/:id/regenerate', id, ctrl.regenerate);
router.post('/:id/polish', id, ctrl.polish);
router.post('/:id/submit', id, ctrl.submit);
router.post('/:id/request-changes', id, ctrl.requestChanges);
router.post('/:id/approve', id, ctrl.approve);
router.post('/:id/reopen', id, ctrl.reopen);
router.get('/:id/pptx', id, ctrl.exportPptx);
router.delete('/:id', id, ctrl.remove);

module.exports = router;
