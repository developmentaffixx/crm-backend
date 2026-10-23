const db = require('../config/db');
const { uploadToCloudinary, deleteFromCloudinary } = require('../config/cloudinary');

// ─────────────────────────────────────────────────────────────────────────────
// Cycle Feedback — point-wise, two independent lists per cycle.
//   side = 'client' → Client side list
//   side = 'team'   → Team side list
// Each point can carry text and/or a voice recording (audio).
// Open to everyone (common access) — no special permission required.
// Routes mounted under /api/projects/:projectId/cycles/:cycleId/feedback-points
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET — list all feedback points for a cycle, split into two lists.
 */
exports.list = async (req, res) => {
  try {
    const { cycleId } = req.params;
    const [rows] = await db.query(
      `SELECT fb.id, fb.side, fb.body, fb.audio_url, fb.status,
              fb.created_at, fb.updated_at,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM cycle_feedback fb
       LEFT JOIN users u ON u.id = fb.created_by
       WHERE fb.cycle_id = ?
       ORDER BY fb.created_at ASC, fb.id ASC`,
      [cycleId]
    );

    const client = rows.filter(r => r.side === 'client');
    const team = rows.filter(r => r.side === 'team');
    return res.json({ client, team });
  } catch (err) {
    console.error('List cycle feedback error:', err);
    return res.status(500).json({ message: 'Server error', detail: err.message });
  }
};

/**
 * POST — add a feedback point. Accepts multipart/form-data so an optional
 * voice recording (field "audio") can be uploaded alongside the text.
 * Body: side ('client'|'team'), body (text), [audio file]
 */
exports.create = async (req, res) => {
  try {
    const { projectId, cycleId } = req.params;
    const side = (req.body.side || '').trim();
    const body = req.body.body != null ? String(req.body.body).trim() : '';

    if (side !== 'client' && side !== 'team') {
      return res.status(400).json({ message: "side must be 'client' or 'team'" });
    }
    if (!body && !req.file) {
      return res.status(400).json({ message: 'Provide feedback text or a voice recording' });
    }

    let audioUrl = null;
    let audioPublicId = null;
    if (req.file) {
      // resource_type 'video' covers audio on Cloudinary
      const uploaded = await uploadToCloudinary(req.file.buffer, 'crm/cycle-feedback', 'video');
      audioUrl = uploaded.url;
      audioPublicId = uploaded.public_id;
    }

    const [result] = await db.query(
      `INSERT INTO cycle_feedback
         (cycle_id, project_id, side, body, audio_url, audio_public_id, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [cycleId, projectId, side, body || null, audioUrl, audioPublicId, req.user.id]
    );

    return res.status(201).json({ id: result.insertId, message: 'Feedback point added' });
  } catch (err) {
    console.error('Create cycle feedback error:', err);
    return res.status(500).json({ message: 'Server error', detail: err.message });
  }
};

/**
 * PUT — update a feedback point (text and/or status).
 * Body: body (text), status ('open'|'resolved')
 */
exports.update = async (req, res) => {
  try {
    const { cycleId, pointId } = req.params;
    const { body, status } = req.body;

    const [existing] = await db.query(
      'SELECT id FROM cycle_feedback WHERE id = ? AND cycle_id = ?',
      [pointId, cycleId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Feedback point not found' });
    }

    const fields = [];
    const values = [];
    if (body !== undefined) { fields.push('body = ?'); values.push(body ? String(body).trim() : null); }
    if (status !== undefined) {
      if (status !== 'open' && status !== 'resolved') {
        return res.status(400).json({ message: "status must be 'open' or 'resolved'" });
      }
      fields.push('status = ?'); values.push(status);
    }
    if (fields.length === 0) {
      return res.status(400).json({ message: 'Nothing to update' });
    }

    values.push(pointId, cycleId);
    await db.query(
      `UPDATE cycle_feedback SET ${fields.join(', ')} WHERE id = ? AND cycle_id = ?`,
      values
    );

    return res.json({ message: 'Feedback point updated' });
  } catch (err) {
    console.error('Update cycle feedback error:', err);
    return res.status(500).json({ message: 'Server error', detail: err.message });
  }
};

/**
 * DELETE — remove a feedback point (and its voice recording if any).
 */
exports.remove = async (req, res) => {
  try {
    const { cycleId, pointId } = req.params;

    const [rows] = await db.query(
      'SELECT audio_public_id FROM cycle_feedback WHERE id = ? AND cycle_id = ?',
      [pointId, cycleId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Feedback point not found' });
    }

    await db.query('DELETE FROM cycle_feedback WHERE id = ? AND cycle_id = ?', [pointId, cycleId]);

    if (rows[0].audio_public_id) {
      // fire-and-forget cleanup; audio stored as 'video' resource type
      deleteFromCloudinary(rows[0].audio_public_id, 'video');
    }

    return res.json({ message: 'Feedback point deleted' });
  } catch (err) {
    console.error('Delete cycle feedback error:', err);
    return res.status(500).json({ message: 'Server error', detail: err.message });
  }
};
