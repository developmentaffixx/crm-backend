/**
 * Contents (content writing) — /api/content-write
 * All status changes go through helpers/contentWorkflow.js (shared with the
 * Content Calendar), so the page and the calendar can't disagree.
 * Content is only created from Content Calendar post slots.
 */
const db = require('../config/db');
const wf = require('../helpers/contentWorkflow');

const toInt = (v) => { const n = parseInt(v, 10); return Number.isNaN(n) ? null : n; };

// ─── Schema capability cache (columns added by migrations) ───────────────────
const colCache = {};
async function hasColumn(column) {
  if (colCache[column] !== undefined) return colCache[column];
  try {
    const [r] = await db.query(
      `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'content_write_requests' AND COLUMN_NAME = ?`,
      [column]
    );
    colCache[column] = r.length > 0;
  } catch { colCache[column] = false; }
  return colCache[column];
}

const send = (res, err) => {
  if (err instanceof wf.WorkflowError) return res.status(err.status).json({ message: err.message });
  console.error('Contents error:', err);
  return res.status(500).json({ message: 'Server error' });
};

/** Visibility: all rows for approvers / "All" access, else rows you write or created. */
function scopeClause(req) {
  if (wf.canSeeAllContent(req)) return { sql: '', params: [] };
  return { sql: ' AND (cwr.created_by = ? OR ccp.assigned_to = ?)', params: [req.user.id, req.user.id] };
}

async function canView(req, row, slot) {
  if (wf.canSeeAllContent(req)) return true;
  const uid = Number(req.user.id);
  return Number(row.created_by) === uid || Number(slot?.assigned_to) === uid;
}

// ─── Shared SELECT ───────────────────────────────────────────────────────────
async function selectParts() {
  const hasPosting = await hasColumn('posting_date');
  const hasLink = await hasColumn('cycle_id');
  const hasTrail = await hasColumn('smm_reviewed_by');
  const postingExpr = hasPosting ? 'COALESCE(cwr.posting_date, ccp.posting_date)' : 'ccp.posting_date';
  const cycleExpr = hasLink ? 'COALESCE(cwr.cycle_id, ccpl.cycle_id)' : 'ccpl.cycle_id';
  const serviceExpr = hasLink ? 'COALESCE(cwr.project_service_id, sc.project_service_id)' : 'sc.project_service_id';
  return {
    postingExpr, cycleExpr, serviceExpr,
    select: `SELECT cwr.*,
        l.business_name AS client_brand_name,
        p.title AS project_title,
        CONCAT(uc.first_name, ' ', uc.last_name) AS created_by_name,
        CONCAT(ua.first_name, ' ', ua.last_name) AS approved_by_name,
        CONCAT(uas.first_name, ' ', uas.last_name) AS assigned_to_name,
        ${hasTrail ? `CONCAT(us.first_name, ' ', us.last_name) AS smm_reviewed_by_name,
        CONCAT(ur.first_name, ' ', ur.last_name) AS returned_by_name,
        CONCAT(ud.first_name, ' ', ud.last_name) AS completed_by_name,` : ''}
        ccp.id AS slot_id, ccp.slot_status, ccp.assigned_to AS slot_assigned_to, ccp.assigned_by AS slot_assigned_by,
        ccp.posting_date AS slot_posting_date, ccp.topic AS slot_topic, ccp.format AS slot_format, ccp.platform AS slot_platform,
        ccp.rejection_reason AS slot_rejection_reason,
        ${postingExpr} AS effective_posting_date,
        COALESCE(cwr.content_type, ccp.format) AS content_type,
        ${cycleExpr} AS cycle_id_resolved,
        ${serviceExpr} AS project_service_id_resolved,
        sc.title AS cycle_title, sc.status AS cycle_status, sc.start_date AS cycle_start_date, sc.end_date AS cycle_end_date,
        sv.name AS service_name,
        ccpl.shared_with_client AS plan_shared_with_client`,
    from: `FROM content_write_requests cwr
        LEFT JOIN content_calendar_posts ccp ON ccp.id = cwr.calendar_slot_id
        LEFT JOIN content_calendar_plans ccpl ON ccpl.id = ccp.plan_id
        LEFT JOIN service_cycles sc ON sc.id = ${cycleExpr}
        LEFT JOIN project_services ps ON ps.id = ${serviceExpr}
        LEFT JOIN services sv ON sv.id = ps.service_id
        LEFT JOIN leads l ON l.id = cwr.client_brand_id
        LEFT JOIN projects p ON p.id = cwr.project_id
        LEFT JOIN users uc ON uc.id = cwr.created_by
        LEFT JOIN users ua ON ua.id = cwr.approved_by
        LEFT JOIN users uas ON uas.id = ccp.assigned_to
        ${hasTrail ? `LEFT JOIN users us ON us.id = cwr.smm_reviewed_by
        LEFT JOIN users ur ON ur.id = cwr.returned_by
        LEFT JOIN users ud ON ud.id = cwr.completed_by` : ''}`,
  };
}

// ─── LIST ────────────────────────────────────────────────────────────────────
/**
 * GET /api/content-write?search=&status=&project_id=&project_service_id=&cycle_id=&sort=&page=&limit=
 * Server-side filters + pagination. `summary` = counts per status for the same
 * scope / search / project filters, ignoring the status tab.
 */
exports.list = async (req, res) => {
  try {
    const { status, search, sort } = req.query;
    const pageNum = Math.max(1, toInt(req.query.page) || 1);
    const limitNum = Math.min(200, Math.max(1, toInt(req.query.limit) || 20));
    const parts = await selectParts();

    let where = 'cwr.deleted = 0';
    const params = [];
    const term = typeof search === 'string' ? search.trim() : '';
    if (term) {
      const like = `%${term}%`;
      where += ` AND (cwr.content_id_code LIKE ? OR cwr.hook_opening_line LIKE ? OR cwr.core_message LIKE ?
                 OR cwr.caption_content LIKE ? OR l.business_name LIKE ? OR p.title LIKE ?
                 OR CONCAT(uas.first_name, ' ', uas.last_name) LIKE ? OR CONCAT(uc.first_name, ' ', uc.last_name) LIKE ?)`;
      params.push(like, like, like, like, like, like, like, like);
    }
    const projectId = toInt(req.query.project_id);
    const serviceId = toInt(req.query.project_service_id);
    const cycleId = toInt(req.query.cycle_id);
    if (projectId) { where += ' AND cwr.project_id = ?'; params.push(projectId); }
    if (serviceId) { where += ` AND ${parts.serviceExpr} = ?`; params.push(serviceId); }
    if (cycleId) { where += ` AND ${parts.cycleExpr} = ?`; params.push(cycleId); }
    const scope = scopeClause(req);
    where += scope.sql;
    params.push(...scope.params);

    let listWhere = where;
    const listParams = [...params];
    if (status) {
      // "pending" tab also shows legacy in_progress rows
      if (status === 'pending') listWhere += " AND cwr.status IN ('pending','in_progress')";
      else { listWhere += ' AND cwr.status = ?'; listParams.push(status); }
    }

    let orderBy = 'cwr.created_at DESC, cwr.id DESC';
    if (sort === 'posting_date_asc') orderBy = `(${parts.postingExpr} IS NULL) ASC, ${parts.postingExpr} ASC, cwr.id DESC`;
    else if (sort === 'posting_date_desc') orderBy = `(${parts.postingExpr} IS NULL) ASC, ${parts.postingExpr} DESC, cwr.id DESC`;
    else if (sort === 'oldest') orderBy = 'cwr.created_at ASC, cwr.id ASC';

    const [rows] = await db.query(
      `${parts.select} ${parts.from} WHERE ${listWhere} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      [...listParams, limitNum, (pageNum - 1) * limitNum]
    );
    const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total ${parts.from} WHERE ${listWhere}`, listParams);
    const [counts] = await db.query(`SELECT cwr.status, COUNT(*) AS count ${parts.from} WHERE ${where} GROUP BY cwr.status`, params);

    const summary = { total: 0, draft: 0, pending: 0, smm_reviewed: 0, approved: 0, rejected: 0, completed: 0 };
    counts.forEach(r => {
      const key = r.status === 'in_progress' ? 'pending' : r.status;
      summary[key] = (summary[key] || 0) + (Number(r.count) || 0);
      summary.total += Number(r.count) || 0;
    });

    return res.json({ requests: rows, summary, total: Number(total) || 0, page: pageNum, limit: limitNum });
  } catch (err) {
    return send(res, err);
  }
};

// ─── DETAIL ──────────────────────────────────────────────────────────────────
async function loadDetail(id) {
  const parts = await selectParts();
  const [rows] = await db.query(`${parts.select} ${parts.from} WHERE cwr.id = ? AND cwr.deleted = 0`, [id]);
  return rows[0] || null;
}

async function loadHistory(id) {
  try {
    const [h] = await db.query(
      `SELECT h.action, h.remarks, h.created_at, CONCAT(u.first_name, ' ', u.last_name) AS acted_by_name
       FROM smm_approval_history h LEFT JOIN users u ON u.id = h.acted_by
       WHERE h.module = 'content_write' AND h.record_id = ?
       ORDER BY h.created_at ASC, h.id ASC`,
      [id]
    );
    return h;
  } catch (e) {
    console.warn('Content history load failed:', e.message);
    return [];
  }
}

exports.getOne = async (req, res) => {
  try {
    const row = await loadDetail(req.params.id);
    if (!row) return res.status(404).json({ message: 'Content not found' });
    if (!(await canView(req, row, { assigned_to: row.slot_assigned_to }))) {
      return res.status(403).json({ message: 'Access denied' });
    }
    row.history = await loadHistory(row.id);
    return res.json(row);
  } catch (err) {
    return send(res, err);
  }
};

exports.getHistory = async (req, res) => {
  try {
    const row = await loadDetail(req.params.id);
    if (!row) return res.status(404).json({ message: 'Content not found' });
    if (!(await canView(req, row, { assigned_to: row.slot_assigned_to }))) {
      return res.status(403).json({ message: 'Access denied' });
    }
    // Newest first (legacy consumers)
    return res.json((await loadHistory(row.id)).reverse());
  } catch (err) {
    return send(res, err);
  }
};

// ─── OPEN A SLOT (Fill Content) ──────────────────────────────────────────────
/**
 * POST /api/content-write/slot/:slotId/open
 * Returns the slot's content row (creating the Draft for old slots). Assignee or admin.
 */
exports.openSlot = async (req, res) => {
  try {
    const slotId = toInt(req.params.slotId);
    const [s] = await db.query('SELECT * FROM content_calendar_posts WHERE id = ?', [slotId]);
    if (!s.length) return res.status(404).json({ message: 'Calendar post slot not found' });
    const slot = s[0];
    const uid = Number(req.user.id);
    const isAssignee = Number(slot.assigned_to) === uid;
    if (!req.user.is_admin && !isAssignee && !wf.canSeeAllContent(req)) {
      return res.status(403).json({ message: 'Only the assigned writer can open this post' });
    }
    if (!slot.assigned_to) return res.status(400).json({ message: 'Assign this post slot on the Content Calendar first' });

    const row = await wf.ensureRowForSlot(slotId, uid);
    const detail = await loadDetail(row.id);
    detail.history = await loadHistory(row.id);
    return res.json(detail);
  } catch (err) {
    return send(res, err);
  }
};

// ─── SAVE FIELDS ─────────────────────────────────────────────────────────────

/** Write content fields from a request body. Returns true if anything changed. */
async function saveFields(rowId, body, { autosave = false } = {}) {
  const sets = [];
  const vals = [];
  wf.CONTENT_FIELDS.forEach(f => {
    if (body[f] === undefined) return;
    if (f === 'content_type' && !body[f]) return; // never blank the type
    sets.push(`${f} = ?`);
    vals.push(body[f] === '' ? null : body[f]);
  });
  if (body.posting_date !== undefined && (await hasColumn('posting_date'))) {
    sets.push('posting_date = ?');
    vals.push(body.posting_date || null);
  }
  if (autosave && (await hasColumn('draft_saved_at'))) sets.push('draft_saved_at = NOW()');
  if (!sets.length) return false;
  await db.query(`UPDATE content_write_requests SET ${sets.join(', ')} WHERE id = ?`, [...vals, rowId]);
  return true;
}

async function loadForWrite(req, id) {
  const row = await wf.getRow(db, id);
  if (!row) throw new wf.WorkflowError(404, 'Content not found');
  const slot = await wf.slotForRow(db, row);
  const uid = Number(req.user.id);
  const isWriter = !!req.user.is_admin || wf.assigneeOf(row, slot) === uid;
  return { row, slot, isWriter };
}

/**
 * PUT /api/content-write/:id/draft — autosave (no status change).
 * Writer only, while Draft / Pending (not yet reviewed) / Rejected.
 */
exports.saveDraft = async (req, res) => {
  try {
    const { row, isWriter } = await loadForWrite(req, req.params.id);
    if (!isWriter) return res.status(403).json({ message: 'Only the assigned writer can edit this content' });
    if (!['draft', 'pending', 'rejected', 'in_progress'].includes(row.status)) {
      return res.status(400).json({ message: 'Autosave is only available before the content is reviewed' });
    }
    await saveFields(row.id, req.body, { autosave: true });
    return res.json({ id: row.id, status: row.status, saved_at: new Date().toISOString() });
  } catch (err) {
    return send(res, err);
  }
};

/**
 * POST /api/content-write/:id/submit — save fields (optional) and submit for approval.
 * Writer only. Draft / Rejected / Pending / Approved (re-edit) → Pending Approval.
 */
exports.submit = async (req, res) => {
  try {
    const { row, isWriter } = await loadForWrite(req, req.params.id);
    if (!isWriter) return res.status(403).json({ message: 'Only the assigned writer can submit this content' });
    if (row.status === 'smm_reviewed') {
      return res.status(400).json({ message: 'SMM has already reviewed this. Ask a PC/PM approver to send it back if it needs changes.' });
    }
    if (row.status === 'completed') return res.status(400).json({ message: 'Completed content can no longer be edited' });
    await saveFields(row.id, req.body);
    await wf.transition(req, res, row.id, 'submit');
    return res.json(await loadDetail(row.id));
  } catch (err) {
    return send(res, err);
  }
};

/**
 * PUT /api/content-write/:id — edit.
 *  - Writer: save + (re)submit for approval
 *  - PC/PM approver (not the writer): save only, status unchanged (e.g. small fixes before approving)
 */
exports.update = async (req, res) => {
  try {
    const { row, isWriter } = await loadForWrite(req, req.params.id);
    if (row.status === 'completed' && !req.user.is_admin) {
      return res.status(400).json({ message: 'Completed content can no longer be edited' });
    }
    if (isWriter && !wf.canPcpmApprove(req)) return exports.submit(req, res);
    if (!isWriter && !wf.canPcpmApprove(req)) {
      return res.status(403).json({ message: 'Only the assigned writer or a PC/PM approver can edit this content' });
    }
    await saveFields(row.id, req.body);
    if (isWriter && ['draft', 'rejected'].includes(row.status)) await wf.transition(req, res, row.id, 'submit');
    const updated = await loadDetail(row.id);
    res.emitSocket('content-write:updated', updated);
    return res.json(updated);
  } catch (err) {
    return send(res, err);
  }
};

/**
 * POST /api/content-write  (legacy) — fill a calendar slot.
 * Content can only be created from Content Calendar post slots.
 */
exports.create = async (req, res) => {
  try {
    const slotId = toInt(req.body.calendar_slot_id);
    if (!slotId) {
      return res.status(400).json({ message: 'Content is created from Content Calendar post slots. Open it from Assigned Slots.' });
    }
    const [s] = await db.query('SELECT * FROM content_calendar_posts WHERE id = ?', [slotId]);
    if (!s.length) return res.status(404).json({ message: 'Calendar post slot not found' });
    if (!req.user.is_admin && Number(s[0].assigned_to) !== Number(req.user.id)) {
      return res.status(403).json({ message: 'Only the assigned writer can fill this post' });
    }
    const row = await wf.ensureRowForSlot(slotId, req.user.id);
    req.params.id = row.id;
    return exports.submit(req, res);
  } catch (err) {
    return send(res, err);
  }
};

// ─── REVIEW / DONE / REOPEN ──────────────────────────────────────────────────
/**
 * POST /api/content-write/:id/review  { action: 'smm_accept' | 'approve' | 'send_back', remarks }
 */
exports.review = async (req, res) => {
  try {
    const { action } = req.body;
    if (!['smm_accept', 'approve', 'send_back'].includes(action)) {
      return res.status(400).json({ message: "action must be 'smm_accept', 'approve' or 'send_back'" });
    }
    await wf.transition(req, res, toInt(req.params.id), action, { reason: req.body.remarks });
    return res.json(await loadDetail(req.params.id));
  } catch (err) {
    return send(res, err);
  }
};

/**
 * PUT /api/content-write/:id/approve  (legacy) { action: 'approve' | 'reject', admin_remarks }
 * approve → PC/PM approve (or SMM accept if you only hold SMM Review); reject → send back.
 */
exports.approve = async (req, res) => {
  try {
    const action = req.body.action === 'approve'
      ? (wf.canPcpmApprove(req) ? 'approve' : 'smm_accept')
      : 'send_back';
    await wf.transition(req, res, toInt(req.params.id), action, { reason: req.body.admin_remarks || req.body.remarks });
    return res.json(await loadDetail(req.params.id));
  } catch (err) {
    return send(res, err);
  }
};

/** POST /api/content-write/:id/complete — Mark as Done (approved → completed). */
exports.complete = async (req, res) => {
  try {
    await wf.transition(req, res, toInt(req.params.id), 'complete');
    return res.json(await loadDetail(req.params.id));
  } catch (err) {
    return send(res, err);
  }
};

/** POST /api/content-write/:id/remodify — writer reopens approved content. */
exports.remodify = async (req, res) => {
  try {
    const detail = await loadDetail(req.params.id);
    if (!detail) return res.status(404).json({ message: 'Content not found' });
    if (detail.plan_shared_with_client) {
      return res.status(400).json({ message: 'This calendar has already been shared with the client' });
    }
    await wf.transition(req, res, detail.id, 'remodify', { reason: req.body.reason });
    return res.json(await loadDetail(detail.id));
  } catch (err) {
    return send(res, err);
  }
};

// ─── DELETE (admin) ──────────────────────────────────────────────────────────
/**
 * DELETE /api/content-write/:id — admin only. Soft-deletes the content and
 * frees its calendar slot (back to 'assigned', or 'open' if unassigned).
 */
exports.remove = async (req, res) => {
  try {
    if (!req.user.is_admin) return res.status(403).json({ message: 'Only an admin can delete content' });
    const row = await wf.getRow(db, req.params.id);
    if (!row) return res.status(404).json({ message: 'Content not found' });
    const slot = await wf.slotForRow(db, row);

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('UPDATE content_write_requests SET deleted = 1 WHERE id = ?', [row.id]);
      if (slot && slot.slot_status !== 'completed') {
        await conn.query(
          `UPDATE content_calendar_posts
           SET slot_status = IF(assigned_to IS NULL, 'open', 'assigned'),
               linked_write_id = IF(linked_write_id = ?, NULL, linked_write_id),
               linked_brief_id = IF(linked_brief_id = ?, NULL, linked_brief_id),
               approved_at = NULL, approved_by = NULL, smm_approved_at = NULL, smm_approved_by = NULL,
               rejection_reason = NULL
           WHERE id = ?`,
          [row.id, row.id, slot.id]
        );
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }

    await wf.logHistory(row.id, 'reject', 'Deleted by admin', req.user.id);
    res.emitSocket('content-write:deleted', { id: row.id });
    if (slot) res.emitSocket('content-calendar:updated', { item_type: 'post', item_id: slot.id });
    return res.json({ message: 'Content deleted' });
  } catch (err) {
    return send(res, err);
  }
};
