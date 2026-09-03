const db = require('../config/db');
const multer = require('multer');
const { uploadToCloudinary, deleteFromCloudinary } = require('../config/cloudinary');
const { emitEvent } = require('../config/socket');

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
// HELPER: Notify all task participants about a new comment
// ─────────────────────────────────────────────────────────────────────────────
async function notifyTaskComment(taskId, commenterId, commenterName, commentType) {
  try {
    // Get all users associated with this task (assignee, creator, collaborators)
    const [taskRows] = await db.query(
      'SELECT assigned_to, created_by FROM tasks WHERE id = ?',
      [taskId]
    );
    if (taskRows.length === 0) return;

    const task = taskRows[0];

    // Get collaborators
    const [collabs] = await db.query(
      'SELECT user_id FROM task_assignees WHERE task_id = ? AND role = ?',
      [taskId, 'collaborator']
    );

    // Get all admin users
    const [admins] = await db.query(
      'SELECT id FROM users WHERE is_admin = 1 AND is_active = 1 AND deleted = 0'
    );

    // Build unique set of users to notify (exclude the commenter)
    const recipientIds = new Set();
    if (task.assigned_to) recipientIds.add(task.assigned_to);
    if (task.created_by) recipientIds.add(task.created_by);
    collabs.forEach(c => recipientIds.add(c.user_id));
    admins.forEach(a => recipientIds.add(a.id));
    recipientIds.delete(commenterId); // Don't notify the person who commented

    const message = commentType === 'audio'
      ? `${commenterName} left a voice note on a task`
      : `${commenterName} commented on a task`;

    // Insert notification for each recipient
    for (const userId of recipientIds) {
      await db.query(
        `INSERT INTO task_comment_notifications (user_id, task_id, triggered_by, comment_type, message, is_read)
         VALUES (?, ?, ?, ?, ?, 0)`,
        [userId, taskId, commenterId, commentType, message]
      );

      // Real-time socket push
      emitEvent('task:new-comment', {
        task_id: taskId,
        commenter: commenterName,
        comment_type: commentType,
        message,
      }, `user:${userId}`);
    }
  } catch (err) {
    console.error('Notify task comment error:', err);
  }
}

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

    // Notify participants
    const commenterName = rows[0].user_name;
    notifyTaskComment(taskId, userId, commenterName, 'text');

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

    // Notify participants
    const commenterName = rows[0].user_name;
    notifyTaskComment(taskId, userId, commenterName, 'audio');

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

    // Clean up related notifications
    await db.query(
      'DELETE FROM task_comment_notifications WHERE task_id = ?',
      [taskId]
    );

    res.json({ message: 'Comment deleted' });
  } catch (err) {
    console.error('Delete comment error:', err);
    res.status(500).json({ message: 'Failed to delete comment' });
  }
};
