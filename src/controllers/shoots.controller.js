const { validationResult } = require('express-validator');
const db = require('../config/db');

const toNull = (val) => (val === '' || val === undefined || val === null) ? null : val;
const toInt = (val) => { const n = parseInt(val); return isNaN(n) ? null : n; };

/**
 * GET /api/shoots
 */
exports.list = async (req, res) => {
  try {
    const { status, search } = req.query;
    let where = 's.deleted = 0';
    const params = [];

    if (status) { where += ' AND s.status = ?'; params.push(status); }
    if (search) {
      where += ' AND (s.project_campaign_name LIKE ? OR s.city LIKE ? OR l.business_name LIKE ?)';
      const q = `%${search}%`;
      params.push(q, q, q);
    }

    if (!req.user.is_admin) {
      if (req.socialAccessLevel >= 2) {
        // SMM lead with full access — see all shoots
      } else {
        // Show shoots where user is creator, shoot manager, or filled from their calendar slot
        where += ` AND (s.created_by = ? OR s.shoot_manager_id = ?)`;
        params.push(req.user.id, req.user.id);
      }
    }

    const [rows] = await db.query(
      `SELECT s.*,
              l.business_name AS client_brand_name,
              CONCAT(uc.first_name, ' ', uc.last_name) AS created_by_name,
              CONCAT(um.first_name, ' ', um.last_name) AS shoot_manager_name
       FROM shoots s
       LEFT JOIN leads l ON l.id = s.client_brand_id
       LEFT JOIN users uc ON uc.id = s.created_by
       LEFT JOIN users um ON um.id = s.shoot_manager_id
       WHERE ${where}
       ORDER BY s.shoot_date DESC, s.created_at DESC`,
      params
    );

    const summary = {
      total: rows.length,
      pending_approval: rows.filter(r => r.status === 'pending_approval').length,
      approved: rows.filter(r => r.status === 'approved').length,
      rejected: rows.filter(r => r.status === 'rejected').length,
      pending_completion: rows.filter(r => r.status === 'pending_completion').length,
      completed: rows.filter(r => r.status === 'completed').length,
    };

    return res.json({ shoots: rows, summary });
  } catch (err) {
    console.error('Shoots list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/shoots/:id
 */
exports.getOne = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT s.*,
              l.business_name AS client_brand_name,
              CONCAT(uc.first_name, ' ', uc.last_name) AS created_by_name,
              CONCAT(um.first_name, ' ', um.last_name) AS shoot_manager_name,
              CONCAT(ua.first_name, ' ', ua.last_name) AS approved_by_name,
              CONCAT(uca.first_name, ' ', uca.last_name) AS completion_approved_by_name
       FROM shoots s
       LEFT JOIN leads l ON l.id = s.client_brand_id
       LEFT JOIN users uc ON uc.id = s.created_by
       LEFT JOIN users um ON um.id = s.shoot_manager_id
       LEFT JOIN users ua ON ua.id = s.approved_by
       LEFT JOIN users uca ON uca.id = s.completion_approved_by
       WHERE s.id = ? AND s.deleted = 0`,
      [req.params.id]
    );

    if (rows.length === 0) return res.status(404).json({ message: 'Shoot not found' });

    const shoot = rows[0];
    // Access: admin, creator, assigned team members
    if (!req.user.is_admin && shoot.created_by !== req.user.id) {
      const photographers = shoot.photographers ? (typeof shoot.photographers === 'string' ? JSON.parse(shoot.photographers) : shoot.photographers) : [];
      const videographers = shoot.videographers ? (typeof shoot.videographers === 'string' ? JSON.parse(shoot.videographers) : shoot.videographers) : [];
      const isAssigned = shoot.shoot_manager_id === req.user.id || photographers.includes(req.user.id) || videographers.includes(req.user.id);
      if (!isAssigned) {
        return res.status(403).json({ message: 'Access denied' });
      }
    }

    // Parse JSON fields
    if (shoot.photographers && typeof shoot.photographers === 'string') {
      shoot.photographers = JSON.parse(shoot.photographers);
    }
    if (shoot.videographers && typeof shoot.videographers === 'string') {
      shoot.videographers = JSON.parse(shoot.videographers);
    }

    // Fetch photographer and videographer names
    if (shoot.photographers && shoot.photographers.length > 0) {
      const [pUsers] = await db.query(
        `SELECT id, CONCAT(first_name, ' ', last_name) AS name FROM users WHERE id IN (?)`,
        [shoot.photographers]
      );
      shoot.photographer_names = pUsers;
    }
    if (shoot.videographers && shoot.videographers.length > 0) {
      const [vUsers] = await db.query(
        `SELECT id, CONCAT(first_name, ' ', last_name) AS name FROM users WHERE id IN (?)`,
        [shoot.videographers]
      );
      shoot.videographer_names = vUsers;
    }

    return res.json(shoot);
  } catch (err) {
    console.error('Shoots getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/shoots
 */
exports.create = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const {
    client_brand_id, project_campaign_name, shoot_date, reporting_time,
    location_type, exact_address, city, maps_link,
    photographers, videographers, shoot_manager_id,
    calendar_slot_id,
  } = req.body;

  try {
    // Generate shoot_id_code
    const shootDateObj = shoot_date ? new Date(shoot_date) : new Date();
    const yy = String(shootDateObj.getFullYear()).slice(-2);
    const mm = String(shootDateObj.getMonth() + 1).padStart(2, '0');
    const dd = String(shootDateObj.getDate()).padStart(2, '0');

    let clientCode = 'GEN';
    if (toInt(client_brand_id)) {
      const [clientRows] = await db.query('SELECT client_code FROM leads WHERE id = ?', [toInt(client_brand_id)]);
      if (clientRows.length > 0 && clientRows[0].client_code) clientCode = clientRows[0].client_code;
    }
    const shootPrefix = `SHT-${yy}${mm}${dd}-${clientCode}`;
    const [lastShoot] = await db.query(`SELECT shoot_id_code FROM shoots WHERE deleted = 0 ORDER BY id DESC LIMIT 1`);
    let shootSeq = 1;
    if (lastShoot.length > 0 && lastShoot[0].shoot_id_code) {
      const parts = lastShoot[0].shoot_id_code.split('-');
      const lastNum = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastNum)) shootSeq = lastNum + 1;
    }
    const shoot_id_code = `${shootPrefix}-${String(shootSeq).padStart(3, '0')}`;

    const slotIdVal = toInt(calendar_slot_id);

    // Try inserting with calendar_slot_id — fall back without it if column doesn't exist
    let insertId;
    try {
      const [result] = await db.query(
        `INSERT INTO shoots 
          (shoot_id_code, client_brand_id, project_campaign_name, shoot_date, reporting_time,
           location_type, exact_address, city, maps_link,
           photographers, videographers, shoot_manager_id,
           calendar_slot_id, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_approval', ?)`,
        [
          shoot_id_code,
          toInt(client_brand_id), project_campaign_name, shoot_date, toNull(reporting_time),
          location_type, toNull(exact_address), toNull(city), toNull(maps_link),
          photographers ? JSON.stringify(photographers) : null,
          videographers ? JSON.stringify(videographers) : null,
          toInt(shoot_manager_id),
          slotIdVal,
          req.user.id,
        ]
      );
      insertId = result.insertId;
    } catch (insertErr) {
      if (insertErr.code === 'ER_BAD_FIELD_ERROR' || String(insertErr.message).includes('calendar_slot_id')) {
        const [result] = await db.query(
          `INSERT INTO shoots 
            (shoot_id_code, client_brand_id, project_campaign_name, shoot_date, reporting_time,
             location_type, exact_address, city, maps_link,
             photographers, videographers, shoot_manager_id,
             status, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_approval', ?)`,
          [
            shoot_id_code,
            toInt(client_brand_id), project_campaign_name, shoot_date, toNull(reporting_time),
            location_type, toNull(exact_address), toNull(city), toNull(maps_link),
            photographers ? JSON.stringify(photographers) : null,
            videographers ? JSON.stringify(videographers) : null,
            toInt(shoot_manager_id),
            req.user.id,
          ]
        );
        insertId = result.insertId;
      } else {
        throw insertErr;
      }
    }

    // Sync slot to submitted if linked
    if (slotIdVal) {
      try {
        await db.query(
          `UPDATE content_calendar_shoots SET slot_status = 'submitted', submitted_at = NOW(), rejection_reason = NULL WHERE id = ?`,
          [slotIdVal]
        );
        res.emitSocket('content-calendar:slot-submitted', { item_type: 'shoot', item_id: slotIdVal });

        const [slotInfo] = await db.query('SELECT assigned_by FROM content_calendar_shoots WHERE id = ?', [slotIdVal]);
        if (slotInfo.length > 0 && slotInfo[0].assigned_by) {
          await db.query(
            `INSERT INTO smm_notifications (user_id, triggered_by, type, slot_type, slot_id, title, message, link)
             VALUES (?, ?, 'slot_submitted', 'shoot', ?, 'Shoot slot submitted for approval', 'Shoot details filled. Please review.', '/social/content-calendar')`,
            [slotInfo[0].assigned_by, req.user.id, slotIdVal]
          );
          res.emitSocket('smm:notification', { user_id: slotInfo[0].assigned_by, type: 'slot_submitted' });
        }
      } catch (slotErr) {
        console.warn('Shoot slot sync warning:', slotErr.message);
      }
    }

    const [rows] = await db.query(
      `SELECT s.*, l.business_name AS client_brand_name
       FROM shoots s LEFT JOIN leads l ON l.id = s.client_brand_id
       WHERE s.id = ?`,
      [insertId]
    );

    res.emitSocket('shoots:created', rows[0]);
    return res.status(201).json(rows[0]);
  } catch (err) {
    console.error('Shoots create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/shoots/:id
 */
exports.update = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM shoots WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Shoot not found' });

    const shoot = rows[0];

    if (!req.user.is_admin && shoot.created_by !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Non-admin cannot edit if completed
    if (!req.user.is_admin && shoot.status === 'completed') {
      return res.status(403).json({ message: 'Cannot edit a completed shoot' });
    }

    // Non-admin cannot edit if pending_completion (waiting for admin)
    if (!req.user.is_admin && shoot.status === 'pending_completion') {
      return res.status(403).json({ message: 'Cannot edit while pending completion approval' });
    }

    const allowed = [
      'client_brand_id', 'project_campaign_name', 'shoot_date', 'reporting_time',
      'location_type', 'exact_address', 'city', 'maps_link',
      'photographers', 'videographers', 'shoot_manager_id',
      'post_start_time', 'post_end_time', 'post_duration_minutes', 'in_summary'
    ];

    const updates = {};
    allowed.forEach(f => {
      if (req.body[f] !== undefined) {
        if (f === 'photographers' || f === 'videographers') {
          updates[f] = req.body[f] ? JSON.stringify(req.body[f]) : null;
        } else {
          updates[f] = req.body[f] === '' ? null : req.body[f];
        }
      }
    });

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }

    // Auto-calculate post_duration_minutes if both post times are provided
    if (req.body.post_start_time && req.body.post_end_time) {
      const [sh, sm] = req.body.post_start_time.split(':').map(Number);
      const [eh, em] = req.body.post_end_time.split(':').map(Number);
      const startMins = sh * 60 + sm;
      const endMins = eh * 60 + em;
      updates.post_duration_minutes = endMins >= startMins ? endMins - startMins : (24 * 60 - startMins) + endMins;
    }

    // If member submits post-duration data and current status is 'approved',
    // move to pending_completion for admin sign-off (close request)
    if (req.body.post_start_time && req.body.post_end_time && shoot.status === 'approved') {
      // Validate in_summary — minimum 30 words
      const summary = (req.body.in_summary || '').trim();
      const wordCount = summary.split(/\s+/).filter(Boolean).length;
      if (wordCount < 30) {
        return res.status(400).json({ message: 'In Summary must be at least 30 words' });
      }
      updates.status = 'pending_completion';
    }

    // If rejected or approved (re-work), resubmit resets to pending_approval
    if (['rejected', 'approved'].includes(shoot.status) && !req.user.is_admin) {
      updates.status = 'pending_approval';
    }

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = [...Object.values(updates), req.params.id];
    await db.query(`UPDATE shoots SET ${setClauses} WHERE id = ?`, values);

    // ─── Sync to calendar slot: submit when shoot details are filled ──────────
    if (shoot.calendar_slot_id && (['rejected', 'approved'].includes(shoot.status) || updates.status === 'pending_approval')) {
      await db.query(
        `UPDATE content_calendar_shoots SET slot_status = 'submitted', submitted_at = NOW(), rejection_reason = NULL WHERE id = ?`,
        [shoot.calendar_slot_id]
      );
      res.emitSocket('content-calendar:slot-submitted', { item_type: 'shoot', item_id: shoot.calendar_slot_id });

      // Notify the assigner
      const [slotInfo] = await db.query('SELECT assigned_by FROM content_calendar_shoots WHERE id = ?', [shoot.calendar_slot_id]);
      if (slotInfo.length > 0 && slotInfo[0].assigned_by) {
        await db.query(
          `INSERT INTO smm_notifications (user_id, triggered_by, type, slot_type, slot_id, title, message, link)
           VALUES (?, ?, 'slot_submitted', 'shoot', ?, 'Shoot slot submitted for approval', 'Shoot details filled. Please review.', '/social/content-calendar')`,
          [slotInfo[0].assigned_by, req.user.id, shoot.calendar_slot_id]
        );
        res.emitSocket('smm:notification', { user_id: slotInfo[0].assigned_by, type: 'slot_submitted' });
      }
    }

    const [updated] = await db.query(
      `SELECT s.*, l.business_name AS client_brand_name,
              CONCAT(um.first_name, ' ', um.last_name) AS shoot_manager_name
       FROM shoots s
       LEFT JOIN leads l ON l.id = s.client_brand_id
       LEFT JOIN users um ON um.id = s.shoot_manager_id
       WHERE s.id = ?`,
      [req.params.id]
    );

    res.emitSocket('shoots:updated', updated[0]);
    return res.json(updated[0]);
  } catch (err) {
    console.error('Shoots update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * PUT /api/shoots/:id/approve (Admin only — handles both stages)
 */
exports.approve = async (req, res) => {
  try {
    if (!req.user.is_admin && req.socialAccessLevel < 2) {
      return res.status(403).json({ message: 'Only admin or SMM leads can approve/reject' });
    }

    const [rows] = await db.query('SELECT * FROM shoots WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Shoot not found' });

    const shoot = rows[0];
    const { action, remarks } = req.body; // action: 'approve' or 'reject'

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ message: 'Action must be approve or reject' });
    }

    // Stage 1: pending_approval
    if (shoot.status === 'pending_approval') {
      const newStatus = action === 'approve' ? 'approved' : 'rejected';
      await db.query(
        `UPDATE shoots SET status = ?, approved_by = ?, approved_at = NOW(), approval_remarks = ? WHERE id = ?`,
        [newStatus, req.user.id, remarks || null, req.params.id]
      );

      // ─── Sync to calendar slot ──────────────────────────────────────────────
      if (shoot.calendar_slot_id) {
        if (action === 'approve') {
          await db.query(
            `UPDATE content_calendar_shoots SET slot_status = 'approved', approved_at = NOW(), approved_by = ?, rejection_reason = NULL WHERE id = ?`,
            [req.user.id, shoot.calendar_slot_id]
          );
          if (shoot.created_by) {
            await db.query(
              `INSERT INTO smm_notifications (user_id, triggered_by, type, slot_type, slot_id, title, message, link)
               VALUES (?, ?, 'slot_approved', 'shoot', ?, 'Your shoot slot was approved! 🎉', 'Shoot is now live on the calendar.', '/social/shoots')`,
              [shoot.created_by, req.user.id, shoot.calendar_slot_id]
            );
            res.emitSocket('smm:notification', { user_id: shoot.created_by, type: 'slot_approved' });
          }
        } else {
          await db.query(
            `UPDATE content_calendar_shoots SET slot_status = 'rejected', rejection_reason = ?, approved_at = NULL, approved_by = NULL WHERE id = ?`,
            [remarks || 'Rejected', shoot.calendar_slot_id]
          );
          if (shoot.created_by) {
            await db.query(
              `INSERT INTO smm_notifications (user_id, triggered_by, type, slot_type, slot_id, title, message, link)
               VALUES (?, ?, 'slot_rejected', 'shoot', ?, 'Your shoot slot was rejected', ?, '/social/shoots')`,
              [shoot.created_by, req.user.id, shoot.calendar_slot_id, `Reason: ${remarks || 'Please re-edit'}`]
            );
            res.emitSocket('smm:notification', { user_id: shoot.created_by, type: 'slot_rejected' });
          }
        }
        res.emitSocket('content-calendar:updated', { slot_id: shoot.calendar_slot_id });
      }
    }
    // Stage 2: pending_completion (close request approval)
    else if (shoot.status === 'pending_completion') {
      if (action === 'approve') {
        await db.query(
          `UPDATE shoots SET status = 'completed', completion_approved_by = ?, completion_approved_at = NOW(), completion_remarks = ? WHERE id = ?`,
          [req.user.id, remarks || null, req.params.id]
        );
      } else {
        // Reject sends back to approved so member can re-edit
        await db.query(
          `UPDATE shoots SET status = 'approved', completion_remarks = ? WHERE id = ?`,
          [remarks || null, req.params.id]
        );
      }
    } else {
      return res.status(400).json({ message: `Cannot approve/reject a shoot with status: ${shoot.status}` });
    }

    const [updated] = await db.query(
      `SELECT s.*, l.business_name AS client_brand_name,
              CONCAT(um.first_name, ' ', um.last_name) AS shoot_manager_name,
              CONCAT(ua.first_name, ' ', ua.last_name) AS approved_by_name,
              CONCAT(uca.first_name, ' ', uca.last_name) AS completion_approved_by_name
       FROM shoots s
       LEFT JOIN leads l ON l.id = s.client_brand_id
       LEFT JOIN users um ON um.id = s.shoot_manager_id
       LEFT JOIN users ua ON ua.id = s.approved_by
       LEFT JOIN users uca ON uca.id = s.completion_approved_by
       WHERE s.id = ?`,
      [req.params.id]
    );

    res.emitSocket('shoots:updated', updated[0]);
    return res.json(updated[0]);
  } catch (err) {
    console.error('Shoots approve error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * DELETE /api/shoots/:id (soft delete)
 */
exports.remove = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM shoots WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Shoot not found' });

    if (!req.user.is_admin && rows[0].created_by !== req.user.id) {
      return res.status(403).json({ message: 'Only the creator or admin can delete' });
    }

    await db.query('UPDATE shoots SET deleted = 1 WHERE id = ?', [req.params.id]);
    res.emitSocket('shoots:deleted', { id: req.params.id });
    return res.json({ message: 'Shoot deleted' });
  } catch (err) {
    console.error('Shoots delete error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
