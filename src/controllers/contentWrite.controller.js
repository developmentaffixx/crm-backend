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

    // Build the query. `cwr.posting_date` may not exist yet if the migration
    // hasn't run — fall back to slot-only posting date in that case.
    const buildListQuery = (hasPostingDate) => {
      const postingExpr = hasPostingDate
        ? 'COALESCE(cwr.posting_date, ccp.posting_date)'
        : 'ccp.posting_date';
      return `SELECT cwr.*,
              l.business_name AS client_brand_name,
              p.title AS project_title,
              s.name AS service_name,
              CONCAT(u_creator.first_name, ' ', u_creator.last_name) AS created_by_name,
              CONCAT(u_approver.first_name, ' ', u_approver.last_name) AS approved_by_name,
              ccp.posting_date AS slot_posting_date,
              ${postingExpr} AS effective_posting_date,
              COALESCE(cwr.content_type, ccp.format) AS content_type
       FROM content_write_requests cwr
       LEFT JOIN leads l ON l.id = cwr.client_brand_id
       LEFT JOIN projects p ON p.id = cwr.project_id
       LEFT JOIN services s ON s.id = cwr.service_id
       LEFT JOIN users u_creator ON u_creator.id = cwr.created_by
       LEFT JOIN users u_approver ON u_approver.id = cwr.approved_by
       LEFT JOIN content_calendar_posts ccp ON ccp.id = cwr.calendar_slot_id
       WHERE ${where}
       ORDER BY (${postingExpr} IS NULL) ASC, ${postingExpr} ASC, cwr.created_at ASC`;
    };

    let rows;
    try {
      [rows] = await db.query(buildListQuery(true), params);
    } catch (qErr) {
      const errMsg = String(qErr.message || qErr.sqlMessage || '');
      if (qErr.code === 'ER_BAD_FIELD_ERROR' || qErr.errno === 1054 || errMsg.includes('posting_date')) {
        [rows] = await db.query(buildListQuery(false), params);
      } else {
        throw qErr;
      }
    }

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
    const buildOneQuery = (hasPostingDate) => {
      const postingExpr = hasPostingDate
        ? 'COALESCE(cwr.posting_date, ccp.posting_date)'
        : 'ccp.posting_date';
      return `SELECT cwr.*,
              l.business_name AS client_brand_name,
              p.title AS project_title,
              s.name AS service_name,
              CONCAT(u_creator.first_name, ' ', u_creator.last_name) AS created_by_name,
              CONCAT(u_approver.first_name, ' ', u_approver.last_name) AS approved_by_name,
              ccp.posting_date AS slot_posting_date,
              ${postingExpr} AS effective_posting_date
       FROM content_write_requests cwr
       LEFT JOIN leads l ON l.id = cwr.client_brand_id
       LEFT JOIN projects p ON p.id = cwr.project_id
       LEFT JOIN services s ON s.id = cwr.service_id
       LEFT JOIN users u_creator ON u_creator.id = cwr.created_by
       LEFT JOIN users u_approver ON u_approver.id = cwr.approved_by
       LEFT JOIN content_calendar_posts ccp ON ccp.id = cwr.calendar_slot_id
       WHERE cwr.id = ? AND cwr.deleted = 0`;
    };

    let rows;
    try {
      [rows] = await db.query(buildOneQuery(true), [req.params.id]);
    } catch (qErr) {
      const errMsg = String(qErr.message || qErr.sqlMessage || '');
      if (qErr.code === 'ER_BAD_FIELD_ERROR' || qErr.errno === 1054 || errMsg.includes('posting_date')) {
        [rows] = await db.query(buildOneQuery(false), [req.params.id]);
      } else {
        throw qErr;
      }
    }

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
    calendar_slot_id, posting_date,
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

    // Try inserting with calendar_slot_id — fall back without it if column doesn't exist
    let insertId;
    const slotIdVal = toInt(calendar_slot_id);

    try {
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
          slotIdVal, req.user.id,
        ]
      );
      insertId = result.insertId;
    } catch (insertErr) {
      const errMsg = String(insertErr.message || insertErr.sqlMessage || '');
      const errCode = insertErr.code || '';
      const errNo = insertErr.errno || 0;

      // Missing column (calendar_slot_id not in DB yet) — retry without it
      if (errCode === 'ER_BAD_FIELD_ERROR' || errNo === 1054 ||
          errMsg.includes('calendar_slot_id')) {
        const [result] = await db.query(
          `INSERT INTO content_write_requests 
            (content_id_code, client_brand_id, project_id, service_id, platform, content_type,
             hook_opening_line, core_message, call_to_action,
             caption_content, creative_suggestion, reference_links,
             status, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
          [
            content_id_code,
            resolvedClientBrandId, toInt(project_id), toInt(service_id),
            toNull(platform), content_type,
            toNull(hook_opening_line), toNull(core_message), toNull(call_to_action),
            toNull(caption_content), toNull(creative_suggestion), toNull(reference_links),
            req.user.id,
          ]
        );
        insertId = result.insertId;

      // platform NOT NULL constraint — platform column hasn't been made nullable yet
      } else if ((errCode === 'ER_BAD_NULL_ERROR' || errNo === 1048) &&
                 errMsg.includes('platform')) {
        // Insert with a default platform value to bypass the constraint
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
            'social_media', // default until migration runs
            content_type,
            toNull(hook_opening_line), toNull(core_message), toNull(call_to_action),
            toNull(caption_content), toNull(creative_suggestion), toNull(reference_links),
            slotIdVal, req.user.id,
          ]
        );
        insertId = result.insertId;

      // service_type NOT NULL constraint
      } else if ((errCode === 'ER_BAD_NULL_ERROR' || errNo === 1048) &&
                 errMsg.includes('service_type')) {
        const [result] = await db.query(
          `INSERT INTO content_write_requests 
            (content_id_code, client_brand_id, project_id, service_id, platform, service_type, content_type,
             hook_opening_line, core_message, call_to_action,
             caption_content, creative_suggestion, reference_links,
             calendar_slot_id, status, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
          [
            content_id_code,
            resolvedClientBrandId, toInt(project_id), toInt(service_id),
            toNull(platform), 'social_media_management', // default
            content_type,
            toNull(hook_opening_line), toNull(core_message), toNull(call_to_action),
            toNull(caption_content), toNull(creative_suggestion), toNull(reference_links),
            slotIdVal, req.user.id,
          ]
        );
        insertId = result.insertId;

      } else {
        throw insertErr;
      }
    }

    // Persist posting_date separately so it works regardless of which insert
    // branch ran, and degrades gracefully if the column doesn't exist yet.
    const postingDateVal = toNull(posting_date);
    if (postingDateVal) {
      try {
        await db.query('UPDATE content_write_requests SET posting_date = ? WHERE id = ?', [postingDateVal, insertId]);
      } catch (pdErr) {
        console.warn('posting_date not set (column may be missing):', pdErr.message);
      }
    }

    // Sync slot to submitted if linked
    if (slotIdVal) {
      try {
        await db.query(
          `UPDATE content_calendar_posts SET slot_status = 'submitted', submitted_at = NOW(), rejection_reason = NULL WHERE id = ?`,
          [slotIdVal]
        );
        res.emitSocket('content-calendar:slot-submitted', { item_type: 'post', item_id: slotIdVal });

        const [slotInfo] = await db.query('SELECT assigned_by FROM content_calendar_posts WHERE id = ?', [slotIdVal]);
        if (slotInfo.length > 0 && slotInfo[0].assigned_by) {
          await db.query(
            `INSERT INTO smm_notifications (user_id, triggered_by, type, slot_type, slot_id, title, message, link)
             VALUES (?, ?, 'slot_submitted', 'post', ?, 'Post slot submitted for approval', 'Content has been filled and submitted.', '/social/content-calendar')`,
            [slotInfo[0].assigned_by, req.user.id, slotIdVal]
          );
          res.emitSocket('smm:notification', { user_id: slotInfo[0].assigned_by, type: 'slot_submitted' });
        }
      } catch (slotErr) {
        // Don't fail the whole request if slot sync fails
        console.warn('Slot sync warning:', slotErr.message);
      }
    }

    const [rows] = await db.query(
      `SELECT cwr.*, l.business_name AS client_brand_name, p.title AS project_title
       FROM content_write_requests cwr
       LEFT JOIN leads l ON l.id = cwr.client_brand_id
       LEFT JOIN projects p ON p.id = cwr.project_id
       WHERE cwr.id = ?`,
      [insertId]
    );

    res.emitSocket('content-write:created', rows[0]);

    // Log submit to history
    try {
      await db.query(
        `INSERT INTO smm_approval_history (module, record_id, action, remarks, acted_by) VALUES (?, ?, ?, ?, ?)`,
        ['content_write', insertId, 'submit', null, req.user.id]
      );
    } catch (e) { /* table may not exist */ }

    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Content write create error:', err);
    return res.status(500).json({
      message: err.sqlMessage || err.message || 'Server error',
      detail: err.message,
      code: err.code,
    });
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

    // posting_date handled separately (guarded) so it degrades gracefully if
    // the column doesn't exist yet.
    const hasPostingDate = req.body.posting_date !== undefined;
    const postingDateVal = req.body.posting_date === '' ? null : req.body.posting_date;

    if (Object.keys(updates).length === 0 && !hasPostingDate) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }

    // If user resubmits after rejection OR re-works after approval, reset to pending
    if (['rejected', 'approved'].includes(request.status)) {
      updates.status = 'pending';
      // Log resubmit to history
      try {
        await db.query(
          `INSERT INTO smm_approval_history (module, record_id, action, remarks, acted_by) VALUES (?, ?, ?, ?, ?)`,
          ['content_write', req.params.id, 'resubmit', null, req.user.id]
        );
      } catch (e) { /* table may not exist */ }
    }

    if (Object.keys(updates).length > 0) {
      const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
      const values = [...Object.values(updates), req.params.id];
      await db.query(`UPDATE content_write_requests SET ${setClauses} WHERE id = ?`, values);
    }

    if (hasPostingDate) {
      try {
        await db.query('UPDATE content_write_requests SET posting_date = ? WHERE id = ?', [postingDateVal, req.params.id]);
      } catch (pdErr) {
        console.warn('posting_date not updated (column may be missing):', pdErr.message);
      }
    }

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

    // Log approval history
    try {
      await db.query(
        `INSERT INTO smm_approval_history (module, record_id, action, remarks, acted_by) VALUES (?, ?, ?, ?, ?)`,
        ['content_write', req.params.id, action === 'approve' ? 'approve' : 'rework', admin_remarks || null, req.user.id]
      );
    } catch (e) { /* table may not exist yet */ }

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
 * GET /api/content-write/:id/history — approval/rework history
 */
exports.getHistory = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT h.*, CONCAT(u.first_name, ' ', u.last_name) AS acted_by_name
       FROM smm_approval_history h
       LEFT JOIN users u ON u.id = h.acted_by
       WHERE h.module = 'content_write' AND h.record_id = ?
       ORDER BY h.created_at DESC`,
      [req.params.id]
    );
    return res.json(rows);
  } catch (err) {
    // Table may not exist yet
    return res.json([]);
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
