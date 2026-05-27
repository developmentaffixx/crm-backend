const express = require('express');
const router  = express.Router();
const { param } = require('express-validator');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticate } = require('../middleware/auth');
const clientsController = require('../controllers/clients.controller');

// Multer config for client file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../uploads/clients', req.params.id);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB limit

// All client routes require authentication
router.use(authenticate);

// GET  /api/clients          — list clients (won leads)
router.get('/', clientsController.list);

// GET  /api/clients/:id      — get single client detail
router.get('/:id', param('id').isInt(), clientsController.getOne);

// GET  /api/clients/:id/activity — get recent activity timeline
router.get('/:id/activity', param('id').isInt(), clientsController.getActivity);

// POST /api/clients/:id/onboarding-a  — save onboarding A
router.post('/:id/onboarding-a', param('id').isInt(), clientsController.saveOnboardingA);

// POST /api/clients/:id/onboarding-b  — save onboarding B
router.post('/:id/onboarding-b', param('id').isInt(), clientsController.saveOnboardingB);

// POST /api/clients/:id/notes         — add a note
router.post('/:id/notes', param('id').isInt(), clientsController.addNote);

// DELETE /api/clients/:id/notes/:noteId — delete a note
router.delete('/:id/notes/:noteId', clientsController.deleteNote);

// POST /api/clients/:id/drs/:section   — save DRS section
router.post('/:id/drs/:section', param('id').isInt(), clientsController.saveDrs);

// GET /api/clients/:id/folders        — get all folders
router.get('/:id/folders', param('id').isInt(), clientsController.getFolders);

// POST /api/clients/:id/folders       — create a folder
router.post('/:id/folders', param('id').isInt(), clientsController.createFolder);

// DELETE /api/clients/:id/folders/:folderId — delete a folder
router.delete('/:id/folders/:folderId', clientsController.deleteFolder);

// GET /api/clients/:id/files/:fileId/download — download a file
router.get('/:id/files/:fileId/download', clientsController.downloadFile);

// POST /api/clients/:id/files         — upload files
router.post('/:id/files', param('id').isInt(), upload.array('files', 10), clientsController.uploadFile);

// DELETE /api/clients/:id/files/:fileId — delete a file
router.delete('/:id/files/:fileId', clientsController.deleteFile);

module.exports = router;
