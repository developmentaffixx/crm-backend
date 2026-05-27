const { validationResult } = require('express-validator');
const db = require('../config/db');

/**
 * GET /api/content-write
 */
exports.list = async (req, res) => {
  try {
    const { status, service_type, content_type, search } = req.query;
    let where = 'cwr.deleted = 0';
    const params = [];

    if (status) { where += ' AND cwr.status = ?'; params.push(status); }
    if (service_type) { where += ' AND cwr.service_type = ?'; params.push(service_type); }
    if (content_type) { where += ' AND cwr.content_type = ?'; params.push(content_type); }
    if (search) {
      where += ' AND (cwr.hook_opening_line LIKE ? OR cwr.core_message LIKE ? OR l.business_name LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    // Non-admin: only see own requests
    if (!req.user.is_admin) {
      where += ' AND cwr.created_by = ?';
      params.push(req.user.id);
    }

    const [rows] = await db.query(
      `SELECT cwr.*,
              l.business_name AS client_brand_name,
              CONCAT(u_creator.first_name, ' ', u_creator.last_name) AS created_by_name,
              CONCAT(u_approver.first_name, ' ', u_approver.last_name) AS approved_by_name
       FROM content_write_requests cwr
       LEFT JOIN leads l ON l.id = cwr.client_brand_id
       LEFT JOIN users u_creator ON u_creator.id = cwr.created_by
       LEFT JOIN users u_approver ON u_approver.id = cwr.approved_by
       WHERE ${where}
       ORDER BY cwr.created_at DESC`,
      params
    );

    // Summary counts
    const summary = {
      total: rows.length,
      pending: rows.filter(r => r.status === 'pending').length,
      approved: rows.filter(r => r.status === 'approved').length,
      rejected: rows.filter(r => r.status === 'rejected').length,
      in_progress: rows.filter(r => r.status === 'in_progress').length,
      completed: rows.filter(r => r.status === 'completed').length,
    };

    return res.json({ requests: rows, summary });
  } catch (err) {
    console.error('Content write list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};


/**
 * GET /api/content-write/:id
 */
exports.getOne = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT cwr.*,
              l.business_name AS client_brand_name,
              CONCAT(u_creator.first_name, ' ', u_creator.last_name) AS created_by_name,
              CONCAT(u_approver.first_name, ' ', u_approver.last_name) AS approved_by_name
       FROM content_write_requests cwr
       LEFT JOIN leads l ON l.id = cwr.client_brand_id
       LEFT JOIN users u_creator ON u_creator.id = cwr.created_by
       LEFT JOIN users u_approver ON u_approver.id = cwr.approved_by
       WHERE cwr.id = ? AND cwr.deleted = 0`,
      [req.params.id]
    );

    if (rows.length === 0) return res.status(404).json({ message: 'Content request not found' });

    const request = rows[0];

    // Non-admin can only view own requests
    if (!req.user.is_admin && request.created_by !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    return res.json(request);
  } catch (err) {
    console.error('Content write getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/content-write
 */
exports.create = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const {
    client_brand_id, service_type, platform, content_type, deadline,
    hook_opening_line, core_message, call_to_action, hashtags,
    reference_links, visual_style_notes, brand_assets_link, special_instructions
  } = req.body;

  const toNull = (val) => (val === '' || val === undefined || val === null) ? null : val;
  const toInt = (val) => { const n = parseInt(val); return isNaN(n) ? null : n; };

  try {
    // Generate content_id_code: CNT-CLIENT-###
    let clientCode = 'GEN';
    if (toInt(client_brand_id)) {
      const [clientRows] = await db.query('SELECT client_code FROM leads WHERE id = ?', [toInt(client_brand_id)]);
      if (clientRows.length > 0 && clientRows[0].client_code) {
        clientCode = clientRows[0].client_code;
      }
    }
    const [lastContent] = await db.query(
      `SELECT content_id_code FROM content_write_requests WHERE content_id_code LIKE ? ORDER BY id DESC LIMIT 1`,
      [`CNT-${clientCode}-%`]
    );
    let contentSeq = 1;
    if (lastContent.length > 0 && lastContent[0].content_id_code) {
      const parts = lastContent[0].content_id_code.split('-');
      contentSeq = parseInt(parts[parts.length - 1], 10) + 1;
    }
    const content_id_code = `CNT-${clientCode}-${String(contentSeq).padStart(3, '0')}`;

    const [result] = await db.query(
      `INSERT INTO content_write_requests 
        (content_id_code, client_brand_id, service_type, platform, content_type, deadline,
         hook_opening_line, core_message, call_to_action, hashtags,
         reference_links, visual_style_notes, brand_assets_link, special_instructions,
         status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [
        content_id_code,
        toInt(client_brand_id), service_type, platform, content_type, deadline,
        toNull(hook_opening_line), toNull(core_message), toNull(call_to_action), toNull(hashtags),
        toNull(reference_links), toNull(visual_style_notes), toNull(brand_assets_link), toNull(special_instructions),
        req.user.id
      ]
    );

    const [rows] = await db.query(
      `SELECT cwr.*, l.business_name AS client_brand_name
       FROM content_write_requests cwr
       LEFT JOIN leads l ON l.id = cwr.client_brand_id
       WHERE cwr.id = ?`,
      [result.insertId]
    );

    res.emitSocket('content-write:created', rows[0]);
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Content write create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/content-write/:id
 */
exports.update = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM content_write_requests WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Content request not found' });

    const request = rows[0];

    // Only creator or admin can update
    if (!req.user.is_admin && request.created_by !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Cannot edit if already approved/completed
    if (!req.user.is_admin && ['approved', 'completed'].includes(request.status)) {
      return res.status(403).json({ message: 'Cannot edit an approved/completed request' });
    }

    const allowed = [
      'client_brand_id', 'service_type', 'platform', 'content_type', 'deadline',
      'hook_opening_line', 'core_message', 'call_to_action', 'hashtags',
      'reference_links', 'visual_style_notes', 'brand_assets_link', 'special_instructions'
    ];

    const updates = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f] === '' ? null : req.body[f]; });

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }

    // If user resubmits after rejection, reset to pending
    if (request.status === 'rejected') {
      updates.status = 'pending';
    }

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = [...Object.values(updates), req.params.id];
    await db.query(`UPDATE content_write_requests SET ${setClauses} WHERE id = ?`, values);

    const [updated] = await db.query(
      `SELECT cwr.*, l.business_name AS client_brand_name
       FROM content_write_requests cwr
       LEFT JOIN leads l ON l.id = cwr.client_brand_id
       WHERE cwr.id = ?`,
      [req.params.id]
    );

    res.emitSocket('content-write:updated', updated[0]);
    return res.json(updated[0]);
  } catch (err) {
    console.error('Content write update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/content-write/:id/approve  (Admin only)
 */
exports.approve = async (req, res) => {
  try {
    if (!req.user.is_admin) {
      return res.status(403).json({ message: 'Only admin can approve/reject requests' });
    }

    const [rows] = await db.query('SELECT * FROM content_write_requests WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Content request not found' });

    const { action, admin_remarks } = req.body;

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ message: 'Action must be approve or reject' });
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected';

    await db.query(
      `UPDATE content_write_requests 
       SET status = ?, admin_remarks = ?, approved_by = ?, approved_at = NOW()
       WHERE id = ?`,
      [newStatus, admin_remarks || null, req.user.id, req.params.id]
    );

    const [updated] = await db.query(
      `SELECT cwr.*, l.business_name AS client_brand_name,
              CONCAT(u.first_name, ' ', u.last_name) AS approved_by_name
       FROM content_write_requests cwr
       LEFT JOIN leads l ON l.id = cwr.client_brand_id
       LEFT JOIN users u ON u.id = cwr.approved_by
       WHERE cwr.id = ?`,
      [req.params.id]
    );

    res.emitSocket('content-write:updated', updated[0]);
    return res.json(updated[0]);
  } catch (err) {
    console.error('Content write approve error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * DELETE /api/content-write/:id (soft delete)
 */
exports.remove = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM content_write_requests WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Content request not found' });

    const request = rows[0];
    if (!req.user.is_admin && request.created_by !== req.user.id) {
      return res.status(403).json({ message: 'Only the creator or admin can delete this request' });
    }

    await db.query('UPDATE content_write_requests SET deleted = 1 WHERE id = ?', [req.params.id]);
    res.emitSocket('content-write:deleted', { id: req.params.id });
    return res.json({ message: 'Content request deleted' });
  } catch (err) {
    console.error('Content write delete error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
