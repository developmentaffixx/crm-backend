const express = require('express');
const router = express.Router();
const { param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const controller = require('../controllers/monthlyReport.controller');

router.use(authenticate);

router.get('/', controller.list);
router.get('/:id', param('id').isInt(), controller.getOne);
router.post('/', controller.create);
router.put('/:id', param('id').isInt(), controller.update);
router.delete('/:id', param('id').isInt(), controller.remove);

module.exports = router;
