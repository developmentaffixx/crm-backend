const db = require('../config/db');
const multer = require('multer');
const { uploadToCloudinary, deleteFromCloudinary } = require('../config/cloudinary');

// ─── Multer config for audio uploads (max 10MB, audio only) ──────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const allowed = /^audio\//;
    if (allowed.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed'), false);
    }
  },
});

exports.uploadMiddleware = upload.single('audio');

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/tasks/:id/comments — list comments for a task
// ─────────────────────────────────────────────────────────────────────────────
exports.getComments = async (req, res) => {
  try {
    const taskId = req.params.id;

    const [comments] = await db.query(
      `SELECT tc.id, tc.task_id, tc.user_id, tc.comment_type, tc.content,
              tc.audio_url, tc.duration, tc.created_at,
              CONCAT(u.first_name, ' ', u.last_name) AS user_name,
              u.avatar_url AS user_avatar
       FROM task_comments tc
       JOIN users u ON u.id = tc.user_id
       WHERE tc.task_id = ?
       ORDER BY tc.created_at ASC`,
      [taskId]
    );

    res.json({ comments });
  } catch (err) {
    console.error('Get task comments error:', err);
    res.status(500).json({ message: 'Failed to load comments' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/tasks/:id/comments — add a text comment
// ─────────────────────────────────────────────────────────────────────────────
exports.addTextComment = async (req, res) => {
  try {
    const taskId = req.params.id;
    const userId = req.user.id;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ message: 'Comment content is required' });
    }

    const [result] = await db.query(
      `INSERT INTO task_comments (task_id, user_id, comment_type, content)
       VALUES (?, ?, 'text', ?)`,
      [taskId, userId, content.trim()]
    );

    // Fetch the inserted comment with user info
    const [rows] = await db.query(
      `SELECT tc.id, tc.task_id, tc.user_id, tc.comment_type, tc.content,
              tc.audio_url, tc.duration, tc.created_at,
              CONCAT(u.first_name, ' ', u.last_name) AS user_name,
              u.avatar_url AS user_avatar
       FROM task_comments tc
       JOIN users u ON u.id = tc.user_id
       WHERE tc.id = ?`,
      [result.insertId]
    );

    res.status(201).json({ comment: rows[0] });
  } catch (err) {
    console.error('Add text comment error:', err);
    res.status(500).json({ message: 'Failed to add comment' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/tasks/:id/comments/audio — add an audio comment
// ─────────────────────────────────────────────────────────────────────────────
exports.addAudioComment = async (req, res) => {
  try {
    const taskId = req.params.id;
    const userId = req.user.id;
    const duration = req.body.duration ? parseInt(req.body.duration) : null;

    if (!req.file) {
      return res.status(400).json({ message: 'Audio file is required' });
    }

    // Upload to Cloudinary (video resource_type handles audio files)
    const { url, public_id } = await uploadToCloudinary(
      req.file.buffer,
      'crm/task-comments/audio',
      'video' // Cloudinary uses 'video' resource_type for audio
    );

    const [result] = await db.query(
      `INSERT INTO task_comments (task_id, user_id, comment_type, audio_url, audio_public_id, duration)
       VALUES (?, ?, 'audio', ?, ?, ?)`,
      [taskId, userId, url, public_id, duration]
    );

    // Fetch the inserted comment with user info
    const [rows] = await db.query(
      `SELECT tc.id, tc.task_id, tc.user_id, tc.comment_type, tc.content,
              tc.audio_url, tc.duration, tc.created_at,
              CONCAT(u.first_name, ' ', u.last_name) AS user_name,
              u.avatar_url AS user_avatar
       FROM task_comments tc
       JOIN users u ON u.id = tc.user_id
       WHERE tc.id = ?`,
      [result.insertId]
    );

    res.status(201).json({ comment: rows[0] });
  } catch (err) {
    console.error('Add audio comment error:', err);
    res.status(500).json({ message: 'Failed to add audio comment' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/tasks/:id/comments/:commentId — delete own comment (or admin)
// ─────────────────────────────────────────────────────────────────────────────
exports.deleteComment = async (req, res) => {
  try {
    const { id: taskId, commentId } = req.params;
    const userId = req.user.id;

    const [rows] = await db.query(
      'SELECT * FROM task_comments WHERE id = ? AND task_id = ?',
      [commentId, taskId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    const comment = rows[0];

    // Only comment owner or admin can delete
    if (comment.user_id !== userId && !req.user.is_admin) {
      return res.status(403).json({ message: 'Not authorized to delete this comment' });
    }

    // If audio, delete from Cloudinary
    if (comment.audio_public_id) {
      await deleteFromCloudinary(comment.audio_public_id, 'video');
    }

    await db.query('DELETE FROM task_comments WHERE id = ?', [commentId]);

    res.json({ message: 'Comment deleted' });
  } catch (err) {
    console.error('Delete comment error:', err);
    res.status(500).json({ message: 'Failed to delete comment' });
  }
};
