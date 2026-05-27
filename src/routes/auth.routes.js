const express = require('express');
const router  = express.Router();
const { body } = require('express-validator');
const authController = require('../controllers/auth.controller');

// POST /api/auth/login
router.post(
  '/login',
  [
    body('login_id').notEmpty().withMessage('Login ID required'),
    body('password').notEmpty().withMessage('Password required'),
  ],
  authController.login
);

// POST /api/auth/register  (admin only in production — open here for setup)
router.post(
  '/register',
  [
    body('first_name').notEmpty().withMessage('First name required'),
    body('last_name').notEmpty().withMessage('Last name required'),
    body('email').isEmail().withMessage('Valid email required'),
    body('password').isLength({ min: 6 }).withMessage('Password min 6 chars'),
  ],
  authController.register
);

module.exports = router;
