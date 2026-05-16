const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const { body, param } = require('express-validator');
const { authenticate, requireAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/settings.controller');

// Multer for avatar upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only PNG, JPG, WEBP files are allowed'));
  },
});

// All settings routes require authentication + admin
router.use(authenticate);
router.use(requireAdmin);

// ─── Roles ────────────────────────────────────────────────────────────────────
router.get('/roles',     ctrl.getRoles);
router.post('/roles',    [body('name').notEmpty().withMessage('Role name is required')], ctrl.createRole);
router.put('/roles/:id', [param('id').isInt({ min: 1 })], ctrl.updateRole);
router.delete('/roles/:id', [param('id').isInt({ min: 1 })], ctrl.deleteRole);

// ─── Permissions ──────────────────────────────────────────────────────────────
router.get('/roles/:id/permissions', [param('id').isInt({ min: 1 })], ctrl.getRolePermissions);
router.put('/roles/:id/permissions', [param('id').isInt({ min: 1 })], ctrl.updateRolePermissions);

// ─── Users ────────────────────────────────────────────────────────────────────
router.get('/users', ctrl.getUsers);
router.get('/users/:id', [param('id').isInt({ min: 1 })], ctrl.getUserDetail);
router.post('/users', [
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('first_name').notEmpty().withMessage('First name is required'),
  body('last_name').notEmpty().withMessage('Last name is required'),
], ctrl.createUser);
router.put('/users/:id',                  [param('id').isInt({ min: 1 })], ctrl.updateUser);
router.put('/users/:id/deactivate',       [param('id').isInt({ min: 1 })], ctrl.deactivateUser);
router.put('/users/:id/reset-password',   [
  param('id').isInt({ min: 1 }),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
], ctrl.resetPassword);
router.get('/users/:id/role-history',     [param('id').isInt({ min: 1 })], ctrl.getUserRoleHistory);
router.post('/users/:id/upload-avatar',   [param('id').isInt({ min: 1 })], upload.single('avatar'), ctrl.uploadAvatar);

// ─── Task Settings ────────────────────────────────────────────────────────────
router.get('/task-settings', ctrl.getTaskSettings);
router.put('/task-settings', ctrl.updateTaskSettings);

// ─── Audit Log ────────────────────────────────────────────────────────────────
router.get('/audit-logs', ctrl.getAuditLogs);

module.exports = router;
