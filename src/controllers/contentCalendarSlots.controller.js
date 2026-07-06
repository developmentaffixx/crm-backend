const db = require('../config/db');

// ═══════════════════════════════════════════════════════════════════════════════
// Content Calendar - Slot Pickup, Fill, Approval & Client Sharing
// ═══════════════════════════════════════════════════════════════════════════════

// ─── LIST AVAILABLE SLOTS (for team members) ──────────────────────────────────
// Shows all open slots that can be picked up, or user's own slots

exports.listSlots = async (req, res) => {
  try {
    const { project_id, cycle_id, slot_status, item_type, assigned_to_me } = req.query;
    const userId = req.user.id;

    let planWhere = 'p.deleted = 0 AND p.status IN ("draft","active")';
    const planParams = [];

    if (project_id) { planWhere += ' AND p.project_id = ?'; planParams.push(project_id); }
    if (cycle_id) { planWhere += ' AND p.cycle_id = ?'; planParams.push(cycle_id); }

    // Get plan IDs
    const [plans] = await db.query(
      `SELECT p.id, p.project_id, p.cycle_id, p.plan_month, pr.title AS project_title, l.business_name AS client_name
       FROM content_calendar_plans p
       LEFT JOIN projects pr ON pr.id = p.project_id
       LEFT JOIN leads l ON l.id = p.client_id
       WHERE ${planWhere}`,
      planParams
    );

    if (plans.length === 0) {
      return res.json({ posts: [], shoots: [], ads: [] });
    }

    const planIds = plans.map(p => p.id);
    const planMap = {};
    plans.forEach(p => { planMap[p.id] = p; });

    // Build slot status filter
    let statusFilter = '';
    const statusParams = [];
    if (slot_status) {
      statusFilter = ' AND slot_status = ?';
      statusParams.push(slot_status);
    }

    // If user wants only their slots
    let assignedFilter = '';
    const assignedParams = [];
    if (assigned_to_me === 'true' && !req.user.is_admin) {
      assignedFilter = ' AND assigned_to = ?';
      assignedParams.push(userId);
    }

    // Fetch posts
    let posts = [];
    if (!item_type || item_type === 'post') {
      const [rows] = await db.query(
        `SELECT cp.*, 
                CONCAT(u.first_name, ' ', u.last_name) AS assigned_to_name,
                CONCAT(au.first_name, ' ', au.last_name) AS approved_by_name,
                cwr.hook_opening_line AS brief_hook, cwr.content_id_code AS brief_code
         FROM content_calendar_posts cp
         LEFT JOIN users u ON u.id = cp.assigned_to
         LEFT JOIN users au ON au.id = cp.approved_by
         LEFT JOIN content_write_requests cwr ON cwr.id = cp.linked_brief_id
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
                CONCAT(au.first_name, ' ', au.last_name) AS approved_by_name,
                s.shoot_id_code AS linked_shoot_code, s.project_campaign_name AS shoot_name
         FROM content_calendar_shoots cs
         LEFT JOIN users u ON u.id = cs.assigned_to
         LEFT JOIN users au ON au.id = cs.approved_by
         LEFT JOIN shoots s ON s.id = cs.linked_shoot_id
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
                CONCAT(au.first_name, ' ', au.last_name) AS approved_by_name,
                ac.campaign_name AS linked_campaign_name
         FROM content_calendar_ads ca
         LEFT JOIN users u ON u.id = ca.assigned_to
         LEFT JOIN users au ON au.id = ca.approved_by
         LEFT JOIN ad_campaigns ac ON ac.id = ca.linked_campaign_id
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

// ─── PICK UP SLOT ─────────────────────────────────────────────────────────────

exports.pickupSlot = async (req, res) => {
  try {
    const { item_type, item_id } = req.body;
    const userId = req.user.id;

    if (!item_type || !item_id) {
      return res.status(400).json({ message: 'item_type and item_id are required' });
    }

    const tableMap = {
      post: 'content_calendar_posts',
      shoot: 'content_calendar_shoots',
      ad: 'content_calendar_ads',
    };

    const table = tableMap[item_type];
    if (!table) return res.status(400).json({ message: 'Invalid item_type. Must be post, shoot, or ad' });

    // Check slot exists and is open
    const [rows] = await db.query(`SELECT * FROM ${table} WHERE id = ?`, [item_id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Slot not found' });

    const slot = rows[0];
    if (slot.slot_status !== 'open') {
      return res.status(400).json({ message: `Slot is already ${slot.slot_status}. Cannot pick up.` });
    }

    // Assign to user
    await db.query(
      `UPDATE ${table} SET assigned_to = ?, slot_status = 'picked_up' WHERE id = ?`,
      [userId, item_id]
    );

    res.emitSocket('content-calendar:slot-picked', { item_type, item_id, user_id: userId });
    return res.json({ message: 'Slot picked up successfully', item_type, item_id });
  } catch (err) {
    console.error('Pickup slot error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── FILL SLOT (submit for approval) ─────────────────────────────────────────

exports.fillSlot = async (req, res) => {
  try {
    const { item_type, item_id, ...data } = req.body;
    const userId = req.user.id;

    if (!item_type || !item_id) {
      return res.status(400).json({ message: 'item_type and item_id are required' });
    }

    const tableMap = {
      post: 'content_calendar_posts',
      shoot: 'content_calendar_shoots',
      ad: 'content_calendar_ads',
    };

    const table = tableMap[item_type];
    if (!table) return res.status(400).json({ message: 'Invalid item_type' });

    // Check slot is assigned to this user and in correct status
    const [rows] = await db.query(`SELECT * FROM ${table} WHERE id = ?`, [item_id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Slot not found' });

    const slot = rows[0];
    if (!req.user.is_admin && slot.assigned_to !== userId) {
      return res.status(403).json({ message: 'This slot is not assigned to you' });
    }

    if (!['picked_up', 'rejected'].includes(slot.slot_status)) {
      return res.status(400).json({ message: `Cannot fill a slot with status "${slot.slot_status}". Must be picked_up or rejected.` });
    }

    // Build update query based on item_type
    let updateFields = {};

    if (item_type === 'post') {
      const { linked_brief_id, platform, format, topic, ad_target, shoot_date, posting_date, cta } = data;
      if (linked_brief_id !== undefined) updateFields.linked_brief_id = linked_brief_id || null;
      if (platform !== undefined) updateFields.platform = platform || null;
      if (format !== undefined) updateFields.format = format || null;
      if (topic !== undefined) updateFields.topic = topic || null;
      if (ad_target !== undefined) updateFields.ad_target = ad_target || 'organic';
      if (shoot_date !== undefined) updateFields.shoot_date = shoot_date || null;
      if (posting_date !== undefined) updateFields.posting_date = posting_date || null;
      if (cta !== undefined) updateFields.cta = cta || null;
    } else if (item_type === 'shoot') {
      const { linked_shoot_id, shoot_date, location, description, num_videos, num_photos, talent, production_notes } = data;
      if (linked_shoot_id !== undefined) updateFields.linked_shoot_id = linked_shoot_id || null;
      if (shoot_date !== undefined) updateFields.shoot_date = shoot_date || null;
      if (location !== undefined) updateFields.location = location || null;
      if (description !== undefined) updateFields.description = description || null;
      if (num_videos !== undefined) updateFields.num_videos = num_videos || 0;
      if (num_photos !== undefined) updateFields.num_photos = num_photos || 0;
      if (talent !== undefined) updateFields.talent = talent || null;
      if (production_notes !== undefined) updateFields.production_notes = production_notes || null;
    } else if (item_type === 'ad') {
      const { linked_campaign_id, creative_name, campaign_objective, platform, target_audience, budget, start_date, end_date, expected_outcomes } = data;
      if (linked_campaign_id !== undefined) updateFields.linked_campaign_id = linked_campaign_id || null;
      if (creative_name !== undefined) updateFields.creative_name = creative_name || null;
      if (campaign_objective !== undefined) updateFields.campaign_objective = campaign_objective;
      if (platform !== undefined) updateFields.platform = platform || null;
      if (target_audience !== undefined) updateFields.target_audience = target_audience || null;
      if (budget !== undefined) updateFields.budget = budget || null;
      if (start_date !== undefined) updateFields.start_date = start_date || null;
      if (end_date !== undefined) updateFields.end_date = end_date || null;
      if (expected_outcomes !== undefined) updateFields.expected_outcomes = expected_outcomes || null;
    }

    // Set slot_status to pending_approval and submitted_at
    updateFields.slot_status = 'pending_approval';
    updateFields.submitted_at = new Date();
    updateFields.rejection_reason = null; // Clear any previous rejection

    const setClauses = Object.keys(updateFields).map(k => `${k} = ?`).join(', ');
    const values = Object.values(updateFields);

    await db.query(`UPDATE ${table} SET ${setClauses} WHERE id = ?`, [...values, item_id]);

    res.emitSocket('content-calendar:slot-submitted', { item_type, item_id, user_id: userId });
    return res.json({ message: 'Slot submitted for approval', item_type, item_id });
  } catch (err) {
    console.error('Fill slot error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── APPROVE SLOT (admin only) ────────────────────────────────────────────────

exports.approveSlot = async (req, res) => {
  try {
    const { item_type, item_id } = req.body;

    if (!req.user.is_admin) {
      return res.status(403).json({ message: 'Only admins can approve slots' });
    }

    if (!item_type || !item_id) {
      return res.status(400).json({ message: 'item_type and item_id are required' });
    }

    const tableMap = {
      post: 'content_calendar_posts',
      shoot: 'content_calendar_shoots',
      ad: 'content_calendar_ads',
    };

    const table = tableMap[item_type];
    if (!table) return res.status(400).json({ message: 'Invalid item_type' });

    const [rows] = await db.query(`SELECT * FROM ${table} WHERE id = ?`, [item_id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Slot not found' });

    if (rows[0].slot_status !== 'pending_approval') {
      return res.status(400).json({ message: `Slot status is "${rows[0].slot_status}". Can only approve slots with status "pending_approval".` });
    }

    await db.query(
      `UPDATE ${table} SET slot_status = 'approved', approved_at = NOW(), approved_by = ?, rejection_reason = NULL WHERE id = ?`,
      [req.user.id, item_id]
    );

    // Also update the item's own status to done/completed
    if (item_type === 'post') {
      await db.query(`UPDATE ${table} SET status = 'done' WHERE id = ?`, [item_id]);
    } else if (item_type === 'shoot') {
      await db.query(`UPDATE ${table} SET status = 'completed' WHERE id = ?`, [item_id]);
    } else if (item_type === 'ad') {
      await db.query(`UPDATE ${table} SET ad_status = 'running' WHERE id = ?`, [item_id]);
    }

    res.emitSocket('content-calendar:slot-approved', { item_type, item_id, approved_by: req.user.id });
    return res.json({ message: 'Slot approved', item_type, item_id });
  } catch (err) {
    console.error('Approve slot error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── REJECT SLOT (admin only) ─────────────────────────────────────────────────

exports.rejectSlot = async (req, res) => {
  try {
    const { item_type, item_id, reason } = req.body;

    if (!req.user.is_admin) {
      return res.status(403).json({ message: 'Only admins can reject slots' });
    }

    if (!item_type || !item_id) {
      return res.status(400).json({ message: 'item_type and item_id are required' });
    }

    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ message: 'Rejection reason is required' });
    }

    const tableMap = {
      post: 'content_calendar_posts',
      shoot: 'content_calendar_shoots',
      ad: 'content_calendar_ads',
    };

    const table = tableMap[item_type];
    if (!table) return res.status(400).json({ message: 'Invalid item_type' });

    const [rows] = await db.query(`SELECT * FROM ${table} WHERE id = ?`, [item_id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Slot not found' });

    if (rows[0].slot_status !== 'pending_approval') {
      return res.status(400).json({ message: `Can only reject slots with status "pending_approval".` });
    }

    await db.query(
      `UPDATE ${table} SET slot_status = 'rejected', rejection_reason = ?, approved_at = NULL, approved_by = NULL WHERE id = ?`,
      [reason.trim(), item_id]
    );

    res.emitSocket('content-calendar:slot-rejected', { item_type, item_id, reason: reason.trim() });
    return res.json({ message: 'Slot rejected', item_type, item_id, reason: reason.trim() });
  } catch (err) {
    console.error('Reject slot error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── BULK APPROVE (admin only) ────────────────────────────────────────────────

exports.bulkApprove = async (req, res) => {
  try {
    const { items } = req.body; // [{item_type, item_id}, ...]

    if (!req.user.is_admin) {
      return res.status(403).json({ message: 'Only admins can approve slots' });
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'items array is required' });
    }

    const tableMap = {
      post: 'content_calendar_posts',
      shoot: 'content_calendar_shoots',
      ad: 'content_calendar_ads',
    };

    let approved = 0;
    let skipped = 0;

    for (const { item_type, item_id } of items) {
      const table = tableMap[item_type];
      if (!table) { skipped++; continue; }

      const [rows] = await db.query(`SELECT slot_status FROM ${table} WHERE id = ?`, [item_id]);
      if (rows.length === 0 || rows[0].slot_status !== 'pending_approval') {
        skipped++;
        continue;
      }

      await db.query(
        `UPDATE ${table} SET slot_status = 'approved', approved_at = NOW(), approved_by = ?, rejection_reason = NULL WHERE id = ?`,
        [req.user.id, item_id]
      );

      // Update item status
      if (item_type === 'post') await db.query(`UPDATE ${table} SET status = 'done' WHERE id = ?`, [item_id]);
      else if (item_type === 'shoot') await db.query(`UPDATE ${table} SET status = 'completed' WHERE id = ?`, [item_id]);
      else if (item_type === 'ad') await db.query(`UPDATE ${table} SET ad_status = 'running' WHERE id = ?`, [item_id]);

      approved++;
    }

    res.emitSocket('content-calendar:bulk-approved', { count: approved });
    return res.json({ message: `${approved} slots approved, ${skipped} skipped`, approved, skipped });
  } catch (err) {
    console.error('Bulk approve error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── PENDING APPROVALS COUNT (for admin dashboard) ────────────────────────────

exports.pendingCount = async (req, res) => {
  try {
    if (!req.user.is_admin) {
      return res.status(403).json({ message: 'Only admins can view pending count' });
    }

    const [postCount] = await db.query(
      `SELECT COUNT(*) AS count FROM content_calendar_posts cp
       JOIN content_calendar_plans p ON p.id = cp.plan_id
       WHERE cp.slot_status = 'pending_approval' AND p.deleted = 0`
    );
    const [shootCount] = await db.query(
      `SELECT COUNT(*) AS count FROM content_calendar_shoots cs
       JOIN content_calendar_plans p ON p.id = cs.plan_id
       WHERE cs.slot_status = 'pending_approval' AND p.deleted = 0`
    );
    const [adCount] = await db.query(
      `SELECT COUNT(*) AS count FROM content_calendar_ads ca
       JOIN content_calendar_plans p ON p.id = ca.plan_id
       WHERE ca.slot_status = 'pending_approval' AND p.deleted = 0`
    );

    const total = (postCount[0]?.count || 0) + (shootCount[0]?.count || 0) + (adCount[0]?.count || 0);

    return res.json({
      total,
      posts: postCount[0]?.count || 0,
      shoots: shootCount[0]?.count || 0,
      ads: adCount[0]?.count || 0,
    });
  } catch (err) {
    console.error('Pending count error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── SHARE CALENDAR WITH CLIENT ───────────────────────────────────────────────

exports.shareWithClient = async (req, res) => {
  try {
    const { plan_id } = req.body;

    if (!req.user.is_admin) {
      return res.status(403).json({ message: 'Only admins can share calendars with clients' });
    }

    if (!plan_id) {
      return res.status(400).json({ message: 'plan_id is required' });
    }

    // Check plan exists
    const [plans] = await db.query(
      'SELECT * FROM content_calendar_plans WHERE id = ? AND deleted = 0',
      [plan_id]
    );
    if (plans.length === 0) return res.status(404).json({ message: 'Plan not found' });

    const plan = plans[0];

    // Check all slots are approved
    const [pendingPosts] = await db.query(
      `SELECT COUNT(*) AS count FROM content_calendar_posts WHERE plan_id = ? AND slot_status != 'approved'`,
      [plan_id]
    );
    const [pendingShoots] = await db.query(
      `SELECT COUNT(*) AS count FROM content_calendar_shoots WHERE plan_id = ? AND slot_status != 'approved'`,
      [plan_id]
    );
    const [pendingAds] = await db.query(
      `SELECT COUNT(*) AS count FROM content_calendar_ads WHERE plan_id = ? AND slot_status != 'approved'`,
      [plan_id]
    );

    const totalPending = (pendingPosts[0]?.count || 0) + (pendingShoots[0]?.count || 0) + (pendingAds[0]?.count || 0);

    if (totalPending > 0) {
      return res.status(400).json({
        message: `Cannot share — ${totalPending} slot(s) are not yet approved. All slots must be approved before sharing with client.`,
        pending: totalPending,
      });
    }

    // Mark as shared
    await db.query(
      `UPDATE content_calendar_plans SET shared_with_client = 1, shared_at = NOW(), shared_by = ?, status = 'active' WHERE id = ?`,
      [req.user.id, plan_id]
    );

    res.emitSocket('content-calendar:shared', { plan_id, client_id: plan.client_id });
    return res.json({ message: 'Calendar shared with client successfully', plan_id });
  } catch (err) {
    console.error('Share with client error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── UNSHARE (revoke client access) ──────────────────────────────────────────

exports.unshareWithClient = async (req, res) => {
  try {
    const { plan_id } = req.body;

    if (!req.user.is_admin) {
      return res.status(403).json({ message: 'Only admins can manage sharing' });
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

// ─── CLIENT PORTAL: VIEW SHARED CALENDAR ─────────────────────────────────────
// This is called from the client portal (client-authenticated)

exports.clientViewCalendar = async (req, res) => {
  try {
    const clientId = req.clientId; // Set by client portal auth middleware
    const { month } = req.query;

    let where = 'p.deleted = 0 AND p.shared_with_client = 1 AND p.client_id = ?';
    const params = [clientId];

    if (month) {
      where += ' AND p.plan_month = ?';
      params.push(month);
    }

    const [plans] = await db.query(
      `SELECT p.id, p.plan_month, p.primary_goal, p.status, p.shared_at,
              pr.title AS project_title
       FROM content_calendar_plans p
       LEFT JOIN projects pr ON pr.id = p.project_id
       WHERE ${where}
       ORDER BY p.plan_month DESC`,
      params
    );

    if (plans.length === 0) {
      return res.json({ plans: [], posts: [], shoots: [], ads: [] });
    }

    const planIds = plans.map(p => p.id);

    // Fetch approved items only (client should only see approved content)
    const [posts] = await db.query(
      `SELECT cp.id, cp.platform, cp.format, cp.topic, cp.posting_date, cp.cta, cp.status,
              cwr.hook_opening_line AS brief_hook, cwr.content_type AS brief_content_type
       FROM content_calendar_posts cp
       LEFT JOIN content_write_requests cwr ON cwr.id = cp.linked_brief_id
       WHERE cp.plan_id IN (?) AND cp.slot_status = 'approved'
       ORDER BY cp.posting_date ASC`,
      [planIds]
    );

    const [shoots] = await db.query(
      `SELECT cs.id, cs.shoot_date, cs.location, cs.description, cs.num_videos, cs.num_photos, cs.status
       FROM content_calendar_shoots cs
       WHERE cs.plan_id IN (?) AND cs.slot_status = 'approved'
       ORDER BY cs.shoot_date ASC`,
      [planIds]
    );

    const [ads] = await db.query(
      `SELECT ca.id, ca.ad_no, ca.creative_name, ca.campaign_objective, ca.platform, 
              ca.ad_status, ca.budget, ca.start_date, ca.end_date, ca.expected_outcomes
       FROM content_calendar_ads ca
       WHERE ca.plan_id IN (?) AND ca.slot_status = 'approved'
       ORDER BY ca.start_date ASC`,
      [planIds]
    );

    return res.json({ plans, posts, shoots, ads });
  } catch (err) {
    console.error('Client view calendar error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
