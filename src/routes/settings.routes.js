const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const { body, param } = require('express-validator');
const { authenticate, requireAdmin, requireAdminOrSubmenu } = require('../middleware/auth');
const ctrl = require('../controllers/settings.controller');
const docCtrl = require('../controllers/documentTemplates.controller');
const docGenCtrl = require('../controllers/documentGenerate.controller');

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

router.use(authenticate);

// Read-only endpoints used by the People Ops > On-boarding page (Document Templates tab).
// Allowed for admins and users with on-boarding access; everything else below is admin only.
const requireAdminOrOnboarding = requireAdminOrSubmenu('people_ops', 'on_boarding_doc_templates');
router.get('/users',                        requireAdminOrOnboarding, ctrl.getUsers);
router.get('/document-templates',           requireAdminOrOnboarding, docCtrl.list);
router.get('/document-templates/:key',      requireAdminOrOnboarding, docCtrl.getByKey);
router.post('/document-templates/generate', requireAdminOrOnboarding, docGenCtrl.generate);

// All remaining settings routes require admin
router.use(requireAdmin);

// ─── Roles ────────────────────────────────────────────────────────────────────
router.get('/roles',     ctrl.getRoles);
router.post('/roles',    [body('name').notEmpty().withMessage('Role name is required')], ctrl.createRole);
router.put('/roles/:id', [param('id').isInt({ min: 1 })], ctrl.updateRole);
router.delete('/roles/:id', [param('id').isInt({ min: 1 })], ctrl.deleteRole);

// ─── Permissions ──────────────────────────────────────────────────────────────
router.get('/roles/:id/permissions', [param('id').isInt({ min: 1 })], ctrl.getRolePermissions);
router.put('/roles/:id/permissions', [param('id').isInt({ min: 1 })], ctrl.updateRolePermissions);

// ─── Social Media Ops Submenu Permissions (legacy) ────────────────────────────
router.get('/roles/:id/social-permissions', [param('id').isInt({ min: 1 })], ctrl.getRoleSocialPermissions);
router.put('/roles/:id/social-permissions', [param('id').isInt({ min: 1 })], ctrl.updateRoleSocialPermissions);

// ─── Generic Submenu Permissions (all modules) ────────────────────────────────
router.get('/roles/:id/submenu-permissions', [param('id').isInt({ min: 1 })], ctrl.getRoleSubmenuPermissions);
router.put('/roles/:id/submenu-permissions', [param('id').isInt({ min: 1 })], ctrl.updateRoleSubmenuPermissions);

// ─── Role Members ─────────────────────────────────────────────────────────────
router.get('/roles/:id/members', [param('id').isInt({ min: 1 })], ctrl.getRoleMembers);

// ─── Per-User Permission Overrides ───────────────────────────────────────────
router.get('/users/:id/permission-overrides',    [param('id').isInt({ min: 1 })], ctrl.getUserPermissionOverrides);
router.put('/users/:id/permission-overrides',    [param('id').isInt({ min: 1 })], ctrl.updateUserPermissionOverrides);
router.delete('/users/:id/permission-overrides', [param('id').isInt({ min: 1 })], ctrl.clearUserPermissionOverrides);

// ─── Users ────────────────────────────────────────────────────────────────────
router.get('/users/next-emp-code', ctrl.getNextEmpCode);
router.get('/users/:id',          [param('id').isInt({ min: 1 })], ctrl.getUserDetail);
router.post('/users', [
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('first_name').notEmpty().withMessage('First name is required'),
  body('last_name').notEmpty().withMessage('Last name is required'),
], ctrl.createUser);
router.put('/users/:id',                  [param('id').isInt({ min: 1 })], ctrl.updateUser);
router.get('/users/:id/open-tasks-summary', [param('id').isInt({ min: 1 })], ctrl.getUserOpenTasksSummary);
router.put('/users/:id/deactivate',       [param('id').isInt({ min: 1 })], ctrl.deactivateUser);
router.put('/users/:id/reset-password',   [
  param('id').isInt({ min: 1 }),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
], ctrl.resetPassword);
router.get('/users/:id/role-history',     [param('id').isInt({ min: 1 })], ctrl.getUserRoleHistory);
router.post('/users/:id/upload-avatar',   [param('id').isInt({ min: 1 })], upload.single('avatar'), ctrl.uploadAvatar);
router.post('/users/:id/impersonate',    [param('id').isInt({ min: 1 })], ctrl.impersonateUser);

// ─── Task Settings ────────────────────────────────────────────────────────────
router.get('/task-settings', ctrl.getTaskSettings);
router.put('/task-settings', ctrl.updateTaskSettings);

// ─── Daily Targets Settings ───────────────────────────────────────────────────
router.get('/daily-targets', ctrl.getDailyTargets);
router.put('/daily-targets', ctrl.updateDailyTargets);

// ─── Audit Log ────────────────────────────────────────────────────────────────
router.get('/audit-logs', ctrl.getAuditLogs);

// ─── Document Templates ───────────────────────────────────────────────────────
router.put('/document-templates/:key',      docCtrl.update);

module.exports = router;
