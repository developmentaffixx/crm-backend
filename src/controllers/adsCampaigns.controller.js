const db = require('../config/db');

// ─── LIST ────────────────────────────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    const { project_id, status, assigned_to, page = 1, limit = 20 } = req.query;
    let where = 'ac.deleted = 0';
    const params = [];

    if (project_id) { where += ' AND ac.project_id = ?'; params.push(project_id); }
    if (status) { where += ' AND ac.status = ?'; params.push(status); }
    if (assigned_to) { where += ' AND ac.assigned_to = ?'; params.push(assigned_to); }

    if (!req.user.is_admin) {
      if (req.socialAccessLevel >= 2) {
        // SMM lead — see all campaigns
      } else {
        where += ' AND (ac.created_by = ? OR ac.assigned_to = ? OR pm.user_id IS NOT NULL)';
        params.push(req.user.id, req.user.id);
      }
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);

    const [rows] = await db.query(
      `SELECT ac.*,
              p.title AS project_title,
              l.business_name AS client_name,
              CONCAT(ua.first_name, ' ', ua.last_name) AS assigned_to_name,
              CONCAT(uc.first_name, ' ', uc.last_name) AS created_by_name,
              acr.amount_spent AS report_amount_spent,
              COALESCE(acr.recommendations, acr.best_performing_ad) AS report_notes
       FROM ad_campaigns ac
       LEFT JOIN projects p ON p.id = ac.project_id
       LEFT JOIN leads l ON l.id = p.client_id
       LEFT JOIN users ua ON ua.id = ac.assigned_to
       LEFT JOIN users uc ON uc.id = ac.created_by
       LEFT JOIN ad_campaign_reports acr ON acr.campaign_id = ac.id
       ${!req.user.is_admin ? 'LEFT JOIN project_members pm ON pm.project_id = ac.project_id AND pm.user_id = ' + req.user.id : ''}
       WHERE ${where}
       ORDER BY ac.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    const [countResult] = await db.query(
      `SELECT COUNT(*) AS total FROM ad_campaigns ac
       ${!req.user.is_admin ? 'LEFT JOIN project_members pm ON pm.project_id = ac.project_id AND pm.user_id = ' + req.user.id : ''}
       WHERE ${where}`,
      params
    );

    return res.json({ campaigns: rows, total: countResult[0].total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error('Ads list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── GET ONE ─────────────────────────────────────────────────────────────────
exports.getOne = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT ac.*,
              p.title AS project_title, l.business_name AS client_name,
              CONCAT(ua.first_name, ' ', ua.last_name) AS assigned_to_name,
              CONCAT(uc.first_name, ' ', uc.last_name) AS created_by_name
       FROM ad_campaigns ac
       LEFT JOIN projects p ON p.id = ac.project_id
       LEFT JOIN leads l ON l.id = p.client_id
       LEFT JOIN users ua ON ua.id = ac.assigned_to
       LEFT JOIN users uc ON uc.id = ac.created_by
       WHERE ac.id = ? AND ac.deleted = 0`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Campaign not found' });

    const campaign = rows[0];

    // Fetch report if exists
    const [report] = await db.query('SELECT * FROM ad_campaign_reports WHERE campaign_id = ?', [campaign.id]);
    campaign.report = report[0] || null;

    return res.json(campaign);
  } catch (err) {
    console.error('Ads getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── CREATE ──────────────────────────────────────────────────────────────────
exports.create = async (req, res) => {
  try {
    const {
      project_id, campaign_name, platform, objective, budget,
      start_date, end_date, assignment_type, assigned_to, notes,
      linked_calendar_ad_id, status,
    } = req.body;

    if (!project_id || !campaign_name) {
      return res.status(400).json({ message: 'Project and campaign name are required' });
    }

    const slotIdVal = linked_calendar_ad_id ? parseInt(linked_calendar_ad_id) : null;
    const initStatus = status || 'pending_approval';

    // Generate campaign_id_code: ADS-CLIENT-###
    let clientCode = 'GEN';
    try {
      if (project_id) {
        const [projRows] = await db.query('SELECT client_id FROM projects WHERE id = ?', [project_id]);
        if (projRows.length > 0 && projRows[0].client_id) {
          const [clientRows] = await db.query('SELECT client_code FROM leads WHERE id = ?', [projRows[0].client_id]);
          if (clientRows.length > 0 && clientRows[0].client_code) clientCode = clientRows[0].client_code;
        }
      }
    } catch (e) { /* use GEN */ }
    const [lastAd] = await db.query(
      `SELECT campaign_id_code FROM ad_campaigns WHERE campaign_id_code LIKE ? ORDER BY id DESC LIMIT 1`,
      [`ADS-${clientCode}-%`]
    ).catch(() => [[]]);
    let adSeq = 1;
    if (lastAd.length > 0 && lastAd[0]?.campaign_id_code) {
      const parts = lastAd[0].campaign_id_code.split('-');
      adSeq = parseInt(parts[parts.length - 1], 10) + 1;
    }
    const campaign_id_code = `ADS-${clientCode}-${String(adSeq).padStart(3, '0')}`;

    // Try with calendar_slot_id — fall back without it
    let insertId;
    try {
      const [result] = await db.query(
        `INSERT INTO ad_campaigns 
          (campaign_id_code, project_id, campaign_name, platform, objective, budget, start_date, end_date,
           assignment_type, assigned_to, notes, linked_calendar_ad_id, calendar_slot_id, status, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          campaign_id_code,
          project_id, campaign_name, platform || null, objective || null,
          budget || null, start_date || null, end_date || null,
          assignment_type || 'self', assigned_to || null, notes || null,
          slotIdVal, slotIdVal, initStatus, req.user.id,
        ]
      );
      insertId = result.insertId;
    } catch (insertErr) {
      if (insertErr.code === 'ER_BAD_FIELD_ERROR' ||
          insertErr.errno === 1054 ||
          String(insertErr.message).includes('calendar_slot_id') ||
          String(insertErr.sqlMessage || '').includes('calendar_slot_id')) {
        const [result] = await db.query(
          `INSERT INTO ad_campaigns 
            (project_id, campaign_name, platform, objective, budget, start_date, end_date,
             assignment_type, assigned_to, notes, linked_calendar_ad_id, status, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            project_id, campaign_name, platform || null, objective || null,
            budget || null, start_date || null, end_date || null,
            assignment_type || 'self', assigned_to || null, notes || null,
            slotIdVal, initStatus, req.user.id,
          ]
        );
        insertId = result.insertId;
        // Try to update the id_code separately
        try {
          await db.query('UPDATE ad_campaigns SET campaign_id_code = ? WHERE id = ?', [campaign_id_code, insertId]);
        } catch (e) { /* column may not exist yet */ }
      } else {
        throw insertErr;
      }
    }

    // Sync slot to submitted and auto-sync filled dates/budget
    if (slotIdVal) {
      try {
        await db.query(
          `UPDATE content_calendar_ads 
           SET linked_campaign_id = ?, 
               slot_status = 'submitted', 
               submitted_at = NOW(), 
               rejection_reason = NULL,
               start_date = COALESCE(?, start_date),
               end_date = COALESCE(?, end_date),
               budget = COALESCE(?, budget),
               platform = COALESCE(?, platform),
               campaign_objective = COALESCE(?, campaign_objective)
           WHERE id = ?`,
          [insertId, start_date || null, end_date || null, budget || null, platform || null, objective || null, slotIdVal]
        );
        res.emitSocket('content-calendar:slot-submitted', { item_type: 'ad', item_id: slotIdVal });
        res.emitSocket('content-calendar:updated', { slot_id: slotIdVal });

        const [slotInfo] = await db.query('SELECT assigned_by FROM content_calendar_ads WHERE id = ?', [slotIdVal]);
        if (slotInfo.length > 0 && slotInfo[0].assigned_by) {
          await db.query(
            `INSERT INTO smm_notifications (user_id, triggered_by, type, slot_type, slot_id, title, message, link)
             VALUES (?, ?, 'slot_submitted', 'ad', ?, 'Ad slot submitted for approval', 'Campaign details filled. Please review.', '/social/content-calendar')`,
            [slotInfo[0].assigned_by, req.user.id, slotIdVal]
          );
          res.emitSocket('smm:notification', { user_id: slotInfo[0].assigned_by, type: 'slot_submitted' });
        }
      } catch (slotErr) {
        console.warn('Ad slot sync warning:', slotErr.message);
      }
    }

    const [campaign] = await db.query(`
      SELECT ac.*, p.title AS project_title,
             CONCAT(ua.first_name, ' ', ua.last_name) AS assigned_to_name,
             CONCAT(uc.first_name, ' ', uc.last_name) AS created_by_name
      FROM ad_campaigns ac
      LEFT JOIN projects p ON p.id = ac.project_id
      LEFT JOIN users ua ON ua.id = ac.assigned_to
      LEFT JOIN users uc ON uc.id = ac.created_by
      WHERE ac.id = ?`, [insertId]);

    res.emitSocket('ads:created', campaign[0]);

    // Log submit to history
    try {
      await db.query(
        `INSERT INTO smm_approval_history (module, record_id, action, remarks, acted_by) VALUES (?, ?, ?, ?, ?)`,
        ['ads', insertId, 'submit', null, req.user.id]
      );
    } catch (e) { /* table may not exist */ }

    return res.status(201).json(campaign[0]);
  } catch (err) {
    console.error('Ads create error:', err);
    return res.status(500).json({ message: 'Server error', detail: err.message });
  }
};

// ─── UPDATE ──────────────────────────────────────────────────────────────────
exports.update = async (req, res) => {
  try {
    const [existing] = await db.query('SELECT * FROM ad_campaigns WHERE id = ? AND deleted = 0', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ message: 'Campaign not found' });

    if (!req.user.is_admin && existing[0].created_by !== req.user.id && existing[0].assigned_to !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const campaign = existing[0];

    // Non-admin re-editing after rejection/approval → reset to pending_approval
    // Admin can set any status directly — don't override
    if (!req.user.is_admin && ['rejected', 'approved', 'active'].includes(campaign.status)) {
      req.body.status = 'pending_approval';
    }

    const allowed = ['campaign_name', 'platform', 'objective', 'budget', 'start_date', 'end_date', 'assignment_type', 'assigned_to', 'status', 'notes'];
    const updates = {};
    allowed.forEach(f => {
      if (req.body[f] !== undefined) {
        const val = req.body[f];
        // Only null out empty strings for non-text fields; keep notes/campaign_name as-is
        updates[f] = (val === '' || val === null) ? null : val;
      }
    });

    if (Object.keys(updates).length > 0) {
      const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
      await db.query(`UPDATE ad_campaigns SET ${setClauses} WHERE id = ?`, [...Object.values(updates), req.params.id]);
    }

    // ─── Sync to calendar slot when status changes ────────────────────────────
    // Use linked_calendar_ad_id or calendar_slot_id as the slot reference
    const slotId = campaign.linked_calendar_ad_id || campaign.calendar_slot_id;
    if (slotId) {
      // Auto-sync dates and details to calendar slot if updated in ad campaign
      const slotSyncUpdates = [];
      const slotSyncParams = [];
      if (updates.start_date !== undefined) { slotSyncUpdates.push('start_date = ?'); slotSyncParams.push(updates.start_date); }
      if (updates.end_date !== undefined) { slotSyncUpdates.push('end_date = ?'); slotSyncParams.push(updates.end_date); }
      if (updates.budget !== undefined) { slotSyncUpdates.push('budget = ?'); slotSyncParams.push(updates.budget); }
      if (updates.platform !== undefined) { slotSyncUpdates.push('platform = ?'); slotSyncParams.push(updates.platform); }
      if (updates.objective !== undefined) { slotSyncUpdates.push('campaign_objective = ?'); slotSyncParams.push(updates.objective); }
      if (slotSyncUpdates.length > 0) {
        try {
          await db.query(`UPDATE content_calendar_ads SET ${slotSyncUpdates.join(', ')} WHERE id = ?`, [...slotSyncParams, slotId]);
        } catch (e) { /* ignore */ }
      }

      if (updates.status) {
        // Log approval history
        try {
          const histAction = updates.status === 'approved' || updates.status === 'active' ? 'approve'
            : updates.status === 'rejected' ? 'rework'
            : updates.status === 'pending_approval' ? 'resubmit'
            : updates.status === 'completed' ? 'complete'
            : null;
          if (histAction) {
            await db.query(
              `INSERT INTO smm_approval_history (module, record_id, action, remarks, acted_by) VALUES (?, ?, ?, ?, ?)`,
              ['ads', req.params.id, histAction, updates.notes || null, req.user.id]
            );
          }
        } catch (e) { /* table may not exist */ }

        if (updates.status === 'pending_approval') {
          await db.query(
            `UPDATE content_calendar_ads SET slot_status = 'submitted', submitted_at = NOW(), rejection_reason = NULL WHERE id = ?`,
            [slotId]
          );
          res.emitSocket('content-calendar:slot-submitted', { item_type: 'ad', item_id: slotId });

          const [slotInfo] = await db.query('SELECT assigned_by FROM content_calendar_ads WHERE id = ?', [slotId]);
          if (slotInfo.length > 0 && slotInfo[0].assigned_by) {
            await db.query(
              `INSERT INTO smm_notifications (user_id, triggered_by, type, slot_type, slot_id, title, message, link)
               VALUES (?, ?, 'slot_submitted', 'ad', ?, 'Ad slot submitted for approval', 'Campaign details filled. Please review.', '/social/content-calendar')`,
              [slotInfo[0].assigned_by, req.user.id, slotId]
            );
            res.emitSocket('smm:notification', { user_id: slotInfo[0].assigned_by, type: 'slot_submitted' });
          }
        } else if (updates.status === 'approved' || updates.status === 'active') {
          await db.query(
            `UPDATE content_calendar_ads SET slot_status = 'approved', approved_at = NOW(), approved_by = ?, rejection_reason = NULL WHERE id = ?`,
            [req.user.id, slotId]
          );
          if (campaign.created_by) {
            await db.query(
              `INSERT INTO smm_notifications (user_id, triggered_by, type, slot_type, slot_id, title, message, link)
               VALUES (?, ?, 'slot_approved', 'ad', ?, 'Your ad slot was approved! 🎉', 'Campaign is now live.', '/social/ads-planning')`,
              [campaign.created_by, req.user.id, slotId]
            );
            res.emitSocket('smm:notification', { user_id: campaign.created_by, type: 'slot_approved' });
          }
        } else if (updates.status === 'completed') {
          await db.query(
            `UPDATE content_calendar_ads SET slot_status = 'completed', completed_at = NOW(), completed_by = ? WHERE id = ?`,
            [req.user.id, slotId]
          );
          res.emitSocket('content-calendar:slot-completed', { item_type: 'ad', item_id: slotId });
        } else if (updates.status === 'rejected') {
          await db.query(
            `UPDATE content_calendar_ads SET slot_status = 'rejected', rejection_reason = ?, approved_at = NULL, approved_by = NULL WHERE id = ?`,
            [updates.notes || 'Rejected', slotId]
          );
          if (campaign.created_by) {
            await db.query(
              `INSERT INTO smm_notifications (user_id, triggered_by, type, slot_type, slot_id, title, message, link)
               VALUES (?, ?, 'slot_rejected', 'ad', ?, 'Your ad slot was rejected', ?, '/social/ads-planning')`,
              [campaign.created_by, req.user.id, slotId, `Reason: ${updates.notes || 'Please re-edit'}`]
            );
            res.emitSocket('smm:notification', { user_id: campaign.created_by, type: 'slot_rejected' });
          }
        }
        res.emitSocket('content-calendar:updated', { slot_id: slotId });
      }
    }

    const [updated] = await db.query('SELECT * FROM ad_campaigns WHERE id = ?', [req.params.id]);
    res.emitSocket('ads:updated', updated[0]);
    return res.json(updated[0]);
  } catch (err) {
    console.error('Ads update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── DELETE ──────────────────────────────────────────────────────────────────
exports.remove = async (req, res) => {
  try {
    const [existing] = await db.query('SELECT * FROM ad_campaigns WHERE id = ? AND deleted = 0', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ message: 'Campaign not found' });

    if (!req.user.is_admin && existing[0].created_by !== req.user.id) {
      return res.status(403).json({ message: 'Access denied' });
    }

    await db.query('UPDATE ad_campaigns SET deleted = 1 WHERE id = ?', [req.params.id]);
    res.emitSocket('ads:deleted', { id: parseInt(req.params.id) });
    return res.json({ message: 'Campaign deleted' });
  } catch (err) {
    console.error('Ads delete error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── SAVE POST-AD REPORT & CLOSE CAMPAIGN ────────────────────────────────────
exports.saveReport = async (req, res) => {
  try {
    const campaignId = req.params.id;
    const [campaign] = await db.query('SELECT * FROM ad_campaigns WHERE id = ? AND deleted = 0', [campaignId]);
    if (campaign.length === 0) return res.status(404).json({ message: 'Campaign not found' });

    const {
      reach, impressions, clicks, ctr, cpc, cpl, leads, conversions,
      amount_spent, amount, report, recommendations, best_performing_ad,
      close_campaign, mark_completed
    } = req.body;

    const spentVal = (amount_spent !== undefined && amount_spent !== '') ? amount_spent
      : ((amount !== undefined && amount !== '') ? amount : null);
    const reportText = report || recommendations || best_performing_ad || null;

    const [existing] = await db.query('SELECT id FROM ad_campaign_reports WHERE campaign_id = ?', [campaignId]);

    if (existing.length > 0) {
      await db.query(
        `UPDATE ad_campaign_reports 
         SET reach=?, impressions=?, clicks=?, ctr=?, cpc=?, cpl=?, leads=?, conversions=?, 
             amount_spent=COALESCE(?, amount_spent), best_performing_ad=COALESCE(?, best_performing_ad), recommendations=COALESCE(?, recommendations) 
         WHERE campaign_id=?`,
        [reach||0, impressions||0, clicks||0, ctr||null, cpc||null, cpl||null, leads||0, conversions||0, spentVal, best_performing_ad||null, reportText, campaignId]
      );
    } else {
      await db.query(
        `INSERT INTO ad_campaign_reports (campaign_id, reach, impressions, clicks, ctr, cpc, cpl, leads, conversions, amount_spent, best_performing_ad, recommendations, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [campaignId, reach||0, impressions||0, clicks||0, ctr||null, cpc||null, cpl||null, leads||0, conversions||0, spentVal, best_performing_ad||null, reportText, req.user.id]
      );
    }

    const shouldClose = close_campaign === true || close_campaign === 'true' || mark_completed === true || mark_completed === 'true';
    if (shouldClose) {
      await db.query(`UPDATE ad_campaigns SET status = 'completed' WHERE id = ?`, [campaignId]);

      const slotId = campaign[0].linked_calendar_ad_id || campaign[0].calendar_slot_id;
      if (slotId) {
        try {
          await db.query(
            `UPDATE content_calendar_ads SET slot_status = 'completed', completed_at = NOW(), completed_by = ? WHERE id = ?`,
            [req.user.id, slotId]
          );
          try {
            await db.query(
              `UPDATE content_calendar_ads SET amount_spent = COALESCE(?, amount_spent), report_notes = COALESCE(?, report_notes) WHERE id = ?`,
              [spentVal, reportText, slotId]
            );
          } catch (e) { /* column may not exist */ }

          res.emitSocket('content-calendar:slot-completed', { item_type: 'ad', item_id: slotId });
          res.emitSocket('content-calendar:updated', { slot_id: slotId });
        } catch (slotErr) {
          console.warn('Ad slot close sync warning:', slotErr.message);
        }
      }
    }

    const [reportRow] = await db.query('SELECT * FROM ad_campaign_reports WHERE campaign_id = ?', [campaignId]);
    res.emitSocket('ads:report-saved', { campaign_id: campaignId, report: reportRow[0] });
    res.emitSocket('ads:updated', { id: parseInt(campaignId), status: shouldClose ? 'completed' : campaign[0].status });

    return res.json({
      message: shouldClose ? 'Ad Campaign closed and report saved' : 'Report saved',
      report: reportRow[0],
      status: shouldClose ? 'completed' : campaign[0].status
    });
  } catch (err) {
    console.error('Ads report save error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
