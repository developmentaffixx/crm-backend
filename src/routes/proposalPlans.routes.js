const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/proposalPlans.controller');

router.use(authenticate);

// Services
router.get('/services', ctrl.listServices);
router.post('/services', ctrl.createService);
router.put('/services/:id', ctrl.updateService);
router.delete('/services/:id', ctrl.deleteService);

// Plans (columns)
router.post('/services/:serviceId/plans', ctrl.addPlan);
router.put('/plans/:planId', ctrl.updatePlan);
router.delete('/plans/:planId', ctrl.deletePlan);

// Features (rows)
router.post('/services/:serviceId/features', ctrl.addFeature);
router.put('/features/:featureId', ctrl.updateFeature);
router.delete('/features/:featureId', ctrl.deleteFeature);

// Values (matrix)
router.put('/services/:serviceId/values', ctrl.saveValues);

module.exports = router;
