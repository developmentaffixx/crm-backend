const { validationResult } = require('express-validator');
const db  = require('../config/db');
const crypto = require('crypto');

// ─── Helper: generate a secure unique token ───────────────────────────────────
function generateToken() {
  return crypto.randomBytes(24).toString('hex'); // 48-char hex string
}

// ─── Helper: compute expires_at from validity_days ───────────────────────────
function computeExpiry(validityDays) {
  if (!validityDays || validityDays <= 0) return null;
  const d = new Date();
  d.setDate(d.getDate() + parseInt(validityDays));
  return d;
}

// ─────────────────────────────────────────────────────────────────────────────
// CRM-SIDE (authenticated) endpoints
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/proposals
 * List all proposals (paginated, filterable)
 */
exports.list = async (req, res) => {
  try {
    const {
      status, search,
      page = 1, limit = 20,
      sortBy = 'created_at', sortOrder = 'desc'
    } = req.query;

    let where = 'p.deleted = 0';
    const params = [];

    // Non-admin: only see proposals they created
    if (!req.user.is_admin) {
      where += ' AND p.created_by = ?';
      params.push(req.user.id);
    }

    if (status) {
      where += ' AND p.status = ?';
      params.push(status);
    }

    if (search) {
      where += ' AND (p.title LIKE ? OR p.client_name LIKE ? OR p.client_company LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    const allowedSort   = ['created_at', 'title', 'client_name', 'status', 'view_count', 'expires_at'];
    const safeSortBy    = allowedSort.includes(sortBy) ? sortBy : 'created_at';
    const safeSortOrder = sortOrder.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

    // Total count
    const [countRows] = await db.query(
      `SELECT COUNT(*) AS total FROM proposals p WHERE ${where}`,
      params
    );
    const total = countRows[0].total;

    // Summary counts
    const [summaryRows] = await db.query(
      `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN p.status = 'draft'    THEN 1 ELSE 0 END) AS draft,
        SUM(CASE WHEN p.status = 'sent'     THEN 1 ELSE 0 END) AS sent,
        SUM(CASE WHEN p.status = 'viewed'   THEN 1 ELSE 0 END) AS viewed,
        SUM(CASE WHEN p.status = 'accepted' THEN 1 ELSE 0 END) AS accepted,
        SUM(CASE WHEN p.status = 'rejected' THEN 1 ELSE 0 END) AS rejected
       FROM proposals p WHERE ${where}`,
      params
    );

    const pageNum  = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset   = (pageNum - 1) * limitNum;

    const [rows] = await db.query(
      `SELECT
         p.*,
         CONCAT(u.first_name, ' ', u.last_name) AS created_by_name,
         l.name AS lead_name, l.business_name AS lead_business_name
       FROM proposals p
       LEFT JOIN users u ON u.id = p.created_by
       LEFT JOIN leads  l ON l.id = p.lead_id
       WHERE ${where}
       ORDER BY p.${safeSortBy} ${safeSortOrder}
       LIMIT ? OFFSET ?`,
      [...params, limitNum, offset]
    );

    return res.json({
      proposals: rows,
      summary:   summaryRows[0],
      pagination: {
        page:       pageNum,
        limit:      limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    console.error('Proposals list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/proposals
 * Create a new proposal
 */
exports.create = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const {
    lead_id, title, tagline, client_name, client_company,
    logo_url, cover_image_url, brand_color,
    sections, validity_days,
    prepared_by_name, prepared_by_email, prepared_by_phone, prepared_by_website
  } = req.body;

  try {
    const token     = generateToken();
    const expiresAt = computeExpiry(validity_days || 7);

    const [result] = await db.query(
      `INSERT INTO proposals
         (proposal_token, lead_id, title, tagline, client_name, client_company,
          logo_url, cover_image_url, brand_color, sections, validity_days, expires_at,
          prepared_by_name, prepared_by_email, prepared_by_phone, prepared_by_website,
          status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
      [
        token,
        lead_id || null,
        title,
        tagline || null,
        client_name,
        client_company || null,
        logo_url || null,
        cover_image_url || null,
        brand_color || '#000000',
        sections ? JSON.stringify(sections) : null,
        validity_days || 7,
        expiresAt,
        prepared_by_name  || null,
        prepared_by_email || null,
        prepared_by_phone || null,
        prepared_by_website || null,
        req.user.id,
      ]
    );

    const [rows] = await db.query('SELECT * FROM proposals WHERE id = ?', [result.insertId]);
    res.emitSocket('proposals:created', rows[0]);
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Proposals create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/proposals/:id
 * Get single proposal (CRM side — authenticated)
 */
exports.getOne = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT p.*,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name,
              l.name AS lead_name, l.business_name AS lead_business_name
       FROM proposals p
       LEFT JOIN users u ON u.id = p.created_by
       LEFT JOIN leads  l ON l.id = p.lead_id
       WHERE p.id = ? AND p.deleted = 0`,
      [req.params.id]
    );

    if (rows.length === 0) return res.status(404).json({ message: 'Proposal not found' });

    const proposal = rows[0];

    // Non-admin can only view their own
    if (!req.user.is_admin && proposal.created_by !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Parse sections JSON if stored as string
    if (proposal.sections && typeof proposal.sections === 'string') {
      try { proposal.sections = JSON.parse(proposal.sections); } catch (_) {}
    }

    return res.json(proposal);
  } catch (err) {
    console.error('Proposals getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/proposals/:id
 * Update a proposal (CRM side)
 */
exports.update = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM proposals WHERE id = ? AND deleted = 0',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Proposal not found' });

    const proposal = rows[0];

    if (!req.user.is_admin && proposal.created_by !== req.user.id) {
      return res.status(403).json({ message: 'Only the creator or admin can edit this proposal' });
    }

    const allowed = [
      'lead_id', 'title', 'tagline', 'client_name', 'client_company',
      'logo_url', 'cover_image_url', 'brand_color', 'validity_days', 'status',
      'prepared_by_name', 'prepared_by_email', 'prepared_by_phone', 'prepared_by_website'
    ];

    const updates = {};
    allowed.forEach(f => {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    });

    // Handle sections separately (needs JSON serialization)
    if (req.body.sections !== undefined) {
      updates.sections = JSON.stringify(req.body.sections);
    }

    // Recompute expiry if validity_days changed
    if (updates.validity_days) {
      updates.expires_at = computeExpiry(updates.validity_days);
    }

    // When moving to 'sent', update expires_at from now
    if (updates.status === 'sent' && proposal.status === 'draft') {
      updates.expires_at = computeExpiry(proposal.validity_days || 7);
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await db.query(
      `UPDATE proposals SET ${setClauses} WHERE id = ?`,
      [...Object.values(updates), req.params.id]
    );

    const [updated] = await db.query('SELECT * FROM proposals WHERE id = ?', [req.params.id]);
    if (updated[0].sections && typeof updated[0].sections === 'string') {
      try { updated[0].sections = JSON.parse(updated[0].sections); } catch (_) {}
    }

    res.emitSocket('proposals:updated', updated[0]);
    return res.json(updated[0]);
  } catch (err) {
    console.error('Proposals update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * DELETE /api/proposals/:id (soft delete)
 */
exports.remove = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM proposals WHERE id = ? AND deleted = 0',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Proposal not found' });

    const proposal = rows[0];
    if (!req.user.is_admin && proposal.created_by !== req.user.id) {
      return res.status(403).json({ message: 'Only the creator or admin can delete this proposal' });
    }

    await db.query('UPDATE proposals SET deleted = 1 WHERE id = ?', [req.params.id]);
    res.emitSocket('proposals:deleted', { id: req.params.id });
    return res.json({ message: 'Proposal deleted' });
  } catch (err) {
    console.error('Proposals remove error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PATCH /api/proposals/:id/mark-sent
 * Mark proposal as sent (copy link action)
 */
exports.markSent = async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM proposals WHERE id = ? AND deleted = 0',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Proposal not found' });

    const proposal = rows[0];
    if (!req.user.is_admin && proposal.created_by !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Only move forward from draft → sent (don't downgrade accepted/viewed)
    if (proposal.status === 'draft') {
      const expiresAt = computeExpiry(proposal.validity_days || 7);
      await db.query(
        "UPDATE proposals SET status = 'sent', expires_at = ? WHERE id = ?",
        [expiresAt, req.params.id]
      );
    }

    const [updated] = await db.query('SELECT * FROM proposals WHERE id = ?', [req.params.id]);
    res.emitSocket('proposals:updated', updated[0]);
    return res.json(updated[0]);
  } catch (err) {
    console.error('Proposals markSent error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC endpoints (no authentication — for client access)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/proposals/public/:token
 * Client opens the proposal link — returns data + logs the view
 */
exports.getPublic = async (req, res) => {
  try {
    const { token } = req.params;

    const [rows] = await db.query(
      `SELECT p.*,
              CONCAT(u.first_name, ' ', u.last_name) AS created_by_name
       FROM proposals p
       LEFT JOIN users u ON u.id = p.created_by
       WHERE p.proposal_token = ? AND p.deleted = 0`,
      [token]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Proposal not found' });
    }

    const proposal = rows[0];

    // Check expiry
    if (proposal.expires_at && new Date(proposal.expires_at) < new Date()) {
      return res.status(410).json({
        message: 'This proposal has expired',
        expired: true,
        client_name: proposal.client_name,
        title: proposal.title,
        prepared_by_name: proposal.prepared_by_name,
        prepared_by_email: proposal.prepared_by_email,
        prepared_by_phone: proposal.prepared_by_phone,
      });
    }

    // Parse sections JSON
    if (proposal.sections && typeof proposal.sections === 'string') {
      try { proposal.sections = JSON.parse(proposal.sections); } catch (_) {}
    }

    // Log the view (don't await — fire and forget so client response is instant)
    const now = new Date();
    const updateQuery = proposal.first_viewed_at
      ? `UPDATE proposals SET
           view_count = view_count + 1,
           last_viewed_at = ?,
           status = CASE WHEN status = 'sent' THEN 'viewed' ELSE status END
         WHERE id = ?`
      : `UPDATE proposals SET
           view_count = view_count + 1,
           first_viewed_at = ?,
           last_viewed_at = ?,
           status = CASE WHEN status IN ('draft','sent') THEN 'viewed' ELSE status END
         WHERE id = ?`;

    if (proposal.first_viewed_at) {
      db.query(updateQuery, [now, proposal.id]).catch(e => console.error('View log error:', e));
    } else {
      db.query(updateQuery, [now, now, proposal.id]).catch(e => console.error('View log error:', e));
    }

    // Emit socket so CRM updates in real-time
    try {
      const { getIO } = require('../config/socket');
      const io = getIO();
      if (io) {
        io.emit('proposals:viewed', {
          id:         proposal.id,
          view_count: (proposal.view_count || 0) + 1,
        });
      }
    } catch (_) { /* socket optional */ }

    // Return proposal data (exclude internal fields)
    const {
      deleted, created_by,
      ...publicData
    } = proposal;

    return res.json(publicData);
  } catch (err) {
    console.error('Proposals getPublic error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PATCH /api/proposals/public/:token/respond
 * Client accepts or rejects the proposal
 */
exports.respond = async (req, res) => {
  try {
    const { token } = req.params;
    const { action, client_note } = req.body;

    if (!['accepted', 'rejected'].includes(action)) {
      return res.status(400).json({ message: 'Action must be accepted or rejected' });
    }

    const [rows] = await db.query(
      'SELECT * FROM proposals WHERE proposal_token = ? AND deleted = 0',
      [token]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'Proposal not found' });
    }

    const proposal = rows[0];

    // Already responded
    if (['accepted', 'rejected'].includes(proposal.status)) {
      return res.status(400).json({
        message: `This proposal was already ${proposal.status}`,
        status:  proposal.status,
      });
    }

    // Check expiry
    if (proposal.expires_at && new Date(proposal.expires_at) < new Date()) {
      return res.status(410).json({ message: 'This proposal has expired', expired: true });
    }

    await db.query(
      `UPDATE proposals
       SET status = ?, client_note = ?, responded_at = NOW()
       WHERE id = ?`,
      [action, client_note || null, proposal.id]
    );

    // Notify CRM in real-time
    try {
      const { getIO } = require('../config/socket');
      const io = getIO();
      if (io) {
        io.emit('proposals:responded', {
          id:         proposal.id,
          status:     action,
          client_note,
        });
      }
    } catch (_) { /* socket optional */ }

    return res.json({
      message: `Proposal ${action} successfully`,
      status:  action,
    });
  } catch (err) {
    console.error('Proposals respond error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
