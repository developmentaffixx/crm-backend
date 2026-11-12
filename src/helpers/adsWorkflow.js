/**
 * Ads two-stage approval workflow helpers
 * ─────────────────────────────────────────────────────────────────────────────
 *  Stage 1  Campaign approval  → toggle can_ads_campaign_approve
 *           pending_approval → approved (→ active automatically on start date)
 *  Stage 2  Close & Report     → toggle can_ads_report_approve
 *           approved/active → report_pending → completed
 *
 * Both toggles live on role_permissions / user_permissions (module = 'creative_hub')
 * and are shown under the "Ads" submenu row in Settings.
 */
const db = require('../config/db');

const ADS_PERM_COLS = ['can_ads_campaign_approve', 'can_ads_report_approve'];

// ─── Dates ────────────────────────────────────────────────────────────────────

/** Today's date in IST as YYYY-MM-DD (campaign dates are planned in IST). */
function todayIST() {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().split('T')[0];
}

/** Normalise a DATE value (Date object or string) to YYYY-MM-DD, or null. */
function toDateStr(d) {
  if (!d) return null;
  if (d instanceof Date) {
    if (Number.isNaN(d.getTime())) return null;
    // mysql2 returns DATE columns as local-midnight Date objects
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  const s = String(d).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** Status a campaign should get when approved: 'active' if it has already started. */
function statusOnApproval(startDate) {
  const s = toDateStr(startDate);
  return s && s <= todayIST() ? 'active' : 'approved';
}

// ─── Auto-activation (approved → active on start date) ───────────────────────

let lastActivationRun = 0;

/**
 * Promote approved campaigns whose start date has arrived to 'active'.
 * `minIntervalMs` throttles calls made from request handlers.
 * Returns the number of campaigns activated.
 */
async function activateStartedCampaigns({ minIntervalMs = 0 } = {}) {
  const now = Date.now();
  if (minIntervalMs && now - lastActivationRun < minIntervalMs) return 0;
  lastActivationRun = now;
  try {
    const [result] = await db.query(
      `UPDATE ad_campaigns SET status = 'active'
       WHERE status = 'approved' AND deleted = 0
         AND start_date IS NOT NULL AND start_date <= ?`,
      [todayIST()]
    );
    return result.affectedRows || 0;
  } catch (err) {
    console.warn('Ads auto-activation warning:', err.message);
    return 0;
  }
}

// ─── Permission columns ───────────────────────────────────────────────────────

/**
 * Load the two ads approval columns for a role or user.
 * @param {'role_permissions'|'user_permissions'} table
 * @param {'role_id'|'user_id'} keyCol
 * @returns {Promise<Record<string, {can_ads_campaign_approve:number, can_ads_report_approve:number}>>}
 */
async function loadAdsPerms(table, keyCol, id) {
  if (!id) return {};
  try {
    const [rows] = await db.query(
      `SELECT module, can_ads_campaign_approve, can_ads_report_approve FROM ${table} WHERE ${keyCol} = ?`,
      [id]
    );
    const map = {};
    rows.forEach(r => {
      map[r.module] = {
        can_ads_campaign_approve: Number(r.can_ads_campaign_approve) || 0,
        can_ads_report_approve: Number(r.can_ads_report_approve) || 0,
      };
    });
    return map;
  } catch (e) {
    return {}; // columns not migrated yet
  }
}

/** Merge ads perm columns into a { module: {...perms} } object (missing → 0). */
function mergeAdsPerms(permissions, adsPerms) {
  Object.keys(permissions).forEach(m => {
    permissions[m] = {
      ...permissions[m],
      can_ads_campaign_approve: adsPerms[m]?.can_ads_campaign_approve ?? 0,
      can_ads_report_approve: adsPerms[m]?.can_ads_report_approve ?? 0,
    };
  });
  return permissions;
}

/** Persist the ads perm columns for one (role|user, module) row. Non-fatal. */
async function saveAdsPerms(table, keyCol, id, module, perm) {
  if (!perm) return;
  const campaign = parseInt(perm.can_ads_campaign_approve ?? 0, 10) ? 1 : 0;
  const report = parseInt(perm.can_ads_report_approve ?? 0, 10) ? 1 : 0;
  try {
    await db.query(
      `UPDATE ${table} SET can_ads_campaign_approve = ?, can_ads_report_approve = ? WHERE ${keyCol} = ? AND module = ?`,
      [campaign, report, id, module]
    );
  } catch (e) {
    console.warn(`saveAdsPerms (${table}) warning:`, e.message);
  }
}

/**
 * Resolve the two ads approval flags for a user (role baseline → user override).
 * Mirrors requireSocialAccess: a user_permissions row for the module wins.
 */
async function resolveAdsApprovalFlags(userId, roleId) {
  const flags = { campaign: false, report: false };
  try {
    if (roleId) {
      const [r] = await db.query(
        `SELECT can_ads_campaign_approve, can_ads_report_approve FROM role_permissions WHERE role_id = ? AND module = 'creative_hub'`,
        [roleId]
      );
      if (r.length) {
        flags.campaign = Number(r[0].can_ads_campaign_approve) > 0;
        flags.report = Number(r[0].can_ads_report_approve) > 0;
      }
    }
    const [u] = await db.query(
      `SELECT can_ads_campaign_approve, can_ads_report_approve FROM user_permissions WHERE user_id = ? AND module = 'creative_hub'`,
      [userId]
    );
    if (u.length) {
      if (u[0].can_ads_campaign_approve !== null && u[0].can_ads_campaign_approve !== undefined) flags.campaign = Number(u[0].can_ads_campaign_approve) > 0;
      if (u[0].can_ads_report_approve !== null && u[0].can_ads_report_approve !== undefined) flags.report = Number(u[0].can_ads_report_approve) > 0;
    }
  } catch (e) { /* columns not migrated yet → no ads approvers except admin */ }
  return flags;
}

// ─── Schema (auto-migrate on startup, idempotent) ─────────────────────────────

async function columnType(table, column) {
  const [rows] = await db.query(
    `SELECT COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows.length ? String(rows[0].COLUMN_TYPE) : null;
}

async function ensureAdsWorkflowSchema() {
  const steps = [
    // Permission toggles
    "ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS can_ads_campaign_approve TINYINT(1) NOT NULL DEFAULT 0",
    "ALTER TABLE role_permissions ADD COLUMN IF NOT EXISTS can_ads_report_approve TINYINT(1) NOT NULL DEFAULT 0",
    "ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS can_ads_campaign_approve TINYINT(1) NOT NULL DEFAULT 0",
    "ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS can_ads_report_approve TINYINT(1) NOT NULL DEFAULT 0",
    // Campaign approval + report review tracking
    `ALTER TABLE ad_campaigns
       ADD COLUMN IF NOT EXISTS approved_by INT UNSIGNED DEFAULT NULL,
       ADD COLUMN IF NOT EXISTS approved_at DATETIME DEFAULT NULL,
       ADD COLUMN IF NOT EXISTS approval_remarks TEXT DEFAULT NULL,
       ADD COLUMN IF NOT EXISTS report_submitted_by INT UNSIGNED DEFAULT NULL,
       ADD COLUMN IF NOT EXISTS report_submitted_at DATETIME DEFAULT NULL,
       ADD COLUMN IF NOT EXISTS report_reviewed_by INT UNSIGNED DEFAULT NULL,
       ADD COLUMN IF NOT EXISTS report_reviewed_at DATETIME DEFAULT NULL,
       ADD COLUMN IF NOT EXISTS report_review_remarks TEXT DEFAULT NULL`,
    // Slot completion columns (used when a report is approved)
    `ALTER TABLE content_calendar_ads
       ADD COLUMN IF NOT EXISTS completed_at DATETIME DEFAULT NULL,
       ADD COLUMN IF NOT EXISTS completed_by INT UNSIGNED DEFAULT NULL`,
  ];
  for (const sql of steps) {
    try { await db.query(sql); } catch (e) { console.error('⚠️  Ads workflow schema (non-fatal):', e.message); }
  }

  // ad_campaigns.status needs 'report_pending'
  try {
    const t = await columnType('ad_campaigns', 'status');
    if (t && t.startsWith('enum(') && !t.includes("'report_pending'")) {
      await db.query(
        `ALTER TABLE ad_campaigns MODIFY COLUMN status
         ENUM('draft','pending_approval','approved','active','paused','report_pending','completed','rejected') DEFAULT 'draft'`
      );
    }
  } catch (e) { console.error('⚠️  ad_campaigns.status enum (non-fatal):', e.message); }

  // smm_approval_history.action needs the report actions (+ 'complete', already used by code)
  try {
    const t = await columnType('smm_approval_history', 'action');
    if (t && t.startsWith('enum(') && !t.includes("'report_submit'")) {
      await db.query(
        `ALTER TABLE smm_approval_history MODIFY COLUMN action
         ENUM('approve','reject','rework','submit','resubmit','complete','report_submit','report_approve','report_reject') NOT NULL`
      );
    }
  } catch (e) { console.error('⚠️  smm_approval_history.action enum (non-fatal):', e.message); }

  console.log('✅  Ads approval workflow schema checked');
}

/** Insert into smm_approval_history, ignoring failures (table may be missing). */
async function logAdsHistory(recordId, action, remarks, userId) {
  try {
    await db.query(
      `INSERT INTO smm_approval_history (module, record_id, action, remarks, acted_by) VALUES ('ads', ?, ?, ?, ?)`,
      [recordId, action, remarks || null, userId]
    );
  } catch (e) { /* non-fatal */ }
}

/** Insert an SMM notification, ignoring failures. */
async function notify({ user_id, triggered_by, type, slot_id = null, title, message = null, link = '/social/ads' }) {
  if (!user_id) return;
  try {
    await db.query(
      `INSERT INTO smm_notifications (user_id, triggered_by, type, slot_type, slot_id, title, message, link)
       VALUES (?, ?, ?, 'ad', ?, ?, ?, ?)`,
      [user_id, triggered_by, type, slot_id, title, message, link]
    );
  } catch (e) { /* non-fatal */ }
}

module.exports = {
  ADS_PERM_COLS,
  todayIST,
  toDateStr,
  statusOnApproval,
  activateStartedCampaigns,
  loadAdsPerms,
  mergeAdsPerms,
  saveAdsPerms,
  resolveAdsApprovalFlags,
  ensureAdsWorkflowSchema,
  logAdsHistory,
  notify,
};
