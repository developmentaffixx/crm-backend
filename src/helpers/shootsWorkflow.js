/**
 * Shoots two-stage approval workflow helpers
 * ─────────────────────────────────────────────────────────────────────────────
 *  draft             placeholder created when a calendar slot is assigned (not filled yet)
 *  pending_approval  details filled & submitted          ── Stage 1: Shoot Approval (can_shoot_approve)
 *  approved          shoot can happen / crew can punch
 *  rejected          sent back for re-work → member edits → pending_approval
 *  pending_completion  Close Request submitted           ── Stage 2: Close Approval (can_shoot_close_approve)
 *  completed         close request approved (calendar slot also completed)
 *
 * The toggles live on role_permissions / user_permissions (module 'creative_hub')
 * and are shown under the "Shoots" submenu row in Settings.
 */
const db = require('../config/db');

const SHOOT_STATUSES = ['draft', 'pending_approval', 'approved', 'rejected', 'pending_completion', 'completed'];

// ─── Small utils ──────────────────────────────────────────────────────────────

/** Parse a JSON id array column safely (never throws). */
function parseIds(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(Number).filter(n => !Number.isNaN(n));
  try {
    const arr = JSON.parse(v);
    return Array.isArray(arr) ? arr.map(Number).filter(n => !Number.isNaN(n)) : [];
  } catch { return []; }
}

/** Normalise a crew value from a request body to a JSON string (or null). */
function crewToJson(v) {
  if (v === null || v === '') return null;
  const arr = Array.isArray(v) ? v : parseIds(v);
  return JSON.stringify(arr.map(Number).filter(n => !Number.isNaN(n)));
}

/** YYYY-MM-DD from a DATE value or string (no timezone shifting). */
function toDateStr(d) {
  if (!d) return null;
  if (d instanceof Date) {
    if (Number.isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const s = String(d).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

// ─── Shoot ID code (single generator for every create path) ──────────────────

/**
 * SHT-YYMMDD-CLIENT-###. Sequence is per prefix (date + client), using the
 * highest existing number for that prefix. `q` = db or a transaction connection.
 */
async function generateShootCode(q, clientId, shootDate) {
  const ds = toDateStr(shootDate) || toDateStr(new Date());
  const [y, m, d] = ds.split('-');
  let clientCode = 'GEN';
  if (clientId) {
    const [rows] = await q.query('SELECT client_code FROM leads WHERE id = ?', [clientId]);
    if (rows.length && rows[0].client_code) clientCode = rows[0].client_code;
  }
  const prefix = `SHT-${y.slice(-2)}${m}${d}-${clientCode}`;
  const [existing] = await q.query('SELECT shoot_id_code FROM shoots WHERE shoot_id_code LIKE ?', [`${prefix}-%`]);
  let max = 0;
  existing.forEach(r => {
    const n = parseInt(String(r.shoot_id_code).split('-').pop(), 10);
    if (!Number.isNaN(n) && n > max) max = n;
  });
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

// ─── History / notifications (non-fatal) ─────────────────────────────────────

async function logShootHistory(shootId, action, remarks, userId) {
  try {
    await db.query(
      `INSERT INTO smm_approval_history (module, record_id, action, remarks, acted_by) VALUES ('shoots', ?, ?, ?, ?)`,
      [shootId, action, remarks || null, userId]
    );
  } catch (e) {
    // Older ENUM without the close_* actions → fall back to a generic action
    const fallback = { close_request: 'submit', close_approve: 'approve', close_reject: 'reject' }[action];
    if (fallback) {
      try {
        await db.query(
          `INSERT INTO smm_approval_history (module, record_id, action, remarks, acted_by) VALUES ('shoots', ?, ?, ?, ?)`,
          [shootId, fallback, remarks || null, userId]
        );
      } catch (e2) { /* non-fatal */ }
    }
  }
}

async function notifyShoot({ user_id, triggered_by, type, slot_id = null, title, message = null, link = '/social/shoots' }) {
  if (!user_id || Number(user_id) === Number(triggered_by)) return false;
  try {
    await db.query(
      `INSERT INTO smm_notifications (user_id, triggered_by, type, slot_type, slot_id, title, message, link)
       VALUES (?, ?, ?, 'shoot', ?, ?, ?, ?)`,
      [user_id, triggered_by, type, slot_id, title, message, link]
    );
    return true;
  } catch (e) { return false; }
}

// ─── Calendar slot sync (shoot → slot) ───────────────────────────────────────

async function setSlotStatus(slotId, status, userId, reason = null) {
  if (!slotId) return;
  try {
    if (status === 'approved') {
      await db.query(
        `UPDATE content_calendar_shoots SET slot_status = 'approved', approved_at = NOW(), approved_by = ?, rejection_reason = NULL
         WHERE id = ? AND slot_status <> 'completed'`,
        [userId, slotId]
      );
    } else if (status === 'rejected') {
      await db.query(
        `UPDATE content_calendar_shoots SET slot_status = 'rejected', rejection_reason = ?, approved_at = NULL, approved_by = NULL
         WHERE id = ? AND slot_status <> 'completed'`,
        [reason || 'Sent back for re-work', slotId]
      );
    } else if (status === 'submitted') {
      await db.query(
        `UPDATE content_calendar_shoots SET slot_status = 'submitted', submitted_at = NOW(), rejection_reason = NULL
         WHERE id = ? AND slot_status <> 'completed'`,
        [slotId]
      );
    } else if (status === 'completed') {
      try {
        await db.query(
          `UPDATE content_calendar_shoots SET slot_status = 'completed', completed_at = NOW(), completed_by = ? WHERE id = ?`,
          [userId, slotId]
        );
      } catch (e) {
        await db.query(`UPDATE content_calendar_shoots SET slot_status = 'completed' WHERE id = ?`, [slotId]);
      }
    } else if (status === 'assigned') {
      await db.query(
        `UPDATE content_calendar_shoots SET slot_status = 'assigned', linked_shoot_ref_id = NULL, approved_at = NULL, approved_by = NULL, rejection_reason = NULL
         WHERE id = ? AND slot_status <> 'completed'`,
        [slotId]
      );
    }
  } catch (e) {
    console.warn(`Shoot slot sync (${status}) warning:`, e.message);
  }
}

/** Shoots linked to a calendar slot (not deleted). */
async function shootsForSlot(slotId) {
  const [rows] = await db.query('SELECT * FROM shoots WHERE calendar_slot_id = ? AND deleted = 0', [slotId]);
  return rows;
}

// ─── Schema (auto-migrate on startup, idempotent) ─────────────────────────────

async function columnInfo(table, column) {
  const [rows] = await db.query(
    `SELECT COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows[0] || null;
}

async function ensureShootsWorkflowSchema() {
  const steps = [
    `ALTER TABLE shoots
       ADD COLUMN IF NOT EXISTS calendar_slot_id INT UNSIGNED DEFAULT NULL,
       ADD COLUMN IF NOT EXISTS close_requested_by INT UNSIGNED DEFAULT NULL,
       ADD COLUMN IF NOT EXISTS close_requested_at DATETIME DEFAULT NULL,
       ADD COLUMN IF NOT EXISTS footage_drive_link TEXT DEFAULT NULL,
       ADD COLUMN IF NOT EXISTS shoot_statement TEXT DEFAULT NULL,
       ADD COLUMN IF NOT EXISTS footage_updated_by INT UNSIGNED DEFAULT NULL,
       ADD COLUMN IF NOT EXISTS footage_updated_at DATETIME DEFAULT NULL`,
    `ALTER TABLE content_calendar_shoots
       ADD COLUMN IF NOT EXISTS completed_at DATETIME DEFAULT NULL,
       ADD COLUMN IF NOT EXISTS completed_by INT UNSIGNED DEFAULT NULL`,
  ];
  for (const sql of steps) {
    try { await db.query(sql); } catch (e) { console.error('⚠️  Shoots workflow schema (non-fatal):', e.message); }
  }

  // shoots.status needs 'draft'
  try {
    const c = await columnInfo('shoots', 'status');
    if (c && String(c.COLUMN_TYPE).startsWith('enum(') && !String(c.COLUMN_TYPE).includes("'draft'")) {
      await db.query(
        `ALTER TABLE shoots MODIFY COLUMN status
         ENUM('draft','pending_approval','approved','rejected','pending_completion','completed') NOT NULL DEFAULT 'pending_approval'`
      );
    }
  } catch (e) { console.error('⚠️  shoots.status enum (non-fatal):', e.message); }

  // Legacy start_time / end_time were NOT NULL but are no longer written
  for (const col of ['start_time', 'end_time']) {
    try {
      const c = await columnInfo('shoots', col);
      if (c && c.IS_NULLABLE === 'NO') {
        await db.query(`ALTER TABLE shoots MODIFY COLUMN ${col} TIME NULL DEFAULT NULL`);
      }
    } catch (e) { console.error(`⚠️  shoots.${col} nullable (non-fatal):`, e.message); }
  }

  // Calendar-created placeholders that were never filled → draft (not in the approval queue)
  try {
    await db.query(
      `UPDATE shoots s
       JOIN content_calendar_shoots cs ON cs.id = s.calendar_slot_id
       SET s.status = 'draft'
       WHERE s.deleted = 0 AND s.status = 'pending_approval'
         AND s.project_campaign_name = 'TBD' AND cs.slot_status = 'assigned'`
    );
  } catch (e) { /* draft not available yet */ }

  // Repair old desyncs (idempotent):
  //  - slot approved on the calendar but shoot left pending (old approveSlot didn't sync)
  //  - shoot completed but slot still approved (old close approval didn't sync)
  try {
    await db.query(
      `UPDATE shoots s
       JOIN content_calendar_shoots cs ON cs.id = s.calendar_slot_id
       SET s.status = 'approved', s.approved_by = COALESCE(s.approved_by, cs.approved_by), s.approved_at = COALESCE(s.approved_at, cs.approved_at)
       WHERE s.deleted = 0 AND s.status = 'pending_approval' AND cs.slot_status = 'approved'`
    );
    await db.query(
      `UPDATE content_calendar_shoots cs
       JOIN shoots s ON s.calendar_slot_id = cs.id AND s.deleted = 0
       SET cs.slot_status = 'completed'
       WHERE s.status = 'completed' AND cs.slot_status = 'approved'`
    );
  } catch (e) { console.error('⚠️  Shoots desync repair (non-fatal):', e.message); }

  console.log('✅  Shoots approval workflow schema checked');
}

module.exports = {
  SHOOT_STATUSES,
  parseIds,
  crewToJson,
  toDateStr,
  generateShootCode,
  logShootHistory,
  notifyShoot,
  setSlotStatus,
  shootsForSlot,
  ensureShootsWorkflowSchema,
};
