const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/proposalEngine.controller');

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC routes (no authentication — client-facing)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/public/:token', ctrl.getPublic);
router.patch('/public/:token/respond', ctrl.respond);

// ─────────────────────────────────────────────────────────────────────────────
// AUTHENTICATED routes (CRM side)
// ─────────────────────────────────────────────────────────────────────────────
router.use(authenticate);

// Wizard data endpoints
router.get('/templates', ctrl.getTemplates);
router.get('/industries', ctrl.getIndustries);
router.get('/personas', ctrl.getPersonas);
router.get('/case-studies', ctrl.getCaseStudies);

// Case study CRUD
router.post('/case-studies', ctrl.createCaseStudy);
router.put('/case-studies/:id', ctrl.updateCaseStudy);
router.delete('/case-studies/:id', ctrl.deleteCaseStudy);

// Proposal CRUD
router.get('/proposals', ctrl.list);
router.post('/proposals', ctrl.create);
router.get('/proposals/:id', ctrl.getOne);
router.put('/proposals/:id', ctrl.update);
router.delete('/proposals/:id', ctrl.remove);
router.patch('/proposals/:id/mark-sent', ctrl.markSent);
router.patch('/proposals/:id/regenerate', ctrl.regenerate);
router.put('/proposals/:id/content', ctrl.updateContent);
router.post('/proposals/:id/duplicate', ctrl.duplicate);

module.exports = router;
