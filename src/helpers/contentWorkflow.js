/**
 * Contents (post) workflow — single source of truth
 * ─────────────────────────────────────────────────────────────────────────────
 * Used by BOTH the Contents page (contentWrite.controller) and the Content
 * Calendar (contentCalendarSlots.controller, item_type 'post').
 *
 *   draft ──submit──▶ pending ──smm_accept──▶ smm_reviewed ──approve──▶ approved ──complete──▶ completed
 *                        └──────────────approve (PC/PM direct, soft gate)─────┘
 *   send_back (reason): SMM from pending · PC/PM from pending / smm_reviewed / approved  ──▶ rejected
 *   remodify  (assignee, from approved)                                                 ──▶ rejected
 *   rejected ──submit──▶ pending
 *
 * Toggles (Settings → SM Ops → Contents):
 *   can_content_smm_approve   SMM Review     (accept · send back from pending)
 *   can_content_pcpm_approve  PC/PM Approval (approve · send back · re-work)
 *   can_content_complete      Mark as Done   (approved → completed)
 *
 * Content row status ↔ calendar slot (content_calendar_posts.slot_status):
 *   draft→assigned · pending→submitted · smm_reviewed→smm_approved · approved→approved
 *   rejected→rejected · completed→completed
 */
const db = require('../config/db');

const LINK = '/social/write-content';
const SLOT_FOR = {
  draft: 'assigned', pending: 'submitted', smm_reviewed: 'smm_approved',
  approved: 'approved', rejected: 'rejected', completed: 'completed',
};
const CONTENT_FIELDS = [
  'platform', 'content_type', 'hook_opening_line', 'core_message', 'call_to_action',
  'caption_content', 'creative_suggestion', 'reference_links',
];

class WorkflowError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ─── Permissions ──────────────────────────────────────────────────────────────
const canSmmReview   = (req) => !!(req.user.is_admin || req.userCanContentSmmApprove);
const canPcpmApprove = (req) => !!(req.user.is_admin || req.userCanContentPcpmApprove);
const canMarkDone    = (req) => !!(req.user.is_admin || req.userCanContentComplete);
/** Sees every content row (not just own). */
const canSeeAllContent = (req) => !!(req.user.is_admin || req.socialAccessLevel >= 2
  || canSmmReview(req) || canPcpmApprove(req) || canMarkDone(req));

// ─── Small utils ──────────────────────────────────────────────────────────────
const isBlank = (v) => v === null || v === undefined || String(v).trim() === '';

function parseSlides(caption) {
  if (!caption) return [];
  try {
    const arr = JSON.parse(caption);
    return Array.isArray(arr) ? arr.map(s => String(s ?? '')) : [];
  } catch { return []; }
}

/** Has the member written anything yet? (decides Draft vs Pending for legacy rows) */
function hasAnyContent(row) {
  if (row.content_type === 'carousel') return parseSlides(row.caption_content).some(s => s.trim());
  return ['hook_opening_line', 'core_message', 'call_to_action', 'caption_content'].some(f => !isBlank(row[f]));
}

/**
 * Validate content before it goes for approval. Returns an error message or null.
 *   reel      → hook + value (core message)
 *   static    → content (caption_content)
 *   carousel  → at least 2 non-empty slides
 *   links     → every non-empty line must be an http(s) URL
 */
function validateForSubmit(row) {
  const type = row.content_type;
  if (!type) return 'Pick a content type';
  if (type === 'carousel') {
    const slides = parseSlides(row.caption_content).filter(s => s.trim());
    if (slides.length < 2) return 'A carousel needs at least 2 slides with text';
  } else if (type === 'static_post') {
    if (isBlank(row.caption_content)) return 'Write the post content before submitting';
  } else if (['reel', 'reel_video_script'].includes(type)) {
    if (isBlank(row.hook_opening_line)) return 'Write the hook before submitting';
    if (isBlank(row.core_message)) return 'Write the value / core message before submitting';
  } else if (isBlank(row.hook_opening_line) && isBlank(row.caption_content)) {
    return 'Write the content before submitting';
  }
  const badLink = String(row.reference_links || '').split('\n').map(l => l.trim()).filter(Boolean)
    .find(l => !/^https?:\/\/\S+$/i.test(l));
  if (badLink) return `Reference links must be URLs (one per line): "${badLink.slice(0, 60)}"`;
  return null;
}

// ─── Lookups ──────────────────────────────────────────────────────────────────

async function getRow(q, id) {
  const [rows] = await q.query('SELECT * FROM content_write_requests WHERE id = ? AND deleted = 0', [id]);
  return rows[0] || null;
}

/** The calendar post slot for a content row (calendar_slot_id, else reverse links). */
async function slotForRow(q, row) {
  if (!row) return null;
  if (row.calendar_slot_id) {
    const [s] = await q.query('SELECT * FROM content_calendar_posts WHERE id = ?', [row.calendar_slot_id]);
    if (s.length) return s[0];
  }
  try {
    const [s] = await q.query(
      'SELECT * FROM content_calendar_posts WHERE linked_write_id = ? OR linked_brief_id = ? ORDER BY id ASC LIMIT 1',
      [row.id, row.id]
    );
    return s[0] || null;
  } catch { return null; }
}

/** The content row for a calendar post slot (oldest live row wins). */
async function rowForSlot(q, slotId) {
  const [r] = await q.query(
    `SELECT * FROM content_write_requests
     WHERE deleted = 0 AND (calendar_slot_id = ?
       OR id = (SELECT linked_write_id FROM content_calendar_posts WHERE id = ?)
       OR id = (SELECT linked_brief_id FROM content_calendar_posts WHERE id = ?))
     ORDER BY (calendar_slot_id = ?) DESC, id ASC LIMIT 1`,
    [slotId, slotId, slotId, slotId]
  );
  return r[0] || null;
}

/** Who writes this content: the slot assignee, else the row creator. */
const assigneeOf = (row, slot) => Number(slot?.assigned_to || row.created_by) || null;

// ─── Content code (CNT-CLIENT-###) ────────────────────────────────────────────

async function nextContentCode(q, clientId) {
  let clientCode = 'GEN';
  if (clientId) {
    const [c] = await q.query('SELECT client_code FROM leads WHERE id = ?', [clientId]);
    if (c.length && c[0].client_code) clientCode = c[0].client_code;
  }
  const prefix = `CNT-${clientCode}-`;
  const [rows] = await q.query('SELECT content_id_code FROM content_write_requests WHERE content_id_code LIKE ?', [`${prefix}%`]);
  let max = 0;
  rows.forEach(r => {
    const n = parseInt(String(r.content_id_code).split('-').pop(), 10);
    if (!Number.isNaN(n) && n > max) max = n;
  });
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

/**
 * Insert a content row with a fresh code, retrying if another request grabbed
 * the same code first (unique index uk_content_id_code). `build(code)` → [sql, params].
 */
async function insertWithCode(q, clientId, build) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = await nextContentCode(q, clientId);
    const [sql, params] = build(code);
    try {
      const [result] = await q.query(sql, params);
      return { insertId: result.insertId, code };
    } catch (e) {
      if (e.code !== 'ER_DUP_ENTRY' || attempt === 4) throw e;
    }
  }
  throw new Error('Could not allocate a content code');
}

/**
 * Create the Draft placeholder for a newly assigned calendar post slot.
 * Inherits project ▸ service ▸ cycle from the slot's plan. Returns the new id.
 */
async function createDraftForSlot(conn, { slotId, assignedTo }) {
  const [info] = await conn.query(
    `SELECT p.client_id, p.project_id, p.cycle_id, sc.project_service_id,
            cp.format, cp.platform AS post_platform, cp.posting_date
     FROM content_calendar_posts cp
     JOIN content_calendar_plans p ON p.id = cp.plan_id
     LEFT JOIN service_cycles sc ON sc.id = p.cycle_id
     WHERE cp.id = ?`,
    [slotId]
  );
  const i = info[0] || {};
  const insert = (status) => insertWithCode(conn, i.client_id || null, (code) => [
    `INSERT INTO content_write_requests
       (content_id_code, client_brand_id, project_id, platform, content_type, status, created_by, calendar_slot_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [code, i.client_id || null, i.project_id || null, i.post_platform || 'Instagram', i.format || 'static_post', status, assignedTo, slotId],
  ]);
  let created;
  try {
    created = await insert('draft');
  } catch (e) {
    // Older schema without 'draft' in the ENUM
    if (e.errno !== 1265 && e.code !== 'WARN_DATA_TRUNCATED' && e.code !== 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD') throw e;
    created = await insert('pending');
  }
  try {
    await conn.query('UPDATE content_write_requests SET project_service_id = ?, cycle_id = ? WHERE id = ?',
      [i.project_service_id || null, i.cycle_id || null, created.insertId]);
  } catch (e) { /* link columns not migrated yet */ }
  try {
    if (i.posting_date) await conn.query('UPDATE content_write_requests SET posting_date = ? WHERE id = ?', [i.posting_date, created.insertId]);
  } catch (e) { /* posting_date column missing */ }
  return created.insertId;
}

/**
 * The content row for a slot, creating a Draft if a (legacy) assigned slot has none.
 * Used when the member opens "Fill Content".
 */
async function ensureRowForSlot(slotId, userId) {
  const existing = await rowForSlot(db, slotId);
  if (existing) return existing;
  const [s] = await db.query('SELECT * FROM content_calendar_posts WHERE id = ?', [slotId]);
  if (!s.length) throw new WorkflowError(404, 'Calendar post slot not found');
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const id = await createDraftForSlot(conn, { slotId, assignedTo: s[0].assigned_to || userId });
    await conn.query('UPDATE content_calendar_posts SET linked_write_id = ? WHERE id = ?', [id, slotId]);
    await conn.commit();
    return getRow(db, id);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// ─── History / notifications (non-fatal, after commit) ───────────────────────

async function logHistory(recordId, action, remarks, userId) {
  const fallback = { smm_accept: 'approve', send_back: 'rework', remodify: 'rework', complete: 'approve' }[action];
  for (const a of [action, fallback].filter(Boolean)) {
    try {
      await db.query(
        `INSERT INTO smm_approval_history (module, record_id, action, remarks, acted_by) VALUES ('content_write', ?, ?, ?, ?)`,
        [recordId, a, remarks || null, userId]
      );
      return;
    } catch (e) { /* try the older ENUM value */ }
  }
}

async function notify(res, { user_id, triggered_by, type, slot_id, title, message, link = LINK }) {
  if (!user_id || Number(user_id) === Number(triggered_by)) return;
  try {
    await db.query(
      `INSERT INTO smm_notifications (user_id, triggered_by, type, slot_type, slot_id, title, message, link)
       VALUES (?, ?, ?, 'post', ?, ?, ?, ?)`,
      [user_id, triggered_by, type, slot_id || null, title, message || null, link]
    );
    res?.emitSocket?.('smm:notification', { user_id, type });
  } catch (e) { /* non-fatal */ }
}

// ─── Transitions ──────────────────────────────────────────────────────────────

/**
 * Run a workflow action on a content row and its calendar slot, atomically.
 * @param {object} req       Express request (user + toggle flags)
 * @param {object} res       Express response (for sockets) — optional
 * @param {number} rowId     content_write_requests.id
 * @param {'submit'|'smm_accept'|'approve'|'send_back'|'remodify'|'complete'} action
 * @param {{ reason?: string }} opts
 * @returns {Promise<object>} the updated row
 * Throws WorkflowError(status, message) for permission / state problems.
 */
async function transition(req, res, rowId, action, { reason } = {}) {
  const uid = Number(req.user.id);
  const note = typeof reason === 'string' ? reason.trim() : '';

  const conn = await db.getConnection();
  let row, slot, from, to;
  try {
    await conn.beginTransaction();
    const [locked] = await conn.query('SELECT * FROM content_write_requests WHERE id = ? AND deleted = 0 FOR UPDATE', [rowId]);
    row = locked[0];
    if (!row) throw new WorkflowError(404, 'Content not found');
    slot = await slotForRow(conn, row);
    from = row.status === 'in_progress' ? 'pending' : row.status;
    const assignee = assigneeOf(row, slot);

    // ── Rules ──
    if (action === 'submit') {
      if (!(req.user.is_admin || assignee === uid)) throw new WorkflowError(403, 'Only the assigned writer can submit this content');
      if (!['draft', 'rejected', 'pending', 'approved'].includes(from)) throw new WorkflowError(400, `Content that is ${from.replace('_', ' ')} can't be resubmitted`);
      const err = validateForSubmit(row);
      if (err) throw new WorkflowError(400, err);
      to = 'pending';
    } else if (action === 'smm_accept') {
      if (!canSmmReview(req)) throw new WorkflowError(403, 'Only users with Contents SMM Review permission can review content');
      if (from !== 'pending') throw new WorkflowError(400, `Only content pending approval can be SMM-reviewed (current: ${from})`);
      to = 'smm_reviewed';
    } else if (action === 'approve') {
      if (!canPcpmApprove(req)) throw new WorkflowError(403, 'Only users with Contents PC/PM Approval permission can approve content');
      if (!['pending', 'smm_reviewed'].includes(from)) throw new WorkflowError(400, `Only pending or SMM-reviewed content can be approved (current: ${from})`);
      to = 'approved';
    } else if (action === 'send_back') {
      if (!note) throw new WorkflowError(400, 'Please give a reason for sending it back');
      const smmOk = canSmmReview(req) && from === 'pending';
      const pcpmOk = canPcpmApprove(req) && ['pending', 'smm_reviewed', 'approved'].includes(from);
      if (!smmOk && !pcpmOk) {
        if (!canSmmReview(req) && !canPcpmApprove(req)) throw new WorkflowError(403, 'Only Contents SMM Review or PC/PM Approval users can send content back');
        throw new WorkflowError(400, `Content that is ${from.replace('_', ' ')} can't be sent back by you`);
      }
      to = 'rejected';
    } else if (action === 'remodify') {
      if (!(req.user.is_admin || assignee === uid)) throw new WorkflowError(403, 'Only the assigned writer can reopen this content');
      if (from !== 'approved') throw new WorkflowError(400, 'Only approved content can be reopened');
      to = 'rejected';
    } else if (action === 'complete') {
      if (!canMarkDone(req)) throw new WorkflowError(403, 'Only users with Contents Mark as Done permission can complete content');
      if (from !== 'approved') throw new WorkflowError(400, 'Only approved content can be marked as done');
      to = 'completed';
    } else {
      throw new WorkflowError(400, 'Unknown action');
    }

    // ── Content row ──
    const sets = ['status = ?'];
    const vals = [to];
    if (to === 'pending') {
      sets.push('admin_remarks = NULL', 'approved_by = NULL', 'approved_at = NULL');
    } else if (to === 'approved') {
      sets.push('approved_by = ?', 'approved_at = NOW()', 'admin_remarks = ?');
      vals.push(uid, note || null);
    } else if (to === 'rejected') {
      sets.push('admin_remarks = ?', 'approved_by = NULL', 'approved_at = NULL');
      vals.push(action === 'remodify' ? `Reopened by writer${note ? `: ${note}` : ''}` : note);
    }
    await conn.query(`UPDATE content_write_requests SET ${sets.join(', ')} WHERE id = ?`, [...vals, row.id]);

    // Trail columns (added by ensureContentWorkflowSchema) — optional on old schemas
    try {
      if (to === 'pending') {
        await conn.query('UPDATE content_write_requests SET smm_reviewed_by = NULL, smm_reviewed_at = NULL, returned_by = NULL, returned_at = NULL WHERE id = ?', [row.id]);
      } else if (to === 'smm_reviewed') {
        await conn.query('UPDATE content_write_requests SET smm_reviewed_by = ?, smm_reviewed_at = NOW() WHERE id = ?', [uid, row.id]);
      } else if (to === 'rejected') {
        await conn.query('UPDATE content_write_requests SET returned_by = ?, returned_at = NOW(), smm_reviewed_by = NULL, smm_reviewed_at = NULL WHERE id = ?', [uid, row.id]);
      } else if (to === 'completed') {
        await conn.query('UPDATE content_write_requests SET completed_by = ?, completed_at = NOW() WHERE id = ?', [uid, row.id]);
      }
    } catch (e) { /* columns not migrated yet */ }

    // ── Calendar slot ──
    if (slot) {
      const slotStatus = action === 'remodify' ? 'assigned' : SLOT_FOR[to];
      if (slotStatus === 'submitted') {
        await conn.query(
          `UPDATE content_calendar_posts SET slot_status = 'submitted', submitted_at = NOW(), rejection_reason = NULL,
             approved_at = NULL, approved_by = NULL, smm_approved_at = NULL, smm_approved_by = NULL, linked_brief_id = ?
           WHERE id = ?`,
          [row.id, slot.id]
        );
      } else if (slotStatus === 'smm_approved') {
        await conn.query(
          `UPDATE content_calendar_posts SET slot_status = 'smm_approved', smm_approved_by = ?, smm_approved_at = NOW(), rejection_reason = NULL WHERE id = ?`,
          [uid, slot.id]
        );
      } else if (slotStatus === 'approved') {
        await conn.query(
          `UPDATE content_calendar_posts SET slot_status = 'approved', approved_by = ?, approved_at = NOW(), rejection_reason = NULL WHERE id = ?`,
          [uid, slot.id]
        );
      } else if (slotStatus === 'rejected' || slotStatus === 'assigned') {
        await conn.query(
          `UPDATE content_calendar_posts SET slot_status = ?, rejection_reason = ?,
             approved_at = NULL, approved_by = NULL, smm_approved_at = NULL, smm_approved_by = NULL
           WHERE id = ?`,
          [slotStatus, action === 'remodify' ? `Re-modify requested${note ? `: ${note}` : ''}` : note, slot.id]
        );
      } else if (slotStatus === 'completed') {
        await conn.query(`UPDATE content_calendar_posts SET slot_status = 'completed' WHERE id = ?`, [slot.id]);
      }
    }

    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  // ── After commit: history, notifications, sockets ──
  const historyAction = action === 'submit' ? (['rejected', 'approved'].includes(from) ? 'resubmit' : 'submit') : action;
  await logHistory(row.id, historyAction, note || null, uid);

  const label = row.content_id_code || 'Content';
  const assignee = assigneeOf(row, slot);
  const slotId = slot?.id || null;
  if (to === 'pending') {
    await notify(res, {
      user_id: slot?.assigned_by, triggered_by: uid, type: 'slot_submitted', slot_id: slotId,
      title: 'Post content submitted for approval', message: `${label} is waiting for review.`,
    });
  } else if (to === 'smm_reviewed') {
    await notify(res, {
      user_id: assignee, triggered_by: uid, type: 'slot_smm_approved', slot_id: slotId,
      title: 'Your content passed SMM review', message: `${label} is waiting for PC/PM approval.`,
    });
  } else if (to === 'approved') {
    await notify(res, {
      user_id: assignee, triggered_by: uid, type: 'slot_approved', slot_id: slotId,
      title: 'Your content was approved', message: `${label} is approved.`,
    });
  } else if (to === 'rejected' && action === 'send_back') {
    await notify(res, {
      user_id: assignee, triggered_by: uid, type: 'slot_rework', slot_id: slotId,
      title: 'Content sent back for re-work', message: `${label}: ${note}`,
    });
  } else if (action === 'remodify') {
    await notify(res, {
      user_id: slot?.assigned_by, triggered_by: uid, type: 'slot_remodify', slot_id: slotId,
      title: 'Approved content reopened', message: `${label} is being re-edited and will need approval again.`,
      link: '/social/content-calendar',
    });
  } else if (to === 'completed') {
    await notify(res, {
      user_id: assignee, triggered_by: uid, type: 'slot_completed', slot_id: slotId,
      title: 'Your content was marked as done', message: `${label} is completed.`,
    });
  }

  if (slotId) {
    res?.emitSocket?.('content-calendar:updated', { item_type: 'post', item_id: slotId, slot_status: SLOT_FOR[to] });
  }
  const updated = await getRow(db, row.id);
  res?.emitSocket?.('content-write:updated', updated);
  return updated;
}

/**
 * Calendar-side entry point: run an action for a post slot.
 * If the slot has no content row (very old data), only the slot moves, with the
 * same permission rules.
 */
async function transitionSlot(req, res, slotId, action, opts = {}) {
  const row = await rowForSlot(db, slotId);
  if (row) return transition(req, res, row.id, action, opts);

  // ── Legacy slot without content ──
  const [s] = await db.query('SELECT * FROM content_calendar_posts WHERE id = ?', [slotId]);
  if (!s.length) throw new WorkflowError(404, 'Slot not found');
  const slot = s[0];
  const note = typeof opts.reason === 'string' ? opts.reason.trim() : '';
  const rules = {
    smm_accept: { ok: canSmmReview(req), from: ['submitted'], to: 'smm_approved' },
    approve:    { ok: canPcpmApprove(req), from: ['submitted', 'smm_approved'], to: 'approved' },
    send_back:  { ok: canSmmReview(req) || canPcpmApprove(req), from: ['submitted', 'smm_approved', 'approved'], to: 'rejected' },
    complete:   { ok: canMarkDone(req), from: ['approved'], to: 'completed' },
  }[action];
  if (!rules) throw new WorkflowError(400, 'This slot has no content yet');
  if (!rules.ok) throw new WorkflowError(403, 'You do not have the Contents permission for this action');
  if (!rules.from.includes(slot.slot_status)) throw new WorkflowError(400, `Slot is ${slot.slot_status}`);
  if (action === 'send_back' && !note) throw new WorkflowError(400, 'Please give a reason for sending it back');
  await db.query(
    `UPDATE content_calendar_posts SET slot_status = ?, rejection_reason = ?,
       approved_by = IF(? = 'approved', ?, approved_by), approved_at = IF(? = 'approved', NOW(), approved_at)
     WHERE id = ?`,
    [rules.to, rules.to === 'rejected' ? note : null, rules.to, req.user.id, rules.to, slotId]
  );
  res?.emitSocket?.('content-calendar:updated', { item_type: 'post', item_id: slotId, slot_status: rules.to });
  return null;
}

// ─── Schema (startup, idempotent) ─────────────────────────────────────────────

async function columnType(table, column) {
  const [rows] = await db.query(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows.length ? String(rows[0].COLUMN_TYPE) : null;
}

async function ensureContentWorkflowSchema() {
  const run = async (sql, label) => {
    try { await db.query(sql); } catch (e) { console.error(`⚠️  Content workflow ${label} (non-fatal):`, e.message); }
  };

  // 1. Toggles — and on first creation, copy from the old module-level toggles
  const hadToggle = !!(await columnType('role_permissions', 'can_content_smm_approve').catch(() => null));
  for (const t of ['role_permissions', 'user_permissions']) {
    await run(`ALTER TABLE ${t}
      ADD COLUMN IF NOT EXISTS can_content_smm_approve  TINYINT(1) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS can_content_pcpm_approve TINYINT(1) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS can_content_complete     TINYINT(1) NOT NULL DEFAULT 0`, `${t} toggles`);
  }
  if (!hadToggle) {
    for (const t of ['role_permissions', 'user_permissions']) {
      await run(`UPDATE ${t} SET
          can_content_smm_approve  = IF(COALESCE(can_smm_approve, 0) = 1, 1, 0),
          can_content_pcpm_approve = IF(COALESCE(can_pcpm_approve, 0) = 1 OR COALESCE(can_approve, 0) = 1, 1, 0),
          can_content_complete     = IF(COALESCE(can_smm_approve, 0) = 1 OR COALESCE(can_pcpm_approve, 0) = 1 OR COALESCE(can_complete, 0) = 1, 1, 0)
        WHERE module = 'creative_hub'`, `${t} toggle copy`);
    }
    console.log('✅  Contents approval toggles created and copied from SMM / PC-PM / Mark as Done');
  }

  // 2. Statuses
  try {
    const t = await columnType('content_write_requests', 'status');
    if (t && t.startsWith('enum(') && !t.includes("'smm_reviewed'")) {
      await db.query(`ALTER TABLE content_write_requests MODIFY COLUMN status
        ENUM('draft','pending','smm_reviewed','approved','rejected','in_progress','completed') NOT NULL DEFAULT 'pending'`);
    }
  } catch (e) { console.error('⚠️  content_write_requests.status enum (non-fatal):', e.message); }

  // 3. Trail + Project ▸ Service ▸ Cycle link
  await run(`ALTER TABLE content_write_requests
    ADD COLUMN IF NOT EXISTS project_service_id INT UNSIGNED DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS cycle_id           INT UNSIGNED DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS smm_reviewed_by    INT UNSIGNED DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS smm_reviewed_at    DATETIME DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS returned_by        INT UNSIGNED DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS returned_at        DATETIME DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS completed_by       INT UNSIGNED DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS completed_at       DATETIME DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS draft_saved_at     DATETIME DEFAULT NULL`, 'columns');
  await run(`ALTER TABLE content_write_requests
    ADD INDEX IF NOT EXISTS idx_cwr_slot (calendar_slot_id),
    ADD INDEX IF NOT EXISTS idx_cwr_cycle (cycle_id)`, 'indexes');

  // 4. History actions
  try {
    const t = await columnType('smm_approval_history', 'action');
    if (t && t.startsWith('enum(') && !t.includes("'smm_accept'")) {
      await db.query(`ALTER TABLE smm_approval_history MODIFY COLUMN action
        ENUM('approve','reject','rework','submit','resubmit','complete','report_submit','report_approve','report_reject',
             'close_request','close_approve','close_reject','smm_accept','send_back','remodify') NOT NULL`);
    }
  } catch (e) { console.error('⚠️  smm_approval_history.action enum (non-fatal):', e.message); }

  // 5. Data fixes (idempotent)
  // 5a. Unfilled placeholders → draft
  await run(`UPDATE content_write_requests cwr
    JOIN content_calendar_posts cp ON cp.id = cwr.calendar_slot_id
    SET cwr.status = 'draft'
    WHERE cwr.deleted = 0 AND cwr.status = 'pending' AND cp.slot_status = 'assigned'
      AND COALESCE(TRIM(cwr.hook_opening_line), '') = '' AND COALESCE(TRIM(cwr.core_message), '') = ''
      AND COALESCE(TRIM(cwr.call_to_action), '') = ''
      AND (COALESCE(TRIM(cwr.caption_content), '') = '' OR TRIM(cwr.caption_content) IN ('[]', '[""]', '["",""]'))`, 'draft backfill');
  // 5b. Content row follows its slot where they disagree
  await run(`UPDATE content_write_requests cwr
    JOIN content_calendar_posts cp ON cp.id = cwr.calendar_slot_id
    SET cwr.status = CASE cp.slot_status
        WHEN 'submitted'    THEN 'pending'
        WHEN 'smm_approved' THEN 'smm_reviewed'
        WHEN 'approved'     THEN 'approved'
        WHEN 'rejected'     THEN 'rejected'
        WHEN 'completed'    THEN 'completed'
        ELSE cwr.status END,
      cwr.smm_reviewed_by = IF(cp.slot_status = 'smm_approved', COALESCE(cwr.smm_reviewed_by, cp.smm_approved_by), cwr.smm_reviewed_by),
      cwr.smm_reviewed_at = IF(cp.slot_status = 'smm_approved', COALESCE(cwr.smm_reviewed_at, cp.smm_approved_at), cwr.smm_reviewed_at)
    WHERE cwr.deleted = 0 AND cwr.status <> 'draft'
      AND cp.slot_status IN ('submitted','smm_approved','approved','rejected','completed')
      AND cwr.status <> CASE cp.slot_status
        WHEN 'submitted' THEN 'pending' WHEN 'smm_approved' THEN 'smm_reviewed'
        ELSE cp.slot_status END`, 'status sync');
  // 5c. Project ▸ Service ▸ Cycle from the calendar plan
  await run(`UPDATE content_write_requests cwr
    JOIN content_calendar_posts cp ON cp.id = cwr.calendar_slot_id
    JOIN content_calendar_plans p ON p.id = cp.plan_id
    LEFT JOIN service_cycles sc ON sc.id = p.cycle_id
    SET cwr.cycle_id = COALESCE(cwr.cycle_id, p.cycle_id),
        cwr.project_service_id = COALESCE(cwr.project_service_id, sc.project_service_id),
        cwr.project_id = COALESCE(cwr.project_id, p.project_id)
    WHERE cwr.deleted = 0 AND (cwr.cycle_id IS NULL OR cwr.project_service_id IS NULL)`, 'link backfill');

  console.log('✅  Contents approval workflow schema checked');
}

module.exports = {
  CONTENT_FIELDS,
  SLOT_FOR,
  WorkflowError,
  canSmmReview,
  canPcpmApprove,
  canMarkDone,
  canSeeAllContent,
  validateForSubmit,
  hasAnyContent,
  parseSlides,
  getRow,
  slotForRow,
  rowForSlot,
  assigneeOf,
  createDraftForSlot,
  ensureRowForSlot,
  insertWithCode,
  transition,
  transitionSlot,
  logHistory,
  ensureContentWorkflowSchema,
};
