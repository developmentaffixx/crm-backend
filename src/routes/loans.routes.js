const express = require('express');
const router = express.Router();
const { param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const loansController = require('../controllers/loans.controller');

router.use(authenticate);

router.get('/', loansController.list);
router.get('/:id', param('id').isInt(), loansController.getOne);
router.post('/', loansController.create);
router.put('/:id', param('id').isInt(), loansController.update);
router.delete('/:id', param('id').isInt(), loansController.remove);

module.exports = router;
