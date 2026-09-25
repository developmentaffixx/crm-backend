const express = require('express');
const router = express.Router();
const { param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const otherCreditsController = require('../controllers/otherCredits.controller');

router.use(authenticate);

router.get('/', otherCreditsController.list);
router.get('/:id', param('id').isInt(), otherCreditsController.getOne);
router.post('/', otherCreditsController.create);
router.put('/:id', param('id').isInt(), otherCreditsController.update);
router.delete('/:id', param('id').isInt(), otherCreditsController.remove);

module.exports = router;
