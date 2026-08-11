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

    // Non-admin: only see own requests (unless SMM lead with level 2)
    if (!req.user.is_admin) {
      if (req.socialAccessLevel >= 2) {
        // SMM lead — see all
      } else {
        where += ' AND cwr.created_by = ?';
        params.push(req.user.id);
      }
    }

    const [rows] = await db.query(
      `SELECT cwr.*,
              l.business_name AS client_brand_name,
              p.title AS project_title,
              s.name AS service_name,
              CONCAT(u_creator.first_name, ' ', u_creator.last_name) AS created_by_name,
              CONCAT(u_approver.first_name, ' ', u_approver.last_name) AS approved_by_name
       FROM content_write_requests cwr
       LEFT JOIN leads l ON l.id = cwr.client_brand_id
       LEFT JOIN projects p ON p.id = cwr.project_id
       LEFT JOIN services s ON s.id = cwr.service_id
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
              p.title AS project_title,
              s.name AS service_name,
              CONCAT(u_creator.first_name, ' ', u_creator.last_name) AS created_by_name,
              CONCAT(u_approver.first_name, ' ', u_approver.last_name) AS approved_by_name
       FROM content_write_requests cwr
       LEFT JOIN leads l ON l.id = cwr.client_brand_id
       LEFT JOIN projects p ON p.id = cwr.project_id
       LEFT JOIN services s ON s.id = cwr.service_id
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
    client_brand_id, project_id, service_id, platform, content_type,
    hook_opening_line, core_message, call_to_action,
    caption_content, creative_suggestion, reference_links,
    calendar_slot_id,
  } = req.body;

  const toNull = (val) => (val === '' || val === undefined || val === null) ? null : val;
  const toInt  = (val) => { const n = parseInt(val); return isNaN(n) ? null : n; };

  try {
    // Resolve client_brand_id from project
    let resolvedClientBrandId = toInt(client_brand_id);
    if (toInt(project_id)) {
      const [projRows] = await db.query('SELECT client_id FROM projects WHERE id = ?', [toInt(project_id)]);
      if (projRows.length > 0 && projRows[0].client_id) resolvedClientBrandId = projRows[0].client_id;
    }

    // Generate content_id_code
    let clientCode = 'GEN';
    if (resolvedClientBrandId) {
      const [clientRows] = await db.query('SELECT client_code FROM leads WHERE id = ?', [resolvedClientBrandId]);
      if (clientRows.length > 0 && clientRows[0].client_code) clientCode = clientRows[0].client_code;
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
        (content_id_code, client_brand_id, project_id, service_id, platform, content_type,
         hook_opening_line, core_message, call_to_action,
         caption_content, creative_suggestion, reference_links,
         calendar_slot_id, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [
        content_id_code,
        resolvedClientBrandId, toInt(project_id), toInt(service_id),
        toNull(platform), content_type,
        toNull(hook_opening_line), toNull(core_message), toNull(call_to_action),
        toNull(caption_content), toNull(creative_suggestion), toNull(reference_links),
        toInt(calendar_slot_id),
        req.user.id,
      ]
    );

    // ─── Sync slot to submitted if linked ────────────────────────────────────
    if (toInt(calendar_slot_id)) {
      await db.query(
        `UPDATE content_calendar_posts SET slot_status = 'submitted', submitted_at = NOW(), rejection_reason = NULL WHERE id = ?`,
        [toInt(calendar_slot_id)]
      );
      res.emitSocket('content-calendar:slot-submitted', { item_type: 'post', item_id: toInt(calendar_slot_id) });

      const [slotInfo] = await db.query('SELECT assigned_by FROM content_calendar_posts WHERE id = ?', [toInt(calendar_slot_id)]);
      if (slotInfo.length > 0 && slotInfo[0].assigned_by) {
        await db.query(
          `INSERT INTO smm_notifications (user_id, triggered_by, type, slot_type, slot_id, title, message, link)
           VALUES (?, ?, 'slot_submitted', 'post', ?, 'Post slot submitted for approval', 'Content has been filled and submitted.', '/social/content-calendar')`,
          [slotInfo[0].assigned_by, req.user.id, toInt(calendar_slot_id)]
        );
        res.emitSocket('smm:notification', { user_id: slotInfo[0].assigned_by, type: 'slot_submitted' });
      }
    }

    const [rows] = await db.query(
      `SELECT cwr.*, l.business_name AS client_brand_name, p.title AS project_title
       FROM content_write_requests cwr
       LEFT JOIN leads l ON l.id = cwr.client_brand_id
       LEFT JOIN projects p ON p.id = cwr.project_id
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

    // Cannot edit if completed (fully done), but approved can still be re-worked
    if (!req.user.is_admin && request.status === 'completed') {
      return res.status(403).json({ message: 'Cannot edit a completed request' });
    }

    const allowed = [
      'project_id', 'service_id', 'platform', 'content_type',
      'hook_opening_line', 'core_message', 'call_to_action',
      'caption_content', 'creative_suggestion', 'reference_links'
    ];

    const updates = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f] === '' ? null : req.body[f]; });

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }

    // If user resubmits after rejection OR re-works after approval, reset to pending
    if (['rejected', 'approved'].includes(request.status)) {
      updates.status = 'pending';
    }

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = [...Object.values(updates), req.params.id];
    await db.query(`UPDATE content_write_requests SET ${setClauses} WHERE id = ?`, values);

    // ─── Sync to calendar slot: auto-submit when content is filled ────────────
    if (request.calendar_slot_id) {
      const newStatus = updates.status || request.status;
      if (newStatus === 'pending') {
        // Content was filled/re-submitted → mark slot as submitted
        await db.query(
          `UPDATE content_calendar_posts SET slot_status = 'submitted', submitted_at = NOW(), rejection_reason = NULL WHERE id = ?`,
          [request.calendar_slot_id]
        );
        res.emitSocket('content-calendar:slot-submitted', { item_type: 'post', item_id: request.calendar_slot_id });

        // Notify the assigner
        const [slotInfo] = await db.query('SELECT assigned_by FROM content_calendar_posts WHERE id = ?', [request.calendar_slot_id]);
        if (slotInfo.length > 0 && slotInfo[0].assigned_by) {
          await db.query(
            `INSERT INTO smm_notifications (user_id, triggered_by, type, slot_type, slot_id, title, message, link)
             VALUES (?, ?, 'slot_submitted', 'post', ?, 'Post slot submitted for approval', 'Content has been filled and submitted.', '/social/content-calendar')`,
            [slotInfo[0].assigned_by, req.user.id, request.calendar_slot_id]
          );
          res.emitSocket('smm:notification', { user_id: slotInfo[0].assigned_by, type: 'slot_submitted' });
        }
      }
    }

    const [updated] = await db.query(
      `SELECT cwr.*, l.business_name AS client_brand_name, p.title AS project_title
       FROM content_write_requests cwr
       LEFT JOIN leads l ON l.id = cwr.client_brand_id
       LEFT JOIN projects p ON p.id = cwr.project_id
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
    if (!req.user.is_admin && req.socialAccessLevel < 2) {
      return res.status(403).json({ message: 'Only admin or SMM leads can approve/reject requests' });
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

    // ─── Sync to calendar slot ────────────────────────────────────────────────
    const request = rows[0];
    if (request.calendar_slot_id) {
      if (action === 'approve') {
        await db.query(
          `UPDATE content_calendar_posts SET slot_status = 'approved', approved_at = NOW(), approved_by = ?, rejection_reason = NULL WHERE id = ?`,
          [req.user.id, request.calendar_slot_id]
        );
        // Notify assignee
        if (request.created_by) {
          await db.query(
            `INSERT INTO smm_notifications (user_id, triggered_by, type, slot_type, slot_id, title, message, link)
             VALUES (?, ?, 'slot_approved', 'post', ?, 'Your post slot was approved! 🎉', 'Your content is now live on the calendar.', '/social/write-content')`,
            [request.created_by, req.user.id, request.calendar_slot_id]
          );
          res.emitSocket('smm:notification', { user_id: request.created_by, type: 'slot_approved' });
        }
      } else {
        await db.query(
          `UPDATE content_calendar_posts SET slot_status = 'rejected', rejection_reason = ?, approved_at = NULL, approved_by = NULL WHERE id = ?`,
          [admin_remarks || 'Rejected', request.calendar_slot_id]
        );
        // Notify assignee
        if (request.created_by) {
          await db.query(
            `INSERT INTO smm_notifications (user_id, triggered_by, type, slot_type, slot_id, title, message, link)
             VALUES (?, ?, 'slot_rejected', 'post', ?, 'Your post slot was rejected', ?, '/social/write-content')`,
            [request.created_by, req.user.id, request.calendar_slot_id, `Reason: ${admin_remarks || 'Please re-edit'}`]
          );
          res.emitSocket('smm:notification', { user_id: request.created_by, type: 'slot_rejected' });
        }
      }
      res.emitSocket('content-calendar:updated', { slot_id: request.calendar_slot_id });
    }

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
