const db = require('../config/db');

// ═══════════════════════════════════════════════════════════════════════════════
// Content Calendar - Simplified Slot Workflow
// Flow: Book → Assign → Notify → Fill on respective page → Approve/Reject → Complete
// ═══════════════════════════════════════════════════════════════════════════════

const TABLE_MAP = {
  post: 'content_calendar_posts',
  shoot: 'content_calendar_shoots',
  ad: 'content_calendar_ads',
};

// ─── Helper: Create SMM Notification ──────────────────────────────────────────
async function createSmmNotification(conn, { user_id, triggered_by, type, slot_type, slot_id, linked_item_type, linked_item_id, title, message, link }) {
  await (conn || db).query(
    `INSERT INTO smm_notifications (user_id, triggered_by, type, slot_type, slot_id, linked_item_type, linked_item_id, title, message, link)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [user_id, triggered_by, type, slot_type, slot_id, linked_item_type || null, linked_item_id || null, title, message || null, link || null]
  );
}

// ─── Helper: Get link for slot type ───────────────────────────────────────────
function getPageLink(slot_type) {
  if (slot_type === 'post') return '/social/write-content';
  if (slot_type === 'shoot') return '/social/shoots';
  if (slot_type === 'ad') return '/social/ads-planning';
  return '/social/content-calendar';
}

// ─── LIST SLOTS ───────────────────────────────────────────────────────────────

exports.listSlots = async (req, res) => {
  try {
    const { project_id, cycle_id, slot_status, item_type, assigned_to_me, client_id } = req.query;
    const userId = req.user.id;

    let planWhere = 'p.deleted = 0';
    const planParams = [];

    if (project_id) { planWhere += ' AND p.project_id = ?'; planParams.push(project_id); }
    if (cycle_id) { planWhere += ' AND p.cycle_id = ?'; planParams.push(cycle_id); }
    if (client_id) { planWhere += ' AND p.client_id = ?'; planParams.push(client_id); }

    const [plans] = await db.query(
      `SELECT p.id, p.project_id, p.cycle_id, p.plan_month, p.client_id,
              pr.title AS project_title, l.business_name AS client_name
       FROM content_calendar_plans p
       LEFT JOIN projects pr ON pr.id = p.project_id
       LEFT JOIN leads l ON l.id = p.client_id
       WHERE ${planWhere}`,
      planParams
    );

    if (plans.length === 0) return res.json({ posts: [], shoots: [], ads: [], plans: [] });

    const planIds = plans.map(p => p.id);
    const planMap = {};
    plans.forEach(p => { planMap[p.id] = p; });

    let statusFilter = '';
    const statusParams = [];
    if (slot_status) {
      // Map frontend 'pending_approval' to the actual DB value 'submitted'
      const mappedStatus = slot_status === 'pending_approval' ? 'submitted' : slot_status;
      statusFilter = ' AND slot_status = ?';
      statusParams.push(mappedStatus);
    }

    let assignedFilter = '';
    const assignedParams = [];
    if (assigned_to_me === 'true') {
      assignedFilter = ' AND assigned_to = ?';
      assignedParams.push(userId);
    }

    // Fetch posts
    let posts = [];
    if (!item_type || item_type === 'post') {
      const [rows] = await db.query(
        `SELECT cp.*,
                CONCAT(u.first_name, ' ', u.last_name) AS assigned_to_name,
                CONCAT(ab.first_name, ' ', ab.last_name) AS assigned_by_name,
                CONCAT(au.first_name, ' ', au.last_name) AS approved_by_name
         FROM content_calendar_posts cp
         LEFT JOIN users u ON u.id = cp.assigned_to
         LEFT JOIN users ab ON ab.id = cp.assigned_by
         LEFT JOIN users au ON au.id = cp.approved_by
         WHERE cp.plan_id IN (?) ${statusFilter} ${assignedFilter}
         ORDER BY cp.posting_date ASC, cp.id ASC`,
        [planIds, ...statusParams, ...assignedParams]
      );
      posts = rows.map(r => ({ ...r, _plan: planMap[r.plan_id], _type: 'post' }));
    }

    // Fetch shoots
    let shoots = [];
    if (!item_type || item_type === 'shoot') {
      const [rows] = await db.query(
        `SELECT cs.*,
                CONCAT(u.first_name, ' ', u.last_name) AS assigned_to_name,
                CONCAT(ab.first_name, ' ', ab.last_name) AS assigned_by_name,
                CONCAT(au.first_name, ' ', au.last_name) AS approved_by_name
         FROM content_calendar_shoots cs
         LEFT JOIN users u ON u.id = cs.assigned_to
         LEFT JOIN users ab ON ab.id = cs.assigned_by
         LEFT JOIN users au ON au.id = cs.approved_by
         WHERE cs.plan_id IN (?) ${statusFilter} ${assignedFilter}
         ORDER BY cs.shoot_date ASC, cs.id ASC`,
        [planIds, ...statusParams, ...assignedParams]
      );
      shoots = rows.map(r => ({ ...r, _plan: planMap[r.plan_id], _type: 'shoot' }));
    }

    // Fetch ads
    let ads = [];
    if (!item_type || item_type === 'ad') {
      const [rows] = await db.query(
        `SELECT ca.*,
                CONCAT(u.first_name, ' ', u.last_name) AS assigned_to_name,
                CONCAT(ab.first_name, ' ', ab.last_name) AS assigned_by_name,
                CONCAT(au.first_name, ' ', au.last_name) AS approved_by_name
         FROM content_calendar_ads ca
         LEFT JOIN users u ON u.id = ca.assigned_to
         LEFT JOIN users ab ON ab.id = ca.assigned_by
         LEFT JOIN users au ON au.id = ca.approved_by
         WHERE ca.plan_id IN (?) ${statusFilter} ${assignedFilter}
         ORDER BY ca.start_date ASC, ca.id ASC`,
        [planIds, ...statusParams, ...assignedParams]
      );
      ads = rows.map(r => ({ ...r, _plan: planMap[r.plan_id], _type: 'ad' }));
    }

    return res.json({ posts, shoots, ads, plans });
  } catch (err) {
    console.error('List slots error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── ASSIGN SLOT (Admin or SMM role) ──────────────────────────────────────────
// Books + assigns a slot in one step. Auto-creates the linked item on the
// respective page (Write Content / Shoots / Ads) and notifies the assignee.

exports.assignSlot = async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const { item_type, item_id, assigned_to, plan_id, slot_date, create_new } = req.body;
    const assignerId = req.user.id;

    if (!item_type || !assigned_to) {
      await conn.rollback(); conn.release();
      return res.status(400).json({ message: 'item_type and assigned_to are required' });
    }

    const table = TABLE_MAP[item_type];
    if (!table) {
      await conn.rollback(); conn.release();
      return res.status(400).json({ message: 'Invalid item_type. Must be post, shoot, or ad' });
    }

    let slotId = item_id;

    // If assigning an existing open slot
    if (item_id && !create_new) {
      const [rows] = await conn.query(`SELECT * FROM ${table} WHERE id = ?`, [item_id]);
      if (rows.length === 0) { await conn.rollback(); conn.release(); return res.status(404).json({ message: 'Slot not found' }); }
      if (rows[0].slot_status !== 'open') {
        await conn.rollback(); conn.release();
        return res.status(400).json({ message: `Slot is already ${rows[0].slot_status}` });
      }
    }

    // Update slot: set assigned_to, assigned_by, slot_status = 'assigned'
    await conn.query(
      `UPDATE ${table} SET assigned_to = ?, assigned_by = ?, slot_status = 'assigned' WHERE id = ?`,
      [assigned_to, assignerId, slotId]
    );

    // Auto-create linked item on respective page
    let linkedItemId = null;
    let linkedItemType = null;

    if (item_type === 'post') {
      linkedItemType = 'content_write';
      // Get plan's client_id, project_id, and post's format/platform
      const [planInfo] = await conn.query(
        `SELECT p.client_id, p.project_id, cp.format, cp.platform AS post_platform
         FROM content_calendar_plans p
         JOIN ${table} cp ON cp.plan_id = p.id WHERE cp.id = ?`, [slotId]
      );
      const clientId = planInfo[0]?.client_id || null;
      const projectId = planInfo[0]?.project_id || null;
      const postFormat = planInfo[0]?.format || 'static_post';
      const postPlatform = planInfo[0]?.post_platform || 'Instagram';

      // Generate content_id_code
      let clientCode = 'GEN';
      if (clientId) {
        const [cRows] = await conn.query('SELECT client_code FROM leads WHERE id = ?', [clientId]);
        if (cRows.length > 0 && cRows[0].client_code) clientCode = cRows[0].client_code;
      }
      const [lastCnt] = await conn.query(
        `SELECT content_id_code FROM content_write_requests WHERE content_id_code LIKE ? ORDER BY id DESC LIMIT 1`,
        [`CNT-${clientCode}-%`]
      );
      let seq = 1;
      if (lastCnt.length > 0 && lastCnt[0].content_id_code) {
        const parts = lastCnt[0].content_id_code.split('-');
        seq = parseInt(parts[parts.length - 1], 10) + 1;
      }
      const contentCode = `CNT-${clientCode}-${String(seq).padStart(3, '0')}`;

      const [writeResult] = await conn.query(
        `INSERT INTO content_write_requests (content_id_code, client_brand_id, project_id, platform, content_type, status, created_by, calendar_slot_id)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
        [contentCode, clientId, projectId, postPlatform, postFormat, assigned_to, slotId]
      );
      linkedItemId = writeResult.insertId;

      // Link back
      await conn.query(`UPDATE ${table} SET linked_write_id = ? WHERE id = ?`, [linkedItemId, slotId]);
    }

    if (item_type === 'shoot') {
      linkedItemType = 'shoots';
      const [planInfo] = await conn.query(
        `SELECT p.client_id FROM content_calendar_plans p
         JOIN ${table} cs ON cs.plan_id = p.id WHERE cs.id = ?`, [slotId]
      );
      const clientId = planInfo[0]?.client_id || null;

      // Generate shoot_id_code
      const now = new Date();
      const yy = String(now.getFullYear()).slice(-2);
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      let clientCode = 'GEN';
      if (clientId) {
        const [cRows] = await conn.query('SELECT client_code FROM leads WHERE id = ?', [clientId]);
        if (cRows.length > 0 && cRows[0].client_code) clientCode = cRows[0].client_code;
      }
      const shootPrefix = `SHT-${yy}${mm}${dd}-${clientCode}`;
      const [lastSht] = await conn.query(
        `SELECT shoot_id_code FROM shoots WHERE shoot_id_code LIKE ? ORDER BY id DESC LIMIT 1`,
        [`${shootPrefix}-%`]
      );
      let seq = 1;
      if (lastSht.length > 0 && lastSht[0].shoot_id_code) {
        const parts = lastSht[0].shoot_id_code.split('-');
        seq = parseInt(parts[parts.length - 1], 10) + 1;
      }
      const shootCode = `${shootPrefix}-${String(seq).padStart(3, '0')}`;

      // Get slot's shoot_date
      const [slotRow] = await conn.query(`SELECT shoot_date FROM ${table} WHERE id = ?`, [slotId]);
      const shootDate = slotRow[0]?.shoot_date || now.toISOString().split('T')[0];

      const [shootResult] = await conn.query(
        `INSERT INTO shoots (shoot_id_code, client_brand_id, project_campaign_name, shoot_date, reporting_time, location_type, status, created_by, calendar_slot_id)
         VALUES (?, ?, 'TBD', ?, '09:00', 'office', 'pending_approval', ?, ?)`,
        [shootCode, clientId, shootDate, assigned_to, slotId]
      );
      linkedItemId = shootResult.insertId;

      await conn.query(`UPDATE ${table} SET linked_shoot_ref_id = ? WHERE id = ?`, [linkedItemId, slotId]);
    }

    if (item_type === 'ad') {
      linkedItemType = 'ads';
      const [planInfo] = await conn.query(
        `SELECT p.client_id, p.project_id FROM content_calendar_plans p
         JOIN ${table} ca ON ca.plan_id = p.id WHERE ca.id = ?`, [slotId]
      );
      const clientId = planInfo[0]?.client_id || null;
      const projectId = planInfo[0]?.project_id || null;

      // Need a project to create campaign - use plan's project
      let resolvedProjectId = projectId;
      if (!resolvedProjectId && clientId) {
        const [projRows] = await conn.query(
          'SELECT id FROM projects WHERE client_id = ? AND deleted = 0 ORDER BY id DESC LIMIT 1', [clientId]
        );
        if (projRows.length > 0) resolvedProjectId = projRows[0].id;
      }

      if (resolvedProjectId) {
        const [adResult] = await conn.query(
          `INSERT INTO ad_campaigns (project_id, campaign_name, status, created_by, calendar_slot_id)
           VALUES (?, 'TBD', 'draft', ?, ?)`,
          [resolvedProjectId, assigned_to, slotId]
        );
        linkedItemId = adResult.insertId;
        await conn.query(`UPDATE ${table} SET linked_campaign_ref_id = ? WHERE id = ?`, [linkedItemId, slotId]);
      }
    }

    // Create notification for assignee
    const link = getPageLink(item_type);
    await createSmmNotification(conn, {
      user_id: assigned_to,
      triggered_by: assignerId,
      type: 'slot_assigned',
      slot_type: item_type,
      slot_id: slotId,
      linked_item_type: linkedItemType,
      linked_item_id: linkedItemId,
      title: `New ${item_type} slot assigned to you`,
      message: `You have been assigned a ${item_type} slot. Please fill in the details.`,
      link,
    });

    await conn.commit();
    conn.release();

    res.emitSocket('content-calendar:slot-assigned', { item_type, item_id: slotId, assigned_to, assigned_by: assignerId });
    res.emitSocket('smm:notification', { user_id: assigned_to, type: 'slot_assigned' });

    return res.json({ message: 'Slot assigned successfully', item_type, item_id: slotId, linked_item_id: linkedItemId });
  } catch (err) {
    await conn.rollback();
    conn.release();
    console.error('Assign slot error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── FILL SLOT (updates content fields + submits for approval) ────────────────
// Called from FillSlotModal on the Content Calendar page.
// Accepts content fields (platform, topic, format, etc.) and sets slot_status to 'submitted'.

exports.fillSlot = async (req, res) => {
  try {
    const { item_type, item_id, ...fields } = req.body;
    const userId = req.user.id;

    if (!item_type || !item_id) {
      return res.status(400).json({ message: 'item_type and item_id are required' });
    }

    const table = TABLE_MAP[item_type];
    if (!table) return res.status(400).json({ message: 'Invalid item_type' });

    const [rows] = await db.query(`SELECT * FROM ${table} WHERE id = ?`, [item_id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Slot not found' });

    const slot = rows[0];

    if (!['assigned', 'rejected'].includes(slot.slot_status)) {
      return res.status(400).json({ message: `Cannot fill a slot with status "${slot.slot_status}". Must be assigned or rejected.` });
    }

    // Build dynamic SET clause from allowed fields based on item_type
    const allowedFields = {
      post: ['platform', 'format', 'topic', 'posting_date', 'cta', 'ad_target'],
      shoot: ['shoot_date', 'location', 'description', 'num_videos', 'num_photos', 'talent', 'production_notes'],
      ad: ['creative_name', 'campaign_objective', 'platform', 'target_audience', 'budget', 'start_date', 'end_date', 'expected_outcomes'],
    };

    const allowed = allowedFields[item_type] || [];
    const setClauses = [];
    const setValues = [];

    for (const key of allowed) {
      if (fields[key] !== undefined) {
        setClauses.push(`${key} = ?`);
        setValues.push(fields[key] === '' ? null : fields[key]);
      }
    }

    // Always set slot_status to submitted
    setClauses.push("slot_status = 'submitted'");
    setClauses.push("submitted_at = NOW()");
    setClauses.push("rejection_reason = NULL");

    await db.query(
      `UPDATE ${table} SET ${setClauses.join(', ')} WHERE id = ?`,
      [...setValues, item_id]
    );

    // Notify the assigner that work was submitted
    if (slot.assigned_by) {
      await createSmmNotification(null, {
        user_id: slot.assigned_by,
        triggered_by: userId,
        type: 'slot_submitted',
        slot_type: item_type,
        slot_id: item_id,
        linked_item_type: item_type === 'post' ? 'content_write' : item_type === 'shoot' ? 'shoots' : 'ads',
        linked_item_id: null,
        title: `${item_type} slot submitted for approval`,
        message: `Content has been filled and submitted. Please review.`,
        link: '/social/content-calendar',
      });
      res.emitSocket('smm:notification', { user_id: slot.assigned_by, type: 'slot_submitted' });
    }

    res.emitSocket('content-calendar:slot-submitted', { item_type, item_id, user_id: userId });
    return res.json({ message: 'Slot filled and submitted for approval', item_type, item_id });
  } catch (err) {
    console.error('Fill slot error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── SUBMIT SLOT (called from respective pages after filling) ─────────────────
// When content is filled on Write/Shoots/Ads page, this syncs status to calendar

exports.submitSlot = async (req, res) => {
  try {
    const { item_type, item_id } = req.body;
    const userId = req.user.id;

    if (!item_type || !item_id) {
      return res.status(400).json({ message: 'item_type and item_id are required' });
    }

    const table = TABLE_MAP[item_type];
    if (!table) return res.status(400).json({ message: 'Invalid item_type' });

    const [rows] = await db.query(`SELECT * FROM ${table} WHERE id = ?`, [item_id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Slot not found' });

    const slot = rows[0];

    if (!['assigned', 'rejected'].includes(slot.slot_status)) {
      return res.status(400).json({ message: `Cannot submit a slot with status "${slot.slot_status}". Must be assigned or rejected.` });
    }

    // Update slot status
    await db.query(
      `UPDATE ${table} SET slot_status = 'submitted', submitted_at = NOW(), rejection_reason = NULL WHERE id = ?`,
      [item_id]
    );

    // Notify the assigner that work was submitted
    if (slot.assigned_by) {
      await createSmmNotification(null, {
        user_id: slot.assigned_by,
        triggered_by: userId,
        type: 'slot_submitted',
        slot_type: item_type,
        slot_id: item_id,
        linked_item_type: item_type === 'post' ? 'content_write' : item_type === 'shoot' ? 'shoots' : 'ads',
        linked_item_id: null,
        title: `${item_type} slot submitted for approval`,
        message: `Content has been filled and submitted. Please review.`,
        link: '/social/content-calendar',
      });
      res.emitSocket('smm:notification', { user_id: slot.assigned_by, type: 'slot_submitted' });
    }

    res.emitSocket('content-calendar:slot-submitted', { item_type, item_id, user_id: userId });
    return res.json({ message: 'Slot submitted for approval', item_type, item_id });
  } catch (err) {
    console.error('Submit slot error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── APPROVE SLOT (Admin or SMM with 'all' access) ────────────────────────────

exports.approveSlot = async (req, res) => {
  try {
    const { item_type, item_id } = req.body;

    if (!req.user.is_admin && req.socialAccessLevel < 2) {
      return res.status(403).json({ message: 'Only admin or SMM leads can approve slots' });
    }

    if (!item_type || !item_id) {
      return res.status(400).json({ message: 'item_type and item_id are required' });
    }

    const table = TABLE_MAP[item_type];
    if (!table) return res.status(400).json({ message: 'Invalid item_type' });

    const [rows] = await db.query(`SELECT * FROM ${table} WHERE id = ?`, [item_id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Slot not found' });

    if (rows[0].slot_status !== 'submitted') {
      return res.status(400).json({ message: `Can only approve slots with status "submitted". Current: "${rows[0].slot_status}"` });
    }

    await db.query(
      `UPDATE ${table} SET slot_status = 'approved', approved_at = NOW(), approved_by = ?, rejection_reason = NULL WHERE id = ?`,
      [req.user.id, item_id]
    );

    // Notify assignee
    if (rows[0].assigned_to) {
      await createSmmNotification(null, {
        user_id: rows[0].assigned_to,
        triggered_by: req.user.id,
        type: 'slot_approved',
        slot_type: item_type,
        slot_id: item_id,
        title: `Your ${item_type} slot was approved! 🎉`,
        message: `Your content is now live on the calendar.`,
        link: getPageLink(item_type),
      });
      res.emitSocket('smm:notification', { user_id: rows[0].assigned_to, type: 'slot_approved' });
    }

    res.emitSocket('content-calendar:slot-approved', { item_type, item_id, approved_by: req.user.id });
    return res.json({ message: 'Slot approved', item_type, item_id });
  } catch (err) {
    console.error('Approve slot error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── REJECT SLOT (Admin or SMM with 'all' access) ─────────────────────────────

exports.rejectSlot = async (req, res) => {
  try {
    const { item_type, item_id, reason } = req.body;

    if (!req.user.is_admin && req.socialAccessLevel < 2) {
      return res.status(403).json({ message: 'Only admin or SMM leads can reject slots' });
    }

    if (!item_type || !item_id) {
      return res.status(400).json({ message: 'item_type and item_id are required' });
    }

    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ message: 'Rejection reason is required' });
    }

    const table = TABLE_MAP[item_type];
    if (!table) return res.status(400).json({ message: 'Invalid item_type' });

    const [rows] = await db.query(`SELECT * FROM ${table} WHERE id = ?`, [item_id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Slot not found' });

    if (rows[0].slot_status !== 'submitted') {
      return res.status(400).json({ message: `Can only reject slots with status "submitted".` });
    }

    await db.query(
      `UPDATE ${table} SET slot_status = 'rejected', rejection_reason = ?, approved_at = NULL, approved_by = NULL WHERE id = ?`,
      [reason.trim(), item_id]
    );

    // Notify assignee
    if (rows[0].assigned_to) {
      await createSmmNotification(null, {
        user_id: rows[0].assigned_to,
        triggered_by: req.user.id,
        type: 'slot_rejected',
        slot_type: item_type,
        slot_id: item_id,
        title: `Your ${item_type} slot was rejected`,
        message: `Reason: ${reason.trim()}. Please re-edit and resubmit.`,
        link: getPageLink(item_type),
      });
      res.emitSocket('smm:notification', { user_id: rows[0].assigned_to, type: 'slot_rejected' });
    }

    res.emitSocket('content-calendar:slot-rejected', { item_type, item_id, reason: reason.trim() });
    return res.json({ message: 'Slot rejected', item_type, item_id });
  } catch (err) {
    console.error('Reject slot error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── COMPLETE SLOT (assignee marks as done — no approval needed) ──────────────

exports.completeSlot = async (req, res) => {
  try {
    const { item_type, item_id } = req.body;
    const userId = req.user.id;

    if (!item_type || !item_id) {
      return res.status(400).json({ message: 'item_type and item_id are required' });
    }

    const table = TABLE_MAP[item_type];
    if (!table) return res.status(400).json({ message: 'Invalid item_type' });

    const [rows] = await db.query(`SELECT * FROM ${table} WHERE id = ?`, [item_id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Slot not found' });

    const slot = rows[0];

    // Only assignee or admin can mark complete
    if (!req.user.is_admin && slot.assigned_to !== userId) {
      return res.status(403).json({ message: 'Only the assignee can mark as completed' });
    }

    // Must be approved first
    if (slot.slot_status !== 'approved') {
      return res.status(400).json({ message: `Can only complete approved slots. Current: "${slot.slot_status}"` });
    }

    await db.query(`UPDATE ${table} SET slot_status = 'completed' WHERE id = ?`, [item_id]);

    // ─── Sync status to linked record in respective module ─────────────────────
    try {
      if (item_type === 'post') {
        await db.query(
          `UPDATE content_write_requests SET status = 'completed' WHERE calendar_slot_id = ? AND deleted = 0`,
          [item_id]
        );
        // Log to history
        const [linkedWrite] = await db.query('SELECT id FROM content_write_requests WHERE calendar_slot_id = ? AND deleted = 0 LIMIT 1', [item_id]);
        if (linkedWrite.length > 0) {
          await db.query(
            `INSERT INTO smm_approval_history (module, record_id, action, remarks, acted_by) VALUES (?, ?, ?, ?, ?)`,
            ['content_write', linkedWrite[0].id, 'approve', 'Marked as completed', userId]
          );
        }
      } else if (item_type === 'shoot') {
        await db.query(
          `UPDATE shoots SET status = 'completed' WHERE calendar_slot_id = ? AND deleted = 0`,
          [item_id]
        );
        const [linkedShoot] = await db.query('SELECT id FROM shoots WHERE calendar_slot_id = ? AND deleted = 0 LIMIT 1', [item_id]);
        if (linkedShoot.length > 0) {
          await db.query(
            `INSERT INTO smm_approval_history (module, record_id, action, remarks, acted_by) VALUES (?, ?, ?, ?, ?)`,
            ['shoots', linkedShoot[0].id, 'approve', 'Marked as completed', userId]
          );
        }
      } else if (item_type === 'ad') {
        await db.query(
          `UPDATE ad_campaigns SET status = 'completed' WHERE linked_calendar_ad_id = ? AND deleted = 0`,
          [item_id]
        );
        const [linkedAd] = await db.query('SELECT id FROM ad_campaigns WHERE linked_calendar_ad_id = ? AND deleted = 0 LIMIT 1', [item_id]);
        if (linkedAd.length > 0) {
          await db.query(
            `INSERT INTO smm_approval_history (module, record_id, action, remarks, acted_by) VALUES (?, ?, ?, ?, ?)`,
            ['ads', linkedAd[0].id, 'approve', 'Marked as completed', userId]
          );
        }
      }
    } catch (syncErr) {
      console.warn('Complete slot sync warning:', syncErr.message);
    }

    // Notify assigner
    if (slot.assigned_by) {
      await createSmmNotification(null, {
        user_id: slot.assigned_by,
        triggered_by: userId,
        type: 'slot_completed',
        slot_type: item_type,
        slot_id: item_id,
        title: `${item_type} slot marked as completed ✅`,
        message: `The assigned ${item_type} has been posted/executed.`,
        link: '/social/content-calendar',
      });
      res.emitSocket('smm:notification', { user_id: slot.assigned_by, type: 'slot_completed' });
    }

    res.emitSocket('content-calendar:slot-completed', { item_type, item_id });
    return res.json({ message: 'Slot marked as completed', item_type, item_id });
  } catch (err) {
    console.error('Complete slot error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── BULK APPROVE ─────────────────────────────────────────────────────────────

exports.bulkApprove = async (req, res) => {
  try {
    const { items } = req.body;

    if (!req.user.is_admin && req.socialAccessLevel < 2) {
      return res.status(403).json({ message: 'Only admin or SMM leads can approve' });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'items array is required' });
    }

    let approved = 0, skipped = 0;

    for (const { item_type, item_id } of items) {
      const table = TABLE_MAP[item_type];
      if (!table) { skipped++; continue; }

      const [rows] = await db.query(`SELECT * FROM ${table} WHERE id = ?`, [item_id]);
      if (rows.length === 0 || rows[0].slot_status !== 'submitted') { skipped++; continue; }

      await db.query(
        `UPDATE ${table} SET slot_status = 'approved', approved_at = NOW(), approved_by = ?, rejection_reason = NULL WHERE id = ?`,
        [req.user.id, item_id]
      );

      // Notify assignee
      if (rows[0].assigned_to) {
        await createSmmNotification(null, {
          user_id: rows[0].assigned_to,
          triggered_by: req.user.id,
          type: 'slot_approved',
          slot_type: item_type,
          slot_id: item_id,
          title: `Your ${item_type} slot was approved! 🎉`,
          message: `Your content is now live.`,
          link: getPageLink(item_type),
        });
      }

      approved++;
    }

    res.emitSocket('content-calendar:bulk-approved', { count: approved });
    return res.json({ message: `${approved} approved, ${skipped} skipped`, approved, skipped });
  } catch (err) {
    console.error('Bulk approve error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── PENDING COUNT (badge count) ──────────────────────────────────────────────
// Returns notification counts for the current user (both as assignee and assigner)

exports.pendingCount = async (req, res) => {
  try {
    const userId = req.user.id;

    // Unread SMM notifications count
    let unreadCount = 0;
    try {
      const [unread] = await db.query(
        `SELECT COUNT(*) AS count FROM smm_notifications WHERE user_id = ? AND is_read = 0`,
        [userId]
      );
      unreadCount = unread[0]?.count || 0;
    } catch (e) {
      // Table may not exist yet
    }

    // Pending approval count (for admin/SMM leads)
    let pendingApproval = 0;
    if (req.user.is_admin || (req.socialAccessLevel && req.socialAccessLevel >= 2)) {
      try {
        const [pc] = await db.query(
          `SELECT 
            (SELECT COUNT(*) FROM content_calendar_posts cp JOIN content_calendar_plans p ON p.id = cp.plan_id WHERE cp.slot_status = 'submitted' AND p.deleted = 0) +
            (SELECT COUNT(*) FROM content_calendar_shoots cs JOIN content_calendar_plans p ON p.id = cs.plan_id WHERE cs.slot_status = 'submitted' AND p.deleted = 0) +
            (SELECT COUNT(*) FROM content_calendar_ads ca JOIN content_calendar_plans p ON p.id = ca.plan_id WHERE ca.slot_status = 'submitted' AND p.deleted = 0)
            AS total`
        );
        pendingApproval = pc[0]?.total || 0;
      } catch (e) {
        // Columns may not exist yet
      }
    }

    // My assigned pending work — total and per-type
    let myPending = 0;
    let myPendingPosts = 0;
    let myPendingShoots = 0;
    let myPendingAds = 0;
    try {
      const [mp] = await db.query(
        `SELECT 
          (SELECT COUNT(*) FROM content_calendar_posts WHERE assigned_to = ? AND slot_status IN ('assigned','rejected')) AS posts,
          (SELECT COUNT(*) FROM content_calendar_shoots WHERE assigned_to = ? AND slot_status IN ('assigned','rejected')) AS shoots,
          (SELECT COUNT(*) FROM content_calendar_ads WHERE assigned_to = ? AND slot_status IN ('assigned','rejected')) AS ads`,
        [userId, userId, userId]
      );
      myPendingPosts  = mp[0]?.posts  || 0;
      myPendingShoots = mp[0]?.shoots || 0;
      myPendingAds    = mp[0]?.ads    || 0;
      myPending = myPendingPosts + myPendingShoots + myPendingAds;
    } catch (e) {
      // Fallback: try old enum values
      try {
        const [mp] = await db.query(
          `SELECT 
            (SELECT COUNT(*) FROM content_calendar_posts WHERE assigned_to = ? AND slot_status IN ('picked_up','rejected')) AS posts,
            (SELECT COUNT(*) FROM content_calendar_shoots WHERE assigned_to = ? AND slot_status IN ('picked_up','rejected')) AS shoots,
            (SELECT COUNT(*) FROM content_calendar_ads WHERE assigned_to = ? AND slot_status IN ('picked_up','rejected')) AS ads`,
          [userId, userId, userId]
        );
        myPendingPosts  = mp[0]?.posts  || 0;
        myPendingShoots = mp[0]?.shoots || 0;
        myPendingAds    = mp[0]?.ads    || 0;
        myPending = myPendingPosts + myPendingShoots + myPendingAds;
      } catch (e2) { /* ignore */ }
    }

    return res.json({
      unread_notifications: unreadCount,
      pending_approval: pendingApproval,
      my_pending_work: myPending,
      my_pending_posts: myPendingPosts,
      my_pending_shoots: myPendingShoots,
      my_pending_ads: myPendingAds,
      total_badge: unreadCount + myPending,
    });
  } catch (err) {
    console.error('Pending count error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── GET SMM NOTIFICATIONS ────────────────────────────────────────────────────

exports.getSmmNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 30 } = req.query;

    const [rows] = await db.query(
      `SELECT sn.*,
              CONCAT(u.first_name, ' ', u.last_name) AS triggered_by_name
       FROM smm_notifications sn
       LEFT JOIN users u ON u.id = sn.triggered_by
       WHERE sn.user_id = ?
       ORDER BY sn.created_at DESC
       LIMIT ?`,
      [userId, parseInt(limit)]
    );

    const [unreadCount] = await db.query(
      `SELECT COUNT(*) AS count FROM smm_notifications WHERE user_id = ? AND is_read = 0`,
      [userId]
    );

    return res.json({ notifications: rows, unread_count: unreadCount[0]?.count || 0 });
  } catch (err) {
    console.error('Get SMM notifications error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── MARK NOTIFICATION READ ───────────────────────────────────────────────────

exports.markNotificationRead = async (req, res) => {
  try {
    const { notification_id, mark_all } = req.body;
    const userId = req.user.id;

    if (mark_all) {
      await db.query(
        `UPDATE smm_notifications SET is_read = 1, read_at = NOW() WHERE user_id = ? AND is_read = 0`,
        [userId]
      );
    } else if (notification_id) {
      await db.query(
        `UPDATE smm_notifications SET is_read = 1, read_at = NOW() WHERE id = ? AND user_id = ?`,
        [notification_id, userId]
      );
    }

    return res.json({ message: 'Marked as read' });
  } catch (err) {
    console.error('Mark notification read error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── SHARE WITH CLIENT ────────────────────────────────────────────────────────

exports.shareWithClient = async (req, res) => {
  try {
    const { plan_id } = req.body;

    if (!req.user.is_admin && req.socialAccessLevel < 2) {
      return res.status(403).json({ message: 'Only admin or SMM leads can share calendars' });
    }

    if (!plan_id) return res.status(400).json({ message: 'plan_id is required' });

    const [plans] = await db.query('SELECT * FROM content_calendar_plans WHERE id = ? AND deleted = 0', [plan_id]);
    if (plans.length === 0) return res.status(404).json({ message: 'Plan not found' });

    // Check all slots are approved
    const [pending] = await db.query(
      `SELECT 
        (SELECT COUNT(*) FROM content_calendar_posts WHERE plan_id = ? AND slot_status NOT IN ('approved','completed')) +
        (SELECT COUNT(*) FROM content_calendar_shoots WHERE plan_id = ? AND slot_status NOT IN ('approved','completed')) +
        (SELECT COUNT(*) FROM content_calendar_ads WHERE plan_id = ? AND slot_status NOT IN ('approved','completed'))
        AS total`,
      [plan_id, plan_id, plan_id]
    );

    if ((pending[0]?.total || 0) > 0) {
      return res.status(400).json({ message: `Cannot share — ${pending[0].total} slot(s) not yet approved.` });
    }

    await db.query(
      `UPDATE content_calendar_plans SET shared_with_client = 1, shared_at = NOW(), shared_by = ?, status = 'active' WHERE id = ?`,
      [req.user.id, plan_id]
    );

    res.emitSocket('content-calendar:shared', { plan_id, client_id: plans[0].client_id });
    return res.json({ message: 'Calendar shared with client', plan_id });
  } catch (err) {
    console.error('Share with client error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── UNSHARE ──────────────────────────────────────────────────────────────────

exports.unshareWithClient = async (req, res) => {
  try {
    const { plan_id } = req.body;
    if (!req.user.is_admin && req.socialAccessLevel < 2) {
      return res.status(403).json({ message: 'Only admin or SMM leads can manage sharing' });
    }

    await db.query(
      `UPDATE content_calendar_plans SET shared_with_client = 0, shared_at = NULL, shared_by = NULL WHERE id = ?`,
      [plan_id]
    );
    return res.json({ message: 'Calendar unshared', plan_id });
  } catch (err) {
    console.error('Unshare error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── CLIENT VIEW CALENDAR ─────────────────────────────────────────────────────
// Called from client portal — shows only shared plans for the authenticated client

exports.clientViewCalendar = async (req, res) => {
  try {
    const clientId = req.clientId || req.clientUser?.client_id;
    if (!clientId) return res.status(401).json({ message: 'Unauthorized' });

    const { month } = req.query;

    let monthFilter = '';
    const params = [clientId];

    if (month) {
      monthFilter = ' AND p.plan_month = ?';
      params.push(month);
    }

    // Get shared plans for this client
    const [plans] = await db.query(
      `SELECT p.id, p.plan_month, p.primary_goal, p.target_audience, p.status, p.shared_at,
              pr.title AS project_title
       FROM content_calendar_plans p
       LEFT JOIN projects pr ON pr.id = p.project_id
       WHERE p.client_id = ? AND p.shared_with_client = 1 AND p.deleted = 0${monthFilter}
       ORDER BY p.plan_month DESC`,
      params
    );

    if (plans.length === 0) {
      return res.json({ plans: [], posts: [], shoots: [], ads: [] });
    }

    const planIds = plans.map(p => p.id);

    // Get posts for shared plans
    const [posts] = await db.query(
      `SELECT cp.id, cp.plan_id, cp.post_no, cp.platform, cp.format, cp.topic,
              cp.ad_target, cp.posting_date, cp.cta, cp.status,
              cwr.hook_opening_line AS brief_hook
       FROM content_calendar_posts cp
       LEFT JOIN content_write_requests cwr ON cwr.id = cp.linked_brief_id
       WHERE cp.plan_id IN (?)
       ORDER BY cp.posting_date ASC`,
      [planIds]
    );

    // Get shoots for shared plans
    const [shoots] = await db.query(
      `SELECT cs.id, cs.plan_id, cs.shoot_date, cs.location, cs.description,
              cs.num_videos, cs.num_photos, cs.status
       FROM content_calendar_shoots cs
       WHERE cs.plan_id IN (?)
       ORDER BY cs.shoot_date ASC`,
      [planIds]
    );

    // Get ads for shared plans
    const [ads] = await db.query(
      `SELECT ca.id, ca.plan_id, ca.ad_no, ca.creative_name, ca.campaign_objective,
              ca.platform, ca.ad_status AS status, ca.budget, ca.start_date, ca.end_date,
              ca.expected_outcomes
       FROM content_calendar_ads ca
       WHERE ca.plan_id IN (?)
       ORDER BY ca.start_date ASC`,
      [planIds]
    );

    return res.json({ plans, posts, shoots, ads });
  } catch (err) {
    console.error('clientViewCalendar error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
