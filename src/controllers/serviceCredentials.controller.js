const db = require('../config/db');
const { encrypt, decrypt } = require('../config/crypto');

// ─────────────────────────────────────────────────────────────────────────────
// Service Credentials Vault
// Platform-based credentials scoped to a single project service.
// Passwords are encrypted at rest (AES-256-GCM) and only decrypted on read.
// Routes mounted under /api/projects/:projectId/services/:serviceId/credentials
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET — list credentials for a service (passwords decrypted for display)
 */
exports.list = async (req, res) => {
  try {
    const { serviceId } = req.params;
    const [rows] = await db.query(
      `SELECT sc.id, sc.platform, sc.login_id, sc.password_enc, sc.url, sc.notes,
              sc.created_at, sc.updated_at,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM service_credentials sc
       LEFT JOIN users u ON u.id = sc.created_by
       WHERE sc.project_service_id = ?
       ORDER BY sc.platform ASC, sc.id ASC`,
      [serviceId]
    );

    const data = rows.map(r => ({
      id: r.id,
      platform: r.platform,
      login_id: r.login_id,
      password: decrypt(r.password_enc),
      url: r.url,
      notes: r.notes,
      created_by_name: r.created_by_name,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));

    return res.json(data);
  } catch (err) {
    console.error('List service credentials error:', err);
    return res.status(500).json({ message: 'Server error', detail: err.message });
  }
};

/**
 * POST — add a credential entry
 */
exports.create = async (req, res) => {
  try {
    const { projectId, serviceId } = req.params;
    const { platform, login_id, password, url, notes } = req.body;

    if (!platform || !platform.trim()) {
      return res.status(400).json({ message: 'Platform name is required' });
    }

    const [result] = await db.query(
      `INSERT INTO service_credentials
         (project_id, project_service_id, platform, login_id, password_enc, url, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        projectId,
        serviceId,
        platform.trim(),
        login_id || null,
        encrypt(password),
        url || null,
        notes || null,
        req.user.id,
      ]
    );

    return res.status(201).json({ id: result.insertId, message: 'Credential added' });
  } catch (err) {
    console.error('Create service credential error:', err);
    return res.status(500).json({ message: 'Server error', detail: err.message });
  }
};

/**
 * PUT — update a credential entry. Password is only re-encrypted when provided
 * (undefined/absent leaves it unchanged; empty string clears it).
 */
exports.update = async (req, res) => {
  try {
    const { serviceId, credId } = req.params;
    const { platform, login_id, password, url, notes } = req.body;

    const [existing] = await db.query(
      'SELECT id FROM service_credentials WHERE id = ? AND project_service_id = ?',
      [credId, serviceId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ message: 'Credential not found' });
    }

    const fields = [];
    const values = [];
    if (platform !== undefined) { fields.push('platform = ?'); values.push(platform.trim()); }
    if (login_id !== undefined) { fields.push('login_id = ?'); values.push(login_id || null); }
    if (url !== undefined)      { fields.push('url = ?');      values.push(url || null); }
    if (notes !== undefined)    { fields.push('notes = ?');    values.push(notes || null); }
    if (password !== undefined) { fields.push('password_enc = ?'); values.push(encrypt(password)); }

    if (fields.length === 0) {
      return res.status(400).json({ message: 'Nothing to update' });
    }

    values.push(credId, serviceId);
    await db.query(
      `UPDATE service_credentials SET ${fields.join(', ')} WHERE id = ? AND project_service_id = ?`,
      values
    );

    return res.json({ message: 'Credential updated' });
  } catch (err) {
    console.error('Update service credential error:', err);
    return res.status(500).json({ message: 'Server error', detail: err.message });
  }
};

/**
 * DELETE — remove a credential entry
 */
exports.remove = async (req, res) => {
  try {
    const { serviceId, credId } = req.params;
    await db.query(
      'DELETE FROM service_credentials WHERE id = ? AND project_service_id = ?',
      [credId, serviceId]
    );
    return res.json({ message: 'Credential deleted' });
  } catch (err) {
    console.error('Delete service credential error:', err);
    return res.status(500).json({ message: 'Server error', detail: err.message });
  }
};
