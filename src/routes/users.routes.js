const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const { authenticate } = require('../middleware/auth');
const usersController = require('../controllers/users.controller');

// Multer for avatar upload (max 2MB, images only)
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

// GET /api/users — list active team members
router.get('/', usersController.list);

// GET /api/users/me
router.get('/me', usersController.me);

// PUT /api/users/me — update profile
router.put('/me', usersController.updateMe);

// POST /api/users/me/avatar — upload avatar
router.post('/me/avatar', upload.single('avatar'), usersController.uploadAvatar);

// DELETE /api/users/me/avatar — remove avatar
router.delete('/me/avatar', usersController.removeAvatar);

// PUT /api/users/me/password — change password
router.put('/me/password', usersController.changePassword);

// GET /api/users/me/permissions — current user's role permissions
router.get('/me/permissions', usersController.myPermissions);

// GET /api/users/me/projects — user's projects
router.get('/me/projects', usersController.myProjects);

// GET /api/users/me/tasks — user's tasks
router.get('/me/tasks', usersController.myTasks);

// GET /api/users/me/leaves — user's leaves
router.get('/me/leaves', usersController.myLeaves);

// POST /api/users/me/leaves — apply for leave
router.post('/me/leaves', usersController.applyLeave);

// DELETE /api/users/me/leaves/:id — cancel leave
router.delete('/me/leaves/:id', usersController.cancelLeave);

// ─── Activity Timeline ────────────────────────────────────────────────────────
router.get('/me/activity', usersController.myActivity);

// ─── Sessions ─────────────────────────────────────────────────────────────────
router.get('/me/sessions', usersController.mySessions);
router.delete('/me/sessions/:id', usersController.revokeSession);

// ─── Emergency Contacts ───────────────────────────────────────────────────────
router.get('/me/emergency-contacts', usersController.getEmergencyContacts);
router.post('/me/emergency-contacts', usersController.addEmergencyContact);
router.put('/me/emergency-contacts/:id', usersController.updateEmergencyContact);
router.delete('/me/emergency-contacts/:id', usersController.deleteEmergencyContact);

// ─── Skills ───────────────────────────────────────────────────────────────────
router.get('/me/skills', usersController.getSkills);
router.post('/me/skills', usersController.addSkill);
router.delete('/me/skills/:id', usersController.deleteSkill);

// ─── Timesheet ────────────────────────────────────────────────────────────────
router.get('/me/timesheet', usersController.myTimesheet);
router.get('/me/timesheet/day', usersController.myTimesheetDay);

// ─── Tickets (for profile) ────────────────────────────────────────────────────
router.get('/me/tickets', usersController.myTickets);

// ─── Meetings (for profile) ──────────────────────────────────────────────────
router.get('/me/meetings', usersController.myMeetings);

// GET  /api/users/:id/employment — get employment/probation status (admin)
router.get('/:id/employment', usersController.getEmployment);

// PUT  /api/users/:id/employment — update employment/probation status (admin)
router.put('/:id/employment', usersController.updateEmployment);

// GET  /api/users/:id/leave-balance — get paid leave ledger (admin)
router.get('/:id/leave-balance', usersController.getLeaveBalance);

module.exports = router;
