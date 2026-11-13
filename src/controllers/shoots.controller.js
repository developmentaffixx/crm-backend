const { validationResult } = require('express-validator');
const db = require('../config/db');
const {
  parseIds, crewToJson, generateShootCode, logShootHistory, notifyShoot, setSlotStatus,
  LinkError, resolveShootLink, linkFromPlan, attachLinkNames,
} = require('../helpers/shootsWorkflow');

const toNull = (val) => (val === '' || val === undefined || val === null) ? null : val;
const toInt = (val) => { const n = parseInt(val); return isNaN(n) ? null : n; };

// ─── Permission helpers ───────────────────────────────────────────────────────
// Stage 1 (shoot request) → Shoot Approval toggle; Stage 2 (close request) → Close Approval toggle.
const canApproveShoot = (req) => !!(req.user.is_admin || req.userCanShootApprove);
const canApproveClose = (req) => !!(req.user.is_admin || req.userCanShootCloseApprove);
/** Can see every shoot (not just own / crew). */
const canSeeAllShoots = (req) => !!(req.user.is_admin || req.socialAccessLevel >= 2 || canApproveShoot(req) || canApproveClose(req));

const DETAIL_SELECT = `
  SELECT s.*,
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
  LEFT JOIN users uca ON uca.id = s.completion_approved_by`;

async function fetchShootDetail(id) {
  const [rows] = await db.query(`${DETAIL_SELECT} WHERE s.id = ?`, [id]);
  return rows[0] || null;
}

/** Store the Project ▸ Service ▸ Cycle link on a shoot (non-fatal if columns are missing). */
async function saveShootLink(shootId, link) {
  if (!link || !link.project_id) return;
  try {
    await db.query(
      'UPDATE shoots SET project_id = ?, project_service_id = ?, cycle_id = ? WHERE id = ?',
      [link.project_id, link.project_service_id, link.cycle_id, shootId]
    );
  } catch (e) {
    console.error('Saving shoot project/service/cycle failed:', e.message);
  }
}

/** Notify the calendar slot's assigner (if any). */
async function notifySlotAssigner(slotId, triggeredBy, payload, res) {
  if (!slotId) return;
  try {
    const [slot] = await db.query('SELECT assigned_by FROM content_calendar_shoots WHERE id = ?', [slotId]);
    const to = slot[0]?.assigned_by;
    if (await notifyShoot({ user_id: to, triggered_by: triggeredBy, slot_id: slotId, ...payload })) {
      res.emitSocket('smm:notification', { user_id: to, type: payload.type });
    }
  } catch (e) { /* non-fatal */ }
}

async function notifyUser(userId, triggeredBy, payload, res) {
  if (await notifyShoot({ user_id: userId, triggered_by: triggeredBy, ...payload })) {
    res.emitSocket('smm:notification', { user_id: userId, type: payload.type });
  }
}

/**
 * Ensure an approved DIRECT shoot (one created from the Shoots page, with no
 * calendar_slot_id) appears on the Content Calendar. Attaches to the client's
 * month plan (creating that plan if none exists), inserts a content_calendar_shoots
 * slot in the 'approved' state, and links it both ways.
 * Returns the new calendar slot id, or null if it couldn't be placed.
 */
async function ensureCalendarSlotForDirectShoot(shoot, actingUserId) {
  try {
    if (shoot.calendar_slot_id) return shoot.calendar_slot_id; // already on calendar
    const clientId = shoot.client_brand_id || null;

    const base = shoot.shoot_date ? new Date(shoot.shoot_date) : new Date();
    const planMonth = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-01`;

    let planId = null;

    // Preferred: the plan for the shoot's cycle (one plan per cycle), created if missing
    if (shoot.cycle_id) {
      const [cyclePlan] = await db.query(
        'SELECT id FROM content_calendar_plans WHERE cycle_id = ? AND deleted = 0 ORDER BY id ASC LIMIT 1',
        [shoot.cycle_id]
      );
      if (cyclePlan.length > 0) {
        planId = cyclePlan[0].id;
      } else {
        const [cyc] = await db.query('SELECT start_date FROM service_cycles WHERE id = ?', [shoot.cycle_id]);
        const cs = cyc[0]?.start_date ? new Date(cyc[0].start_date) : base;
        const cycleMonth = `${cs.getFullYear()}-${String(cs.getMonth() + 1).padStart(2, '0')}-01`;
        const [planResult] = await db.query(
          `INSERT INTO content_calendar_plans (client_id, project_id, cycle_id, plan_month, status, created_by)
           VALUES (?, ?, ?, ?, 'active', ?)`,
          [clientId, shoot.project_id || null, shoot.cycle_id, cycleMonth, actingUserId]
        );
        planId = planResult.insertId;
      }
    }

    // Legacy shoots without a cycle: the client's plan for the shoot month
    const [existingPlan] = planId ? [[{ id: planId }]] : await db.query(
      `SELECT id FROM content_calendar_plans
       WHERE deleted = 0 AND plan_month = ?
         AND ((client_id = ?) OR (? IS NULL AND client_id IS NULL))
       ORDER BY id ASC LIMIT 1`,
      [planMonth, clientId, clientId]
    );
    if (existingPlan.length > 0) {
      planId = existingPlan[0].id;
    } else {
      const [planResult] = await db.query(
        `INSERT INTO content_calendar_plans (client_id, plan_month, status, created_by)
         VALUES (?, ?, 'active', ?)`,
        [clientId, planMonth, actingUserId]
      );
      planId = planResult.insertId;
    }

    const [slotResult] = await db.query(
      `INSERT INTO content_calendar_shoots
        (plan_id, assigned_to, assigned_by, linked_shoot_ref_id, shoot_date, location, description,
         status, slot_status, approved_at, approved_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', 'approved', NOW(), ?)`,
      [
        planId,
        shoot.shoot_manager_id || shoot.created_by || null,
        actingUserId,
        shoot.id,
        shoot.shoot_date || null,
        shoot.city || null,
        shoot.project_campaign_name || null,
        actingUserId,
      ]
    );
    const slotId = slotResult.insertId;
    await db.query('UPDATE shoots SET calendar_slot_id = ? WHERE id = ?', [slotId, shoot.id]);
    return slotId;
  } catch (err) {
    console.error('ensureCalendarSlotForDirectShoot failed (shoot not placed on calendar):', err.message);
    return null;
  }
}

// ─── LIST ────────────────────────────────────────────────────────────────────
/**
 * GET /api/shoots?search=&status=&page=&limit=
 * Server-side search, status filter and pagination. `summary` counts are over
 * the search + scope (ignoring status) so status tabs can show their counts.
 */
exports.list = async (req, res) => {
  try {
    const { status, search } = req.query;
    const filterProject = toInt(req.query.project_id);
    const filterService = toInt(req.query.project_service_id);
    const filterCycle   = toInt(req.query.cycle_id);
    const pageNum  = Math.max(1, parseInt(req.query.page) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(req.query.limit) || 20));
    const uid = Number(req.user.id);

    const joins = `
      LEFT JOIN leads l ON l.id = s.client_brand_id
      LEFT JOIN users uc ON uc.id = s.created_by
      LEFT JOIN users um ON um.id = s.shoot_manager_id`;

    const buildWhere = (withCrewScope) => {
      let where = 's.deleted = 0';
      const params = [];
      const term = typeof search === 'string' ? search.trim() : '';
      if (term) {
        const like = `%${term}%`;
        where += ` AND (s.project_campaign_name LIKE ? OR s.shoot_id_code LIKE ? OR s.city LIKE ?
                        OR l.business_name LIKE ? OR CONCAT(um.first_name, ' ', um.last_name) LIKE ?)`;
        params.push(like, like, like, like, like);
      }
      // Project ▸ Service ▸ Cycle filters
      if (filterProject) { where += ' AND s.project_id = ?'; params.push(filterProject); }
      if (filterService) { where += ' AND s.project_service_id = ?'; params.push(filterService); }
      if (filterCycle)   { where += ' AND s.cycle_id = ?'; params.push(filterCycle); }
      if (!canSeeAllShoots(req)) {
        if (withCrewScope) {
          where += ` AND (s.created_by = ? OR s.shoot_manager_id = ?
                         OR JSON_CONTAINS(COALESCE(s.photographers, '[]'), ?)
                         OR JSON_CONTAINS(COALESCE(s.videographers, '[]'), ?))`;
          params.push(uid, uid, String(uid), String(uid));
        } else {
          where += ' AND (s.created_by = ? OR s.shoot_manager_id = ?)';
          params.push(uid, uid);
        }
      }
      return { where, params };
    };

    const run = async (withCrewScope) => {
      const { where: baseWhere, params: baseParams } = buildWhere(withCrewScope);
      let where = baseWhere;
      const params = [...baseParams];
      if (status) { where += ' AND s.status = ?'; params.push(status); }

      const [rows] = await db.query(
        `SELECT s.*,
                l.business_name AS client_brand_name,
                CONCAT(uc.first_name, ' ', uc.last_name) AS created_by_name,
                CONCAT(um.first_name, ' ', um.last_name) AS shoot_manager_name
         FROM shoots s ${joins}
         WHERE ${where}
         ORDER BY s.shoot_date DESC, s.created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, limitNum, (pageNum - 1) * limitNum]
      );
      const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM shoots s ${joins} WHERE ${where}`, params);
      const [counts] = await db.query(
        `SELECT s.status, COUNT(*) AS count FROM shoots s ${joins} WHERE ${baseWhere} GROUP BY s.status`,
        baseParams
      );
      return { rows, total, counts };
    };

    let result;
    try {
      result = await run(true);
    } catch (e) {
      // JSON_CONTAINS unsupported / bad JSON → fall back to creator + manager scope
      console.warn('Shoots list crew scope fallback:', e.message);
      result = await run(false);
    }

    const summary = { total: 0, draft: 0, pending_approval: 0, approved: 0, rejected: 0, pending_completion: 0, completed: 0 };
    result.counts.forEach(r => {
      summary[r.status] = Number(r.count) || 0;
      summary.total += Number(r.count) || 0;
    });

    // Crew as arrays for the client
    const shoots = result.rows.map(r => ({
      ...r,
      photographers: parseIds(r.photographers),
      videographers: parseIds(r.videographers),
    }));
    await attachLinkNames(shoots);

    return res.json({ shoots, summary, total: Number(result.total) || 0, page: pageNum, limit: limitNum });
  } catch (err) {
    console.error('Shoots list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── CREW CANDIDATES ─────────────────────────────────────────────────────────
/**
 * GET /api/shoots/crew-candidates?include=1,2
 * Active users with Content Calendar access (Own or All), for the photographer /
 * videographer pickers — crew punch their shoot from the calendar, so they need
 * calendar access but not Shoots access. `include` keeps already-picked users.
 *
 * Resolution mirrors requireSocialAccess for submenu 'content_calendar':
 * user override → role submenu → legacy role_social_permissions → inferred from
 * SM Ops view/edit when nothing is set. Admins always qualify.
 */
exports.crewCandidates = async (req, res) => {
  try {
    const include = new Set(
      String(req.query.include || '').split(',').map(n => parseInt(n, 10)).filter(n => !Number.isNaN(n))
    );

    const [users] = await db.query(
      `SELECT id, first_name, last_name, role_id, is_admin
       FROM users WHERE deleted = 0 AND is_active = 1
       ORDER BY first_name, last_name`
    );

    const safe = async (sql) => { try { const [r] = await db.query(sql); return r; } catch (e) { return []; } };
    const userSub = await safe(`SELECT user_id, can_access FROM user_submenu_permissions WHERE module = 'creative_hub' AND submenu = 'content_calendar'`);
    const roleSub = await safe(`SELECT role_id, can_access FROM role_submenu_permissions WHERE module = 'creative_hub' AND submenu = 'content_calendar'`);
    const legacy  = await safe(`SELECT role_id, content_calendar AS can_access FROM role_social_permissions`);
    const rolePerm = await safe(`SELECT role_id, can_view, can_edit FROM role_permissions WHERE module = 'creative_hub'`);
    const userPerm = await safe(`SELECT user_id, can_view, can_edit FROM user_permissions WHERE module = 'creative_hub'`);

    const toMap = (rows, key) => {
      const m = new Map();
      rows.forEach(r => { if (r.can_access !== null && r.can_access !== undefined) m.set(Number(r[key]), Number(r.can_access) || 0); });
      return m;
    };
    const userSubMap = toMap(userSub, 'user_id');
    const roleSubMap = toMap(roleSub, 'role_id');
    const legacyMap  = toMap(legacy, 'role_id');
    const rolePermMap = new Map(rolePerm.map(r => [Number(r.role_id), r]));
    const userPermMap = new Map(userPerm.map(r => [Number(r.user_id), r]));

    const calendarLevel = (u) => {
      if (u.is_admin) return 2;
      const uid = Number(u.id);
      const rid = Number(u.role_id);
      if (userSubMap.has(uid)) return userSubMap.get(uid);
      if (rid && roleSubMap.has(rid)) return roleSubMap.get(rid);
      if (rid && legacyMap.has(rid)) return legacyMap.get(rid);
      // Nothing set: infer from SM Ops view / edit (user row overrides role row)
      const rp = rolePermMap.get(rid) || {};
      const up = userPermMap.get(uid) || {};
      const view = Number(up.can_view ?? rp.can_view ?? 0) || 0;
      const edit = Number(up.can_edit ?? rp.can_edit ?? 0) || 0;
      return view || (edit ? 2 : 0);
    };

    const list = users
      .map(u => ({ id: u.id, first_name: u.first_name, last_name: u.last_name, calendar_access: calendarLevel(u) }))
      .filter(u => u.calendar_access >= 1 || include.has(Number(u.id)));

    return res.json({ users: list });
  } catch (err) {
    console.error('Shoots crew candidates error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── GET ONE ─────────────────────────────────────────────────────────────────
exports.getOne = async (req, res) => {
  try {
    const shoot = await fetchShootDetail(req.params.id);
    if (!shoot || shoot.deleted) return res.status(404).json({ message: 'Shoot not found' });

    shoot.photographers = parseIds(shoot.photographers);
    shoot.videographers = parseIds(shoot.videographers);
    await attachLinkNames(shoot);

    // Access: anyone who can see all shoots, the creator, or the crew
    const uid = Number(req.user.id);
    const isCrew = Number(shoot.created_by) === uid || Number(shoot.shoot_manager_id) === uid
      || shoot.photographers.includes(uid) || shoot.videographers.includes(uid);
    if (!canSeeAllShoots(req) && !isCrew) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const crewIds = [...new Set([...shoot.photographers, ...shoot.videographers])];
    shoot.photographer_names = [];
    shoot.videographer_names = [];
    if (crewIds.length) {
      const [users] = await db.query(
        `SELECT id, CONCAT(first_name, ' ', last_name) AS name FROM users WHERE id IN (?)`,
        [crewIds]
      );
      const byId = Object.fromEntries(users.map(u => [Number(u.id), u]));
      shoot.photographer_names = shoot.photographers.map(id => byId[id]).filter(Boolean);
      shoot.videographer_names = shoot.videographers.map(id => byId[id]).filter(Boolean);
    }

    // Close request / footage names (columns from the shoots workflow migration)
    try {
      const [names] = await db.query(
        `SELECT CONCAT(cr.first_name, ' ', cr.last_name) AS close_requested_by_name,
                CONCAT(fu.first_name, ' ', fu.last_name) AS footage_updated_by_name
         FROM shoots s
         LEFT JOIN users cr ON cr.id = s.close_requested_by
         LEFT JOIN users fu ON fu.id = s.footage_updated_by
         WHERE s.id = ?`,
        [shoot.id]
      );
      Object.assign(shoot, names[0] || {});
    } catch (e) { /* columns not migrated yet */ }

    // Approval history (timeline)
    try {
      const [history] = await db.query(
        `SELECT h.action, h.remarks, h.created_at, CONCAT(u.first_name, ' ', u.last_name) AS acted_by_name
         FROM smm_approval_history h
         LEFT JOIN users u ON u.id = h.acted_by
         WHERE h.module = 'shoots' AND h.record_id = ?
         ORDER BY h.created_at ASC, h.id ASC`,
        [shoot.id]
      );
      shoot.history = history;
    } catch (e) { shoot.history = []; }

    return res.json(shoot);
  } catch (err) {
    console.error('Shoots getOne error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── CREATE / FILL ───────────────────────────────────────────────────────────
/**
 * POST /api/shoots
 *  - With calendar_slot_id: the assignee fills their slot. Updates the draft
 *    placeholder created at assignment (no duplicate) → pending_approval.
 *  - Without: a direct shoot request (needs Create permission).
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
  const uid = Number(req.user.id);

  try {
    const slotIdVal = toInt(calendar_slot_id);

    // ── Project ▸ Service ▸ Cycle ──
    // Slot fills inherit it from the calendar plan; direct shoots must choose it.
    let link;
    let slotPlanId = null;

    // ── Permission ──
    if (slotIdVal) {
      const [slotRows] = await db.query('SELECT * FROM content_calendar_shoots WHERE id = ?', [slotIdVal]);
      if (!slotRows.length) return res.status(404).json({ message: 'Calendar slot not found' });
      const slot = slotRows[0];
      slotPlanId = slot.plan_id;
      const mayFill = req.user.is_admin || Number(slot.assigned_to) === uid || canApproveShoot(req) || req.socialAccessLevel >= 2;
      if (!mayFill) return res.status(403).json({ message: 'Only the assigned member can fill this shoot slot' });
      if (['approved', 'completed'].includes(slot.slot_status)) {
        return res.status(400).json({ message: `This slot is already ${slot.slot_status}` });
      }
    } else if (!(req.user.is_admin || req.userCanCreate || canApproveShoot(req))) {
      return res.status(403).json({ message: 'You do not have permission to create shoot requests' });
    }

    try {
      if (slotIdVal) {
        const fromPlan = await linkFromPlan(db, slotPlanId);
        link = await resolveShootLink(db, {
          project_id: fromPlan?.project_id ?? req.body.project_id,
          project_service_id: fromPlan?.project_service_id ?? req.body.project_service_id,
          cycle_id: fromPlan?.cycle_id ?? req.body.cycle_id,
        });
      } else {
        if (!toInt(req.body.project_id) || !toInt(req.body.project_service_id) || !toInt(req.body.cycle_id)) {
          return res.status(400).json({ message: 'Please select the project, service and cycle' });
        }
        link = await resolveShootLink(db, req.body);
        if (link.cycle && !['active', 'upcoming'].includes(link.cycle.status)) {
          return res.status(400).json({ message: `Cycle "${link.cycle.title}" is ${link.cycle.status}. Pick an active or upcoming cycle.` });
        }
      }
    } catch (e) {
      if (e instanceof LinkError) return res.status(400).json({ message: e.message });
      throw e;
    }
    const linkClientId = toInt(client_brand_id) || link.client_id;
    const linkName = toNull(project_campaign_name) || link.project_title;

    const crewP = photographers !== undefined ? crewToJson(photographers) : undefined;
    const crewV = videographers !== undefined ? crewToJson(videographers) : undefined;

    // ── Fill the existing placeholder for this slot (no duplicate) ──
    if (slotIdVal) {
      const [existing] = await db.query(
        'SELECT * FROM shoots WHERE calendar_slot_id = ? AND deleted = 0 ORDER BY id ASC LIMIT 1',
        [slotIdVal]
      );
      if (existing.length > 0) {
        const current = existing[0];
        if (['approved', 'pending_completion', 'completed'].includes(current.status)) {
          return res.status(400).json({ message: `This shoot is already ${current.status.replace('_', ' ')}` });
        }
        await db.query(
          `UPDATE shoots SET
            client_brand_id = COALESCE(?, client_brand_id),
            project_campaign_name = COALESCE(?, project_campaign_name),
            shoot_date = COALESCE(?, shoot_date),
            reporting_time = COALESCE(?, reporting_time),
            location_type = COALESCE(?, location_type),
            exact_address = ?, city = ?, maps_link = ?,
            photographers = COALESCE(?, photographers),
            videographers = COALESCE(?, videographers),
            shoot_manager_id = COALESCE(?, shoot_manager_id),
            approval_remarks = NULL,
            status = 'pending_approval'
          WHERE id = ?`,
          [
            linkClientId, linkName, toNull(shoot_date), toNull(reporting_time),
            toNull(location_type), toNull(exact_address), toNull(city), toNull(maps_link),
            crewP ?? null, crewV ?? null,
            toInt(shoot_manager_id),
            current.id,
          ]
        );
        await saveShootLink(current.id, link);
        await setSlotStatus(slotIdVal, 'submitted', uid);
        res.emitSocket('content-calendar:slot-submitted', { item_type: 'shoot', item_id: slotIdVal });
        await notifySlotAssigner(slotIdVal, uid, {
          type: 'slot_submitted', title: 'Shoot submitted for approval',
          message: 'Shoot details filled. Please review.', link: '/social/shoots',
        }, res);
        await logShootHistory(current.id, current.status === 'rejected' ? 'resubmit' : 'submit', null, uid);

        const updated = await fetchShootDetail(current.id);
        res.emitSocket('shoots:updated', updated);
        return res.status(201).json(updated);
      }
    }

    // ── New shoot ──
    const shoot_id_code = await generateShootCode(db, linkClientId, shoot_date);
    const [result] = await db.query(
      `INSERT INTO shoots
        (shoot_id_code, client_brand_id, project_campaign_name, shoot_date, reporting_time,
         location_type, exact_address, city, maps_link,
         photographers, videographers, shoot_manager_id,
         calendar_slot_id, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_approval', ?)`,
      [
        shoot_id_code,
        linkClientId, linkName, shoot_date, toNull(reporting_time),
        location_type, toNull(exact_address), toNull(city), toNull(maps_link),
        crewP ?? null, crewV ?? null,
        toInt(shoot_manager_id),
        slotIdVal,
        uid,
      ]
    );
    const insertId = result.insertId;
    await saveShootLink(insertId, link);

    if (slotIdVal) {
      try { await db.query('UPDATE content_calendar_shoots SET linked_shoot_ref_id = ? WHERE id = ?', [insertId, slotIdVal]); } catch (e) { /* ignore */ }
      await setSlotStatus(slotIdVal, 'submitted', uid);
      res.emitSocket('content-calendar:slot-submitted', { item_type: 'shoot', item_id: slotIdVal });
      await notifySlotAssigner(slotIdVal, uid, {
        type: 'slot_submitted', title: 'Shoot submitted for approval',
        message: 'Shoot details filled. Please review.', link: '/social/shoots',
      }, res);
    }
    await logShootHistory(insertId, 'submit', null, uid);

    const created = await fetchShootDetail(insertId);
    res.emitSocket('shoots:created', created);
    return res.status(201).json(created);
  } catch (err) {
    console.error('Shoots create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── UPDATE / CLOSE REQUEST ──────────────────────────────────────────────────
/**
 * PUT /api/shoots/:id
 *  - approved + post_start_time + post_end_time + in_summary (≥30 words) → Close Request (pending_completion)
 *  - draft / rejected edit → resubmit (pending_approval)
 *  - approved edit by a non-approver → needs re-approval (pending_approval)
 * Crew fields are only changed when sent.
 */
exports.update = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM shoots WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Shoot not found' });

    const shoot = rows[0];
    const uid = Number(req.user.id);
    const isAdmin = !!req.user.is_admin;
    const isCreator = Number(shoot.created_by) === uid;
    const approver = canApproveShoot(req);
    const crewIds = [Number(shoot.shoot_manager_id), ...parseIds(shoot.photographers), ...parseIds(shoot.videographers)];
    const isCrew = crewIds.includes(uid);

    const mayEdit = isAdmin || isCreator || approver || (req.userCanEdit && req.socialAccessLevel >= 2);
    const isCloseRequest = !!(req.body.post_start_time && req.body.post_end_time) && shoot.status === 'approved';
    // The shoot manager / crew may submit the close request even if they didn't create it
    if (!mayEdit && !(isCloseRequest && isCrew)) {
      return res.status(403).json({ message: 'You do not have permission to edit this shoot' });
    }
    if (!isAdmin && shoot.status === 'completed') {
      return res.status(403).json({ message: 'Cannot edit a completed shoot' });
    }
    if (!isAdmin && !canApproveClose(req) && shoot.status === 'pending_completion') {
      return res.status(403).json({ message: 'Cannot edit while the close request is waiting for approval' });
    }

    const allowed = [
      'client_brand_id', 'project_campaign_name', 'shoot_date', 'reporting_time',
      'location_type', 'exact_address', 'city', 'maps_link',
      'photographers', 'videographers', 'shoot_manager_id',
      'post_start_time', 'post_end_time', 'in_summary',
    ];
    const updates = {};
    allowed.forEach(f => {
      if (req.body[f] === undefined) return;
      if (f === 'photographers' || f === 'videographers') updates[f] = crewToJson(req.body[f]);
      else updates[f] = req.body[f] === '' ? null : req.body[f];
    });
    // Project ▸ Service ▸ Cycle — only for shoots not yet on the calendar
    // (calendar shoots inherit it from their plan).
    let newLink = null;
    const linkSent = ['project_id', 'project_service_id', 'cycle_id'].some(k => req.body[k] !== undefined);
    if (linkSent && !shoot.calendar_slot_id && !isCloseRequest) {
      try {
        newLink = await resolveShootLink(db, req.body);
      } catch (e) {
        if (e instanceof LinkError) return res.status(400).json({ message: e.message });
        throw e;
      }
      if (newLink.project_id && !newLink.cycle_id) {
        return res.status(400).json({ message: 'Please select the service and cycle' });
      }
      if (newLink.cycle && String(newLink.cycle_id) !== String(shoot.cycle_id) && !['active', 'upcoming'].includes(newLink.cycle.status)) {
        return res.status(400).json({ message: `Cycle "${newLink.cycle.title}" is ${newLink.cycle.status}. Pick an active or upcoming cycle.` });
      }
      if (newLink.client_id && req.body.client_brand_id === undefined) updates.client_brand_id = newLink.client_id;
    }

    if (Object.keys(updates).length === 0 && !newLink) {
      return res.status(400).json({ message: 'No valid fields to update' });
    }

    // Auto-calculate post duration
    if (req.body.post_start_time && req.body.post_end_time) {
      const [sh, sm] = String(req.body.post_start_time).split(':').map(Number);
      const [eh, em] = String(req.body.post_end_time).split(':').map(Number);
      const startMins = sh * 60 + sm;
      const endMins = eh * 60 + em;
      updates.post_duration_minutes = endMins >= startMins ? endMins - startMins : (24 * 60 - startMins) + endMins;
    }

    // ── Status transition ──
    let nextStatus = null;
    if (isCloseRequest) {
      const words = String(req.body.in_summary || '').trim().split(/\s+/).filter(Boolean).length;
      if (words < 30) return res.status(400).json({ message: 'In Summary must be at least 30 words' });
      nextStatus = 'pending_completion';
    } else if (['draft', 'rejected'].includes(shoot.status)) {
      nextStatus = 'pending_approval';
    } else if (shoot.status === 'approved' && !approver) {
      nextStatus = 'pending_approval';
    }
    if (nextStatus && nextStatus !== shoot.status) updates.status = nextStatus;
    if (updates.status === 'pending_approval') updates.approval_remarks = null;

    if (Object.keys(updates).length) {
      const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
      await db.query(`UPDATE shoots SET ${setClauses} WHERE id = ?`, [...Object.values(updates), req.params.id]);
    }
    if (newLink) await saveShootLink(shoot.id, newLink);

    if (updates.status === 'pending_completion') {
      try {
        await db.query('UPDATE shoots SET close_requested_by = ?, close_requested_at = NOW(), completion_remarks = NULL WHERE id = ?', [uid, req.params.id]);
      } catch (e) { /* columns not migrated yet */ }
      await logShootHistory(shoot.id, 'close_request', null, uid);
      // Tell whoever approved the shoot, and the slot's assigner
      await notifyUser(shoot.approved_by, uid, {
        type: 'shoot_close_requested', slot_id: shoot.calendar_slot_id,
        title: 'Shoot close request submitted',
        message: `${shoot.project_campaign_name || shoot.shoot_id_code}: close request is waiting for approval.`,
      }, res);
      await notifySlotAssigner(shoot.calendar_slot_id, uid, {
        type: 'shoot_close_requested', title: 'Shoot close request submitted',
        message: `${shoot.project_campaign_name || shoot.shoot_id_code}: close request is waiting for approval.`,
      }, res);
    } else if (updates.status === 'pending_approval') {
      await logShootHistory(shoot.id, shoot.status === 'draft' ? 'submit' : 'resubmit', null, uid);
      if (shoot.calendar_slot_id) {
        await setSlotStatus(shoot.calendar_slot_id, 'submitted', uid);
        res.emitSocket('content-calendar:slot-submitted', { item_type: 'shoot', item_id: shoot.calendar_slot_id });
        await notifySlotAssigner(shoot.calendar_slot_id, uid, {
          type: 'slot_submitted', title: 'Shoot submitted for approval',
          message: 'Shoot details updated. Please review.',
        }, res);
      }
    }

    const updated = await fetchShootDetail(req.params.id);
    res.emitSocket('shoots:updated', updated);
    return res.json(updated);
  } catch (err) {
    console.error('Shoots update error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── APPROVE / REJECT / REWORK ───────────────────────────────────────────────
/**
 * PUT /api/shoots/:id/approve   { action: 'approve' | 'reject' | 'rework', remarks, crew... }
 *  Stage 1 (pending_approval)   → Shoot Approval toggle
 *  Stage 2 (pending_completion) → Close Approval toggle
 *  Rework  (approved → rejected)→ Shoot Approval toggle
 */
exports.approve = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM shoots WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Shoot not found' });

    const shoot = rows[0];
    const uid = Number(req.user.id);
    const { action, photographers, videographers, shoot_manager_id } = req.body;
    const remarks = typeof req.body.remarks === 'string' ? req.body.remarks.trim() : '';
    const label = shoot.project_campaign_name || shoot.shoot_id_code || 'Shoot';

    if (!['approve', 'reject', 'rework'].includes(action)) {
      return res.status(400).json({ message: 'Action must be approve, reject, or rework' });
    }
    if (shoot.status === 'draft') {
      return res.status(400).json({ message: 'This shoot has not been filled in yet' });
    }

    // ── Rework: send an approved shoot back for re-editing ──
    if (action === 'rework') {
      if (!canApproveShoot(req)) {
        return res.status(403).json({ message: 'Only users with Shoot Approval permission can request re-work' });
      }
      if (shoot.status !== 'approved') {
        return res.status(400).json({ message: 'Only approved shoots can be sent back for re-work' });
      }
      const reason = remarks || 'Re-work requested. Please update and resubmit.';
      await db.query(`UPDATE shoots SET status = 'rejected', approval_remarks = ? WHERE id = ?`, [reason, shoot.id]);
      await logShootHistory(shoot.id, 'rework', reason, uid);
      await setSlotStatus(shoot.calendar_slot_id, 'rejected', uid, reason);
      await notifyUser(shoot.created_by, uid, {
        type: 'shoot_rework', slot_id: shoot.calendar_slot_id,
        title: 'Re-work requested for your shoot', message: `${label}: ${reason}`,
      }, res);
      if (shoot.calendar_slot_id) res.emitSocket('content-calendar:updated', { slot_id: shoot.calendar_slot_id });
    }
    // ── Stage 1: shoot request ──
    else if (shoot.status === 'pending_approval') {
      if (!canApproveShoot(req)) {
        return res.status(403).json({ message: 'Only users with Shoot Approval permission can approve or reject shoot requests' });
      }
      if (action === 'reject' && !remarks) {
        return res.status(400).json({ message: 'Please give a reason for rejecting' });
      }
      const newStatus = action === 'approve' ? 'approved' : 'rejected';

      // Approver may (re)assign the crew in the same step
      const collabSet = [];
      const collabVals = [];
      if (action === 'approve') {
        if (shoot_manager_id !== undefined) { collabSet.push('shoot_manager_id = ?'); collabVals.push(toInt(shoot_manager_id)); }
        if (photographers !== undefined) { collabSet.push('photographers = ?'); collabVals.push(crewToJson(photographers)); }
        if (videographers !== undefined) { collabSet.push('videographers = ?'); collabVals.push(crewToJson(videographers)); }
      }
      await db.query(
        `UPDATE shoots SET status = ?, approved_by = ?, approved_at = NOW(), approval_remarks = ?${collabSet.length ? ', ' + collabSet.join(', ') : ''} WHERE id = ?`,
        [newStatus, action === 'approve' ? uid : null, remarks || null, ...collabVals, shoot.id]
      );
      await logShootHistory(shoot.id, action === 'approve' ? 'approve' : 'reject', remarks, uid);

      if (shoot.calendar_slot_id) {
        await setSlotStatus(shoot.calendar_slot_id, action === 'approve' ? 'approved' : 'rejected', uid, remarks);
        res.emitSocket('content-calendar:updated', { slot_id: shoot.calendar_slot_id });
      } else if (action === 'approve') {
        const newSlotId = await ensureCalendarSlotForDirectShoot(shoot, uid);
        if (newSlotId) res.emitSocket('content-calendar:updated', { slot_id: newSlotId });
      }
      await notifyUser(shoot.created_by, uid, action === 'approve'
        ? { type: 'shoot_approved', slot_id: shoot.calendar_slot_id, title: 'Your shoot was approved', message: `${label} is approved.` }
        : { type: 'shoot_rejected', slot_id: shoot.calendar_slot_id, title: 'Your shoot was rejected', message: `${label}: ${remarks}` }, res);

      // Tell the crew they're on this shoot and where to punch (Content Calendar)
      if (action === 'approve') {
        const fresh = (await db.query('SELECT shoot_manager_id, photographers, videographers, shoot_date, calendar_slot_id FROM shoots WHERE id = ?', [shoot.id]))[0][0] || {};
        const crew = new Set([
          Number(fresh.shoot_manager_id),
          ...parseIds(fresh.photographers),
          ...parseIds(fresh.videographers),
        ].filter(n => n && n !== Number(shoot.created_by)));
        const dateStr = fresh.shoot_date
          ? new Date(fresh.shoot_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
          : 'the scheduled date';
        for (const memberId of crew) {
          await notifyUser(memberId, uid, {
            type: 'shoot_crew_assigned',
            slot_id: fresh.calendar_slot_id || null,
            title: 'You are on a shoot crew',
            message: `${shoot.shoot_id_code || label} on ${dateStr}. Open it on the Content Calendar to punch in on the day.`,
            link: '/social/content-calendar',
          }, res);
        }
      }
    }
    // ── Stage 2: close request ──
    else if (shoot.status === 'pending_completion') {
      if (!canApproveClose(req)) {
        return res.status(403).json({ message: 'Only users with Close Approval permission can review close requests' });
      }
      if (action === 'rework') {
        return res.status(400).json({ message: 'Use Reject to send a close request back' });
      }
      if (action === 'reject' && !remarks) {
        return res.status(400).json({ message: 'Please give a reason for sending the close request back' });
      }
      if (action === 'approve') {
        await db.query(
          `UPDATE shoots SET status = 'completed', completion_approved_by = ?, completion_approved_at = NOW(), completion_remarks = ? WHERE id = ?`,
          [uid, remarks || null, shoot.id]
        );
        await setSlotStatus(shoot.calendar_slot_id, 'completed', uid);
        if (shoot.calendar_slot_id) res.emitSocket('content-calendar:slot-completed', { item_type: 'shoot', item_id: shoot.calendar_slot_id });
      } else {
        await db.query(`UPDATE shoots SET status = 'approved', completion_remarks = ? WHERE id = ?`, [remarks, shoot.id]);
      }
      await logShootHistory(shoot.id, action === 'approve' ? 'close_approve' : 'close_reject', remarks, uid);
      const submitter = shoot.close_requested_by || shoot.created_by;
      await notifyUser(submitter, uid, action === 'approve'
        ? { type: 'shoot_close_approved', slot_id: shoot.calendar_slot_id, title: 'Shoot close request approved', message: `${label} is now completed.` }
        : { type: 'shoot_close_rejected', slot_id: shoot.calendar_slot_id, title: 'Shoot close request sent back', message: `${label}: ${remarks}` }, res);
    } else {
      return res.status(400).json({ message: `Cannot ${action} a shoot with status "${shoot.status}"` });
    }

    const updated = await fetchShootDetail(shoot.id);
    res.emitSocket('shoots:updated', updated);
    return res.json(updated);
  } catch (err) {
    console.error('Shoots approve error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── FOOTAGE ─────────────────────────────────────────────────────────────────
/**
 * PUT /api/shoots/:id/footage   { footage_drive_link, shoot_statement }
 * Crew, creator, approvers or SMM leads record where the footage is stored.
 */
exports.updateFootage = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM shoots WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Shoot not found' });
    const shoot = rows[0];
    const uid = Number(req.user.id);

    const isTeam = getShootCollaboratorIds(shoot).has(uid);
    if (!(isTeam || canSeeAllShoots(req))) {
      return res.status(403).json({ message: 'Only the shoot team can update footage details' });
    }
    if (!['approved', 'pending_completion', 'completed'].includes(shoot.status)) {
      return res.status(400).json({ message: 'Footage can be added once the shoot is approved' });
    }

    const link = typeof req.body.footage_drive_link === 'string' ? req.body.footage_drive_link.trim() : '';
    const statement = typeof req.body.shoot_statement === 'string' ? req.body.shoot_statement.trim() : '';
    if (link.length > 2000) return res.status(400).json({ message: 'Drive link is too long' });

    await db.query(
      `UPDATE shoots SET footage_drive_link = ?, shoot_statement = ?, footage_updated_by = ?, footage_updated_at = NOW() WHERE id = ?`,
      [link || null, statement || null, uid, shoot.id]
    );

    const updated = await fetchShootDetail(shoot.id);
    res.emitSocket('shoots:updated', updated);
    return res.json(updated);
  } catch (err) {
    console.error('Shoots footage error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ─── DELETE (soft) ───────────────────────────────────────────────────────────
exports.remove = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM shoots WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Shoot not found' });
    const shoot = rows[0];

    const isCreator = Number(shoot.created_by) === Number(req.user.id);
    const closed = ['pending_completion', 'completed'].includes(shoot.status);
    const mayDelete = req.user.is_admin
      || (!closed && isCreator && ['draft', 'pending_approval', 'rejected'].includes(shoot.status))
      || (!closed && req.userCanDelete);
    if (!mayDelete) {
      return res.status(403).json({
        message: closed ? 'Closed shoots can only be deleted by an admin' : 'You do not have permission to delete this shoot',
      });
    }

    await db.query('UPDATE shoots SET deleted = 1 WHERE id = ?', [shoot.id]);
    await logShootHistory(shoot.id, 'reject', 'Deleted', req.user.id);

    // Free the calendar slot so it can be filled again
    if (shoot.calendar_slot_id && shoot.status !== 'completed') {
      await setSlotStatus(shoot.calendar_slot_id, 'assigned', req.user.id);
      res.emitSocket('content-calendar:updated', { slot_id: shoot.calendar_slot_id });
    }

    res.emitSocket('shoots:deleted', { id: shoot.id });
    return res.json({ message: 'Shoot deleted' });
  } catch (err) {
    console.error('Shoots delete error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// SHOOT PUNCH (clock in/out on a shoot — counts as productive time)
// ───────────────────────────────────────────────────────────────────────────────
// Authorization is by COLLABORATOR MEMBERSHIP, not module access: a user who is
// the shoot manager, a photographer, a videographer, the creator, or an admin may
// punch — even with zero Shoots/Calendar access. This lets collaborators who only
// have Calendar access (or neither) still log shoot time. Mirrors the task timer
// pattern (task_active_timers / task_time_logs) so punched time feeds the same
// productive-time aggregation used across attendance.
// ═══════════════════════════════════════════════════════════════════════════════

// Returns the set of user IDs allowed to punch a given shoot row.
function getShootCollaboratorIds(shoot) {
  const ids = new Set();
  if (shoot.created_by) ids.add(Number(shoot.created_by));
  if (shoot.shoot_manager_id) ids.add(Number(shoot.shoot_manager_id));
  const parseArr = (v) => {
    if (!v) return [];
    try { return (typeof v === 'string' ? JSON.parse(v) : v) || []; }
    catch { return []; }
  };
  parseArr(shoot.photographers).forEach(id => ids.add(Number(id)));
  parseArr(shoot.videographers).forEach(id => ids.add(Number(id)));
  return ids;
}

async function userMayPunchShoot(user, shoot) {
  if (user.is_admin) return true;
  return getShootCollaboratorIds(shoot).has(Number(user.id));
}

/**
 * POST /api/shoots/:id/punch-in
 * Start a punch on this shoot for the current user.
 */
exports.punchIn = async (req, res) => {
  try {
    const userId = req.user.id;
    const [rows] = await db.query('SELECT * FROM shoots WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Shoot not found' });
    const shoot = rows[0];

    // Collaborator-only (independent of module access)
    if (!(await userMayPunchShoot(req.user, shoot))) {
      return res.status(403).json({ message: 'Only the shoot team (manager, photographers, videographers) can punch this shoot' });
    }

    // Shoot must be approved and not yet completed to punch
    if (!['approved', 'pending_completion'].includes(shoot.status)) {
      return res.status(400).json({ message: `Can only punch an approved shoot. Current status: "${shoot.status}"` });
    }

    // ── Must be clocked in for the day ───────────────────────────────────────
    const [attendance] = await db.query(
      `SELECT id, clock_in, clock_out FROM attendance
       WHERE user_id = ? AND date = CURDATE() ORDER BY id DESC LIMIT 1`,
      [userId]
    );
    if (attendance.length === 0 || !attendance[0].clock_in) {
      return res.status(400).json({ message: 'You must clock in before punching a shoot' });
    }
    if (attendance[0].clock_out) {
      return res.status(400).json({ message: 'You have already clocked out. Cannot punch a shoot after clock out.' });
    }

    // ── Block during AFS ─────────────────────────────────────────────────────
    const [activeAfs] = await db.query(
      'SELECT id FROM afs_logs WHERE user_id = ? AND end_time IS NULL LIMIT 1',
      [userId]
    );
    if (activeAfs.length > 0) {
      return res.status(400).json({ message: 'Cannot punch while AFS is active. End your AFS break first.' });
    }

    // Already punched into THIS shoot?
    const [existing] = await db.query(
      'SELECT 1 FROM shoot_active_timers WHERE shoot_id = ? AND user_id = ?',
      [shoot.id, userId]
    );
    if (existing.length > 0) {
      return res.status(400).json({ message: 'You are already punched into this shoot' });
    }

    // ── One active timer per user across tasks / tickets / meetings / shoots ──
    const [runningTask] = await db.query(
      `SELECT tat.task_id AS id, t.title FROM task_active_timers tat JOIN tasks t ON t.id = tat.task_id WHERE tat.user_id = ? LIMIT 1`,
      [userId]
    );
    if (runningTask.length > 0) {
      return res.status(400).json({ message: `You have a timer running on task "${runningTask[0].title}". Stop it before punching a shoot.` });
    }
    const [runningTicket] = await db.query(
      `SELECT tat.ticket_id AS id, tk.title FROM ticket_active_timers tat JOIN tickets tk ON tk.id = tat.ticket_id WHERE tat.user_id = ? LIMIT 1`,
      [userId]
    );
    if (runningTicket.length > 0) {
      return res.status(400).json({ message: `You have a timer running on ticket "${runningTicket[0].title}". Stop it before punching a shoot.` });
    }
    const [runningMeeting] = await db.query(
      `SELECT mat.meeting_id AS id, m.title FROM meeting_active_timers mat JOIN meetings m ON m.id = mat.meeting_id WHERE mat.user_id = ? LIMIT 1`,
      [userId]
    );
    if (runningMeeting.length > 0) {
      return res.status(400).json({ message: `You have a timer running on meeting "${runningMeeting[0].title}". Stop it before punching a shoot.` });
    }
    const [runningShoot] = await db.query(
      `SELECT sat.shoot_id AS id, s.shoot_id_code FROM shoot_active_timers sat JOIN shoots s ON s.id = sat.shoot_id WHERE sat.user_id = ? AND sat.shoot_id != ? LIMIT 1`,
      [userId, shoot.id]
    );
    if (runningShoot.length > 0) {
      return res.status(400).json({ message: `You are already punched into shoot "${runningShoot[0].shoot_id_code}". Punch out first.` });
    }

    const now = new Date();
    await db.query(
      'INSERT INTO shoot_active_timers (shoot_id, user_id, started_at) VALUES (?, ?, ?)',
      [shoot.id, userId, now]
    );

    res.emitSocket('shoots:punch-in', { shoot_id: shoot.id, user_id: userId, started_at: now });
    return res.json({ message: 'Punched in', shoot_id: shoot.id, started_at: now });
  } catch (err) {
    console.error('Shoot punch-in error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * POST /api/shoots/:id/punch-out
 * Stop the current user's punch on this shoot and log the session.
 */
exports.punchOut = async (req, res) => {
  try {
    const userId = req.user.id;
    const [rows] = await db.query('SELECT * FROM shoots WHERE id = ? AND deleted = 0', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ message: 'Shoot not found' });
    const shoot = rows[0];

    const [active] = await db.query(
      'SELECT * FROM shoot_active_timers WHERE shoot_id = ? AND user_id = ?',
      [shoot.id, userId]
    );
    if (active.length === 0) {
      return res.status(400).json({ message: 'You are not punched into this shoot' });
    }

    const timer = active[0];
    const now = new Date();
    const startedAt = new Date(timer.started_at);
    const duration = Math.max(1, Math.floor((now - startedAt) / 1000));
    const note = req.body.note || null;

    await db.query(
      `INSERT INTO shoot_time_logs (shoot_id, user_id, started_at, ended_at, duration, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [shoot.id, userId, startedAt, now, duration, note]
    );
    await db.query(
      'DELETE FROM shoot_active_timers WHERE shoot_id = ? AND user_id = ?',
      [shoot.id, userId]
    );

    res.emitSocket('shoots:punch-out', { shoot_id: shoot.id, user_id: userId, duration });
    return res.json({ message: 'Punched out', shoot_id: shoot.id, duration });
  } catch (err) {
    console.error('Shoot punch-out error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * GET /api/shoots/:id/punch-status
 * Returns whether the current user is punched in, and per-user totals for this shoot.
 */
exports.punchStatus = async (req, res) => {
  try {
    const userId = req.user.id;
    const shootId = req.params.id;

    const [active] = await db.query(
      'SELECT started_at FROM shoot_active_timers WHERE shoot_id = ? AND user_id = ?',
      [shootId, userId]
    );
    const [logged] = await db.query(
      'SELECT COALESCE(SUM(duration), 0) AS total FROM shoot_time_logs WHERE shoot_id = ? AND user_id = ?',
      [shootId, userId]
    );

    return res.json({
      is_punched_in: active.length > 0,
      started_at: active.length > 0 ? active[0].started_at : null,
      my_total_seconds: parseInt(logged[0].total) || 0,
    });
  } catch (err) {
    console.error('Shoot punch-status error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};
