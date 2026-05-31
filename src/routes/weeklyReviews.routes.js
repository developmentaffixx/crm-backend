const express = require('express');
const router = express.Router();
const { param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const weeklyReviewsController = require('../controllers/weeklyReviews.controller');

// All routes require authentication
router.use(authenticate);

// GET /api/weekly-reviews/leaderboard — must be before /:id
router.get('/leaderboard', weeklyReviewsController.leaderboard);

// GET /api/weekly-reviews — list reviews
router.get('/', weeklyReviewsController.list);

// POST /api/weekly-reviews/generate — auto-generate (admin only)
router.post('/generate', weeklyReviewsController.generate);

// GET /api/weekly-reviews/:id — get single review with details
router.get('/:id', param('id').isInt(), weeklyReviewsController.getOne);

// POST /api/weekly-reviews/:id/manager-review — submit manager review
router.post('/:id/manager-review', param('id').isInt(), weeklyReviewsController.submitManagerReview);

// POST /api/weekly-reviews/:id/self-review — submit self review
router.post('/:id/self-review', param('id').isInt(), weeklyReviewsController.submitSelfReview);

module.exports = router;
