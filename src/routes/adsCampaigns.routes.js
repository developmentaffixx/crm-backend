const express = require('express');
const router = express.Router();
const { param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { requireSocialAccess } = require('../middleware/socialAccess');
const adsController = require('../controllers/adsCampaigns.controller');

router.use(authenticate);
router.use(requireSocialAccess('ads_planning'));

router.get('/', adsController.list);
router.get('/:id', param('id').isInt(), adsController.getOne);
router.post('/', adsController.create);
router.put('/:id', param('id').isInt(), adsController.update);
router.delete('/:id', param('id').isInt(), adsController.remove);
router.post('/:id/report', param('id').isInt(), adsController.saveReport);

module.exports = router;
