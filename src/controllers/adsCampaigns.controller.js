const db = require('../config/db');
const {
  statusOnApproval, activateStartedCampaigns, logAdsHistory, notify,
} = require('../helpers/adsWorkflow');

const canApproveCampaign = (req) => !!(req.user.is_admin || req.userCanAdsCampaignApprove);
const canApproveReport   = (req) => !!(req.user.is_admin || req.userCanAdsReportApprove);

/**
 * Mark a content_calendar_ads slot as completed.
 * completed_at / completed_by may not exist on older schemas — if they're
 * missing, fall back to updating slot_status only so the slot never stays
 * stuck at 'approved' after the campaign is closed.
 */
async function markAdSlotCompleted(slotId, userId) {
  try {
    await db.query(
      `UPDATE content_calendar_ads SET slot_status = 'completed', completed_at = NOW(), completed_by = ? WHERE id = ?`,
      [userId, slotId]
    );
  } catch (err) {
    if (err.code !== 'ER_BAD_FIELD_ERROR' && err.errno !== 1054) throw err;
    await db.query(`UPDATE content_calendar_ads SET slot_status = 'completed' WHERE id = ?`, [slotId]);
  }
}

/**
 * Can the current user modify (edit) this campaign?
 * Mirrors the visibility rules used in `list` so anything a user can see
 * and open for editing can also be saved.
 */
async function canModifyCampaign(req, campaign) {
  if (req.user.is_admin) return true;
  if (req.socialAccessLevel >= 2) return true;               // SMM lead — all campaigns
  if (req.userCanApprove || req.userCanSmmApprove) return true; // approvers act on any campaign
  if (req.userCanAdsCampaignApprove || req.userCanAdsReportApprove) return true;

  const uid = Number(req.user.id);
  if (Number(campaign.created_by) === uid) return true;
  if (campaign.assigned_to && Number(campaign.assigned_to) === uid) return true;

  // Project member (same rule as list visibility)
  if (campaign.project_id) {
    const [pm] = await db.query(
      'SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ? LIMIT 1',
      [campaign.project_id, uid]
    );
    if (pm.length > 0) return true;
  }

  // Person who assigned the linked calendar ad slot
  const slotId = campaign.linked_calendar_ad_id || campaign.calendar_slot_id;
  if (slotId) {
    try {
      const [slot] = await db.query('SELECT assigned_by FROM content_calendar_ads WHERE id = ?', [slotId]);
      if (slot.length > 0 && Number(slot[0].assigned_by) === uid) return true;
    } catch (e) { /* ignore */ }
  }
  return false;
}

// ─── LIST ────────────────────────────────────────────────────────────────────
exports.list = async (req, res) => {
  try {
    // Keep approved → active promotion current between cron runs (max once a minute)
    await activateStartedCampaigns({ minIntervalMs: 60 * 1000 });

    const { project_id, status, assigned_to, search } = req.query;
    const pageNum  = Math.max(1, parseInt(req.query.page) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(req.query.limit) || 20));
    const isAdmin  = !!req.user.is_admin;

    // Base filters (everything except status) — shared by list, count and summary,
    // so the status tab counts reflect the current search / project filter.
    let baseWhere = 'ac.deleted = 0';
    const baseParams = [];

    if (project_id) { baseWhere += ' AND ac.project_id = ?'; baseParams.push(project_id); }
    if (assigned_to) { baseWhere += ' AND ac.assigned_to = ?'; baseParams.push(assigned_to); }

    const term = typeof search === 'string' ? search.trim() : '';
    if (term) {
      const like = `%${term}%`;
      baseWhere += ` AND (ac.campaign_name LIKE ? OR ac.campaign_id_code LIKE ? OR ac.objective LIKE ?
                      OR ac.platform LIKE ? OR p.title LIKE ? OR l.business_name LIKE ?
                      OR CONCAT(ua.first_name, ' ', ua.last_name) LIKE ?)`;
      baseParams.push(like, like, like, like, like, like, like);
    }

    if (!isAdmin && !(req.socialAccessLevel >= 2)) {
      // Regular users: own, assigned, or project-member campaigns. SMM leads see all.
      baseWhere += ' AND (ac.created_by = ? OR ac.assigned_to = ? OR pm.user_id IS NOT NULL)';
      baseParams.push(req.user.id, req.user.id);
    }

    let where = baseWhere;
    const params = [...baseParams];
    if (status) { where += ' AND ac.status = ?'; params.push(status); }

    // Joins needed by filters (search + visibility). pm join is parameterised.
    const filterJoins = `
       LEFT JOIN projects p ON p.id = ac.project_id
       LEFT JOIN leads l ON l.id = p.client_id
       LEFT JOIN users ua ON ua.id = ac.assigned_to
       ${!isAdmin ? 'LEFT JOIN project_members pm ON pm.project_id = ac.project_id AND pm.user_id = ?' : ''}`;
    const joinParams = !isAdmin ? [req.user.id] : [];

    const offset = (pageNum - 1) * limitNum;

    const [rows] = await db.query(
      `SELECT ac.*,
              p.title AS project_title,
              l.business_name AS client_name,
              CONCAT(ua.first_name, ' ', ua.last_name) AS assigned_to_name,
              CONCAT(uc.first_name, ' ', uc.last_name) AS created_by_name,
              acr.amount_spent AS report_amount_spent,
              COALESCE(acr.recommendations, acr.best_performing_ad) AS report_notes,
              ca.slot_status AS slot_status
       FROM ad_campaigns ac
       ${filterJoins}
       LEFT JOIN users uc ON uc.id = ac.created_by
       LEFT JOIN ad_campaign_reports acr ON acr.campaign_id = ac.id
       LEFT JOIN content_calendar_ads ca ON (ca.id = ac.linked_calendar_ad_id OR ca.id = ac.calendar_slot_id)
       WHERE ${where}
       ORDER BY ac.created_at DESC
       LIMIT ? OFFSET ?`,
      [...joinParams, ...params, limitNum, offset]
    );

    const [countResult] = await db.query(
      `SELECT COUNT(DISTINCT ac.id) AS total FROM ad_campaigns ac ${filterJoins} WHERE ${where}`,
      [...joinParams, ...params]
    );

    // Summary over base filters (ignores status so tabs can show per-status counts)
    const [summaryRows] = await db.query(
      `SELECT ac.status, COUNT(*) AS count,
              COALESCE(SUM(ac.budget), 0) AS budget,
              COALESCE(SUM(acr.amount_spent), 0) AS spent
       FROM (SELECT DISTINCT ac.id, ac.status, ac.budget
             FROM ad_campaigns ac ${filterJoins}
             WHERE ${baseWhere}) ac
       LEFT JOIN ad_campaign_reports acr ON acr.campaign_id = ac.id
       GROUP BY ac.status`,
      [...joinParams, ...baseParams]
    );

    const summary = { total: 0, by_status: {}, total_budget: 0, total_spent: 0 };
    summaryRows.forEach(r => {
      const c = Number(r.count) || 0;
      summary.total += c;
      summary.by_status[r.status || 'unknown'] = c;
      summary.total_budget += Number(r.budget) || 0;
      summary.total_spent  += Number(r.spent)  || 0;
    });

    return res.json({
      campaigns: rows,
      total: Number(countResult[0].total) || 0,
      page: pageNum,
      limit: limitNum,
      summary,
    });
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
              CONCAT(uc.first_name, ' ', uc.last_name) AS created_by_name,
              ca.slot_status AS slot_status
       FROM ad_campaigns ac
       LEFT JOIN projects p ON p.id = ac.project_id
       LEFT JOIN leads l ON l.id = p.client_id
       LEFT JOIN users ua ON ua.id = ac.assigned_to
       LEFT JOIN users uc ON uc.id = ac.created_by
       LEFT JOIN content_calendar_ads ca ON (ca.id = ac.linked_calendar_ad_id OR ca.id = ac.calendar_slot_id)
       WHERE ac.id = ? AND ac.deleted = 0`,
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Campaign not found' });

    const campaign = rows[0];

    // Fetch report if exists
    const [report] = await db.query('SELECT * FROM ad_campaign_reports WHERE campaign_id = ?', [campaign.id]);
    campaign.report = report[0] || null;

    // Approval trail names (columns added by the ads workflow migration)
    try {
      const [names] = await db.query(
        `SELECT CONCAT(a.first_name, ' ', a.last_name) AS approved_by_name,
                CONCAT(s.first_name, ' ', s.last_name) AS report_submitted_by_name,
                CONCAT(r.first_name, ' ', r.last_name) AS report_reviewed_by_name
         FROM ad_campaigns ac
         LEFT JOIN users a ON a.id = ac.approved_by
         LEFT JOIN users s ON s.id = ac.report_submitted_by
         LEFT JOIN users r ON r.id = ac.report_reviewed_by
         WHERE ac.id = ?`,
        [campaign.id]
      );
      Object.assign(campaign, names[0] || {});
    } catch (e) { /* columns not migrated yet */ }

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

    if (!(await canModifyCampaign(req, existing[0]))) {
      return res.status(403).json({ message: 'You do not have permission to edit this campaign' });
    }

    const campaign = existing[0];
    const current = campaign.status;
    const isApprover = canApproveCampaign(req);
    const CLOSED = ['report_pending', 'completed'];

    // ─── Resolve the status transition (Stage 1: campaign approval) ──────────
    let requested = req.body.status;
    if (requested === '' || requested === null || requested === current) requested = undefined;
    delete req.body.status;
    let nextStatus;

    if (requested) {
      if (CLOSED.includes(requested)) {
        return res.status(400).json({ message: 'Use Close & Report to close a campaign. The report then goes for approval.' });
      }
      if (CLOSED.includes(current)) {
        return res.status(400).json({ message: 'This campaign is closed. Review the report instead.' });
      }
      if (['approved', 'active', 'rejected', 'paused'].includes(requested)) {
        if (!isApprover) {
          return res.status(403).json({ message: 'Only users with Ads Campaign Approval permission can approve, reject or pause campaigns' });
        }
        if (requested === 'rejected' && !['pending_approval', 'approved', 'active', 'paused'].includes(current)) {
          return res.status(400).json({ message: `Cannot reject a campaign that is "${current}"` });
        }
        if (requested === 'paused' && !['approved', 'active'].includes(current)) {
          return res.status(400).json({ message: 'Only approved or active campaigns can be paused' });
        }
      }
      nextStatus = requested;
      // Approving: go straight to 'active' if the start date has already arrived
      if (requested === 'approved') {
        nextStatus = statusOnApproval(req.body.start_date !== undefined ? req.body.start_date : campaign.start_date);
      }
    } else {
      // Plain edit (no status decision)
      if (CLOSED.includes(current) && !req.user.is_admin) {
        return res.status(400).json({ message: 'This campaign is closed and can no longer be edited' });
      }
      if (current === 'rejected') {
        nextStatus = 'pending_approval';                       // re-edit → resubmit
      } else if (['approved', 'active', 'paused'].includes(current) && !isApprover) {
        nextStatus = 'pending_approval';                       // changes need re-approval
      }
    }
    if (nextStatus && nextStatus !== current) req.body.status = nextStatus;

    // Approval/rework remarks come in a separate field so they don't overwrite campaign notes
    const remarks = req.body.remarks ?? null;

    const allowed = ['project_id', 'campaign_name', 'platform', 'objective', 'budget', 'start_date', 'end_date', 'assignment_type', 'assigned_to', 'status', 'notes'];
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

    // Record who approved / rejected (columns from the ads workflow migration)
    if (updates.status) {
      try {
        if (['approved', 'active'].includes(updates.status) && !['approved', 'active', 'paused'].includes(current)) {
          await db.query(
            'UPDATE ad_campaigns SET approved_by = ?, approved_at = NOW(), approval_remarks = ? WHERE id = ?',
            [req.user.id, remarks, req.params.id]
          );
        } else if (updates.status === 'rejected') {
          await db.query(
            'UPDATE ad_campaigns SET approved_by = NULL, approved_at = NULL, approval_remarks = ? WHERE id = ?',
            [remarks || 'Rejected', req.params.id]
          );
        } else if (updates.status === 'pending_approval') {
          await db.query('UPDATE ad_campaigns SET approval_remarks = NULL WHERE id = ?', [req.params.id]);
        }
      } catch (e) { /* columns not migrated yet */ }
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
              ['ads', req.params.id, histAction, remarks || null, req.user.id]
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
               VALUES (?, ?, 'slot_approved', 'ad', ?, 'Your ad slot was approved!', 'Campaign is now live.', '/social/ads')`,
              [campaign.created_by, req.user.id, slotId]
            );
            res.emitSocket('smm:notification', { user_id: campaign.created_by, type: 'slot_approved' });
          }
        } else if (updates.status === 'completed') {
          await markAdSlotCompleted(slotId, req.user.id);
          res.emitSocket('content-calendar:slot-completed', { item_type: 'ad', item_id: slotId });
        } else if (updates.status === 'rejected') {
          await db.query(
            `UPDATE content_calendar_ads SET slot_status = 'rejected', rejection_reason = ?, approved_at = NULL, approved_by = NULL WHERE id = ?`,
            [remarks || 'Rejected', slotId]
          );
          if (campaign.created_by) {
            await db.query(
              `INSERT INTO smm_notifications (user_id, triggered_by, type, slot_type, slot_id, title, message, link)
               VALUES (?, ?, 'slot_rejected', 'ad', ?, 'Your ad slot was rejected', ?, '/social/ads')`,
              [campaign.created_by, req.user.id, slotId, `Reason: ${remarks || 'Please re-edit'}`]
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

    if (!req.user.is_admin && req.socialAccessLevel < 2 && !req.userCanDelete && Number(existing[0].created_by) !== Number(req.user.id)) {
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


// ─── Report helpers ──────────────────────────────────────────────────────────

function parseReportBody(body) {
  const {
    reach, impressions, clicks, ctr, cpc, cpl, leads, conversions,
    amount_spent, amount, report, recommendations, best_performing_ad,
  } = body;
  const spentVal = (amount_spent !== undefined && amount_spent !== '') ? amount_spent
    : ((amount !== undefined && amount !== '') ? amount : null);
  const reportText = report || recommendations || null;
  return {
    metrics: [reach || 0, impressions || 0, clicks || 0, ctr || null, cpc || null, cpl || null, leads || 0, conversions || 0],
    spentVal,
    reportText,
    bestAd: best_performing_ad || null,
  };
}

async function upsertReport(campaignId, body, userId) {
  const { metrics, spentVal, reportText, bestAd } = parseReportBody(body);
  const [existing] = await db.query('SELECT id FROM ad_campaign_reports WHERE campaign_id = ?', [campaignId]);
  if (existing.length > 0) {
    await db.query(
      `UPDATE ad_campaign_reports
       SET reach=?, impressions=?, clicks=?, ctr=?, cpc=?, cpl=?, leads=?, conversions=?,
           amount_spent=COALESCE(?, amount_spent), best_performing_ad=COALESCE(?, best_performing_ad), recommendations=COALESCE(?, recommendations)
       WHERE campaign_id=?`,
      [...metrics, spentVal, bestAd, reportText, campaignId]
    );
  } else {
    await db.query(
      `INSERT INTO ad_campaign_reports (campaign_id, reach, impressions, clicks, ctr, cpc, cpl, leads, conversions, amount_spent, best_performing_ad, recommendations, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [campaignId, ...metrics, spentVal, bestAd, reportText, userId]
    );
  }
  const [rows] = await db.query('SELECT * FROM ad_campaign_reports WHERE campaign_id = ?', [campaignId]);
  return rows[0] || null;
}

/** Copy the final report onto the calendar slot and mark it completed. */
async function completeLinkedSlot(campaign, report, userId, res) {
  const slotId = campaign.linked_calendar_ad_id || campaign.calendar_slot_id;
  if (!slotId) return;
  try {
    await markAdSlotCompleted(slotId, userId);
    try {
      await db.query(
        `UPDATE content_calendar_ads SET amount_spent = COALESCE(?, amount_spent), report_notes = COALESCE(?, report_notes) WHERE id = ?`,
        [report?.amount_spent ?? null, report?.recommendations || report?.best_performing_ad || null, slotId]
      );
    } catch (e) { /* columns may not exist */ }
    res.emitSocket('content-calendar:slot-completed', { item_type: 'ad', item_id: slotId });
    res.emitSocket('content-calendar:updated', { slot_id: slotId });
  } catch (slotErr) {
    console.warn('Ad slot complete sync warning:', slotErr.message);
  }
}

async function slotAssigner(campaign) {
  const slotId = campaign.linked_calendar_ad_id || campaign.calendar_slot_id;
  if (!slotId) return null;
  try {
    const [rows] = await db.query('SELECT assigned_by FROM content_calendar_ads WHERE id = ?', [slotId]);
    return rows[0]?.assigned_by || null;
  } catch (e) { return null; }
}

// ─── SAVE REPORT / CLOSE & REPORT (Stage 2 submit) ───────────────────────────
// close_campaign / mark_completed = true  → submit the closing report for approval:
//   approved | active | paused | report_pending  →  report_pending
// An already-completed campaign's report can only be edited by a report approver.
exports.saveReport = async (req, res) => {
  try {
    const campaignId = req.params.id;
    const [rows] = await db.query('SELECT * FROM ad_campaigns WHERE id = ? AND deleted = 0', [campaignId]);
    if (rows.length === 0) return res.status(404).json({ message: 'Campaign not found' });
    const campaign = rows[0];

    if (!(await canModifyCampaign(req, campaign))) {
      return res.status(403).json({ message: 'You do not have permission to report on this campaign' });
    }

    const { close_campaign, mark_completed } = req.body;
    const wantsClose = [close_campaign, mark_completed].some(v => v === true || v === 'true');

    // Completed: report is final — only report approvers may correct it
    if (campaign.status === 'completed') {
      if (!canApproveReport(req)) {
        return res.status(403).json({ message: 'This report is already approved. Only Ads Report approvers can edit it.' });
      }
      const report = await upsertReport(campaignId, req.body, req.user.id);
      await completeLinkedSlot(campaign, report, req.user.id, res); // keep slot amounts in sync
      await logAdsHistory(campaignId, 'report_approve', 'Report edited after approval', req.user.id);
      res.emitSocket('ads:report-saved', { campaign_id: campaignId, report });
      res.emitSocket('ads:updated', { id: parseInt(campaignId), status: 'completed' });
      return res.json({ message: 'Report updated', report, status: 'completed' });
    }

    if (wantsClose && !['approved', 'active', 'paused', 'report_pending'].includes(campaign.status)) {
      return res.status(400).json({ message: 'The campaign must be approved before it can be closed' });
    }

    const report = await upsertReport(campaignId, req.body, req.user.id);

    if (!wantsClose) {
      res.emitSocket('ads:report-saved', { campaign_id: campaignId, report });
      return res.json({ message: 'Report saved', report, status: campaign.status });
    }

    // Submit for Stage 2 approval
    await db.query(`UPDATE ad_campaigns SET status = 'report_pending' WHERE id = ?`, [campaignId]);
    try {
      await db.query(
        `UPDATE ad_campaigns SET report_submitted_by = ?, report_submitted_at = NOW(),
                report_reviewed_by = NULL, report_reviewed_at = NULL, report_review_remarks = NULL
         WHERE id = ?`,
        [req.user.id, campaignId]
      );
    } catch (e) { /* columns not migrated yet */ }

    const resubmit = campaign.status === 'report_pending';
    await logAdsHistory(campaignId, 'report_submit', resubmit ? 'Report updated' : null, req.user.id);

    const assigner = await slotAssigner(campaign);
    if (assigner && Number(assigner) !== Number(req.user.id)) {
      await notify({
        user_id: assigner,
        triggered_by: req.user.id,
        type: 'ad_report_submitted',
        slot_id: campaign.linked_calendar_ad_id || campaign.calendar_slot_id,
        title: 'Ad closing report submitted',
        message: `${campaign.campaign_name}: closing report is waiting for approval.`,
      });
      res.emitSocket('smm:notification', { user_id: assigner, type: 'ad_report_submitted' });
    }

    res.emitSocket('ads:report-saved', { campaign_id: campaignId, report });
    res.emitSocket('ads:updated', { id: parseInt(campaignId), status: 'report_pending' });

    return res.json({
      message: 'Report submitted for approval',
      report,
      status: 'report_pending',
    });
  } catch (err) {
    console.error('Ads report save error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── REVIEW CLOSING REPORT (Stage 2 approval) ────────────────────────────────
// POST /api/ads-campaigns/:id/report/review   { action: 'approve' | 'reject', remarks }
//   approve → campaign 'completed', calendar slot 'completed'
//   reject  → campaign back to 'active' (or 'approved' if not started) with remarks
exports.reviewReport = async (req, res) => {
  try {
    if (!canApproveReport(req)) {
      return res.status(403).json({ message: 'Only users with Ads Report Approval permission can review closing reports' });
    }

    const campaignId = req.params.id;
    const { action, remarks } = req.body;
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ message: "action must be 'approve' or 'reject'" });
    }
    const note = typeof remarks === 'string' ? remarks.trim() : '';
    if (action === 'reject' && !note) {
      return res.status(400).json({ message: 'Please give a reason for sending the report back' });
    }

    const [rows] = await db.query('SELECT * FROM ad_campaigns WHERE id = ? AND deleted = 0', [campaignId]);
    if (rows.length === 0) return res.status(404).json({ message: 'Campaign not found' });
    const campaign = rows[0];

    if (campaign.status !== 'report_pending') {
      return res.status(400).json({ message: `Only reports pending approval can be reviewed. Current status: "${campaign.status}"` });
    }

    const [repRows] = await db.query('SELECT * FROM ad_campaign_reports WHERE campaign_id = ?', [campaignId]);
    const report = repRows[0] || null;

    let newStatus;
    if (action === 'approve') {
      newStatus = 'completed';
      await db.query(`UPDATE ad_campaigns SET status = 'completed' WHERE id = ?`, [campaignId]);
      await completeLinkedSlot(campaign, report, req.user.id, res);
    } else {
      newStatus = statusOnApproval(campaign.start_date); // back to running so it can be re-closed
      await db.query('UPDATE ad_campaigns SET status = ? WHERE id = ?', [newStatus, campaignId]);
    }

    try {
      await db.query(
        `UPDATE ad_campaigns SET report_reviewed_by = ?, report_reviewed_at = NOW(), report_review_remarks = ? WHERE id = ?`,
        [req.user.id, note || null, campaignId]
      );
    } catch (e) { /* columns not migrated yet */ }

    await logAdsHistory(campaignId, action === 'approve' ? 'report_approve' : 'report_reject', note || null, req.user.id);

    // Notify whoever submitted the report (fallback: campaign creator)
    const submitter = campaign.report_submitted_by || campaign.created_by;
    if (submitter && Number(submitter) !== Number(req.user.id)) {
      await notify({
        user_id: submitter,
        triggered_by: req.user.id,
        type: action === 'approve' ? 'ad_report_approved' : 'ad_report_rejected',
        slot_id: campaign.linked_calendar_ad_id || campaign.calendar_slot_id,
        title: action === 'approve' ? 'Ad closing report approved' : 'Ad closing report sent back',
        message: action === 'approve'
          ? `${campaign.campaign_name} is now completed.`
          : `${campaign.campaign_name}: ${note}. Please update the report and resubmit.`,
      });
      res.emitSocket('smm:notification', { user_id: submitter, type: action === 'approve' ? 'ad_report_approved' : 'ad_report_rejected' });
    }

    res.emitSocket('ads:updated', { id: parseInt(campaignId), status: newStatus });
    return res.json({
      message: action === 'approve' ? 'Report approved. Campaign completed.' : 'Report sent back for changes',
      status: newStatus,
    });
  } catch (err) {
    console.error('Ads report review error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
