const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/holidays.controller');

router.use(authenticate);

// Anyone can view holidays
router.get('/', ctrl.list);
router.get('/upcoming', ctrl.upcoming);
router.get('/check/:date', ctrl.checkDate);

// Admin only: manage holidays
router.post('/', requireAdmin, ctrl.create);
router.put('/:id', requireAdmin, ctrl.update);
router.delete('/:id', requireAdmin, ctrl.remove);
router.post('/declare-today', requireAdmin, ctrl.declareToday);
router.post('/generate-recurring', requireAdmin, ctrl.generateRecurring);

module.exports = router;
