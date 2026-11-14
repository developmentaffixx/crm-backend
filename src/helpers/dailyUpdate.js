/**
 * Daily Update (SM Ops ▸ Daily Update / smm_daily_journal) helpers
 * ─────────────────────────────────────────────────────────────────────────────
 * Requirement rule (used by clock-out, the page and the team status view):
 *   A user must submit one Daily Update per day for EACH active Project ▸ Service
 *   they are a member of (project_service_members), when:
 *     - they are an active, non-admin user
 *     - they have Daily Update access = Own in SM Ops (All = leads, exempt)
 *     - the project is active (not deleted) and the service is active
 *   Users with access but no service membership have nothing required.
 *
 * Dates are IST calendar dates (journal_date is a DATE planned in IST).
 */
const db = require('../config/db');

const SUBMENU = 'daily_journal';

/** Today's date in IST as YYYY-MM-DD. */
function todayIST() {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().split('T')[0];
}

/** YYYY-MM-DD string from a DATE value / string. */
function toDateStr(d) {
  if (!d) return null;
  if (d instanceof Date) {
    if (Number.isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const s = String(d).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/** Safe JSON parse (never throws). */
function parseJson(v, fallback = null) {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return fallback; }
}

/** Parse the JSON columns of a journal row in place. */
function parseEntry(row) {
  if (!row) return row;
  row.work_categories = parseJson(row.work_categories, null);
  row.activities_completed = parseJson(row.activities_completed, null);
  row.issues_delays = parseJson(row.issues_delays, []);
  row.tomorrow_priorities = parseJson(row.tomorrow_priorities, []);
  if (!Array.isArray(row.issues_delays)) row.issues_delays = [];
  if (!Array.isArray(row.tomorrow_priorities)) row.tomorrow_priorities = [];
  row.journal_date = toDateStr(row.journal_date) || row.journal_date;
  return row;
}

/**
 * Daily Update access level per user (0 none / 1 own / 2 all), in bulk.
 * Same priority chain as getSocialSubmenuAccess:
 *   user_submenu_permissions → role_submenu_permissions → role_social_permissions.
 * Admins are reported as 2.
 * @param {number[]} userIds
 * @returns {Promise<Map<number, number>>}
 */
async function accessLevels(userIds) {
  const ids = [...new Set((userIds || []).map(Number).filter(Boolean))];
  const out = new Map();
  if (!ids.length) return out;

  const [users] = await db.query('SELECT id, role_id, is_admin FROM users WHERE id IN (?)', [ids]);
  const roleIds = [...new Set(users.map(u => u.role_id).filter(Boolean))];

  const userSub = new Map();
  try {
    const [rows] = await db.query(
      `SELECT user_id, can_access FROM user_submenu_permissions
       WHERE module = 'creative_hub' AND submenu = ? AND user_id IN (?)`,
      [SUBMENU, ids]
    );
    rows.forEach(r => { if (r.can_access !== null) userSub.set(Number(r.user_id), Number(r.can_access) || 0); });
  } catch (e) { /* table missing */ }

  const roleSub = new Map();
  const legacy = new Map();
  if (roleIds.length) {
    try {
      const [rows] = await db.query(
        `SELECT role_id, can_access FROM role_submenu_permissions
         WHERE module = 'creative_hub' AND submenu = ? AND role_id IN (?)`,
        [SUBMENU, roleIds]
      );
      rows.forEach(r => { if (r.can_access !== null) roleSub.set(Number(r.role_id), Number(r.can_access) || 0); });
    } catch (e) { /* table missing */ }
    try {
      const [rows] = await db.query(
        `SELECT role_id, daily_journal AS lvl FROM role_social_permissions WHERE role_id IN (?)`,
        [roleIds]
      );
      rows.forEach(r => { if (r.lvl !== null) legacy.set(Number(r.role_id), Number(r.lvl) || 0); });
    } catch (e) { /* table missing */ }
  }

  users.forEach(u => {
    const id = Number(u.id);
    if (u.is_admin) { out.set(id, 2); return; }
    if (userSub.has(id)) { out.set(id, userSub.get(id)); return; }
    const rid = Number(u.role_id);
    if (roleSub.has(rid)) { out.set(id, roleSub.get(rid)); return; }
    if (legacy.has(rid)) { out.set(id, legacy.get(rid)); return; }
    out.set(id, 0);
  });
  return out;
}

/**
 * Required Project ▸ Service rows for the given users (or every user when
 * userIds is null). Applies the full rule: active non-admin user, Daily Update
 * access ≥ 1, active project + active service, service member.
 * @returns {Promise<Array<{user_id, user_name, project_service_id, project_id, project_title, client_name, service_name}>>}
 */
async function requiredServices(userIds = null) {
  const params = [];
  let userFilter = '';
  if (Array.isArray(userIds)) {
    const ids = [...new Set(userIds.map(Number).filter(Boolean))];
    if (!ids.length) return [];
    userFilter = 'AND u.id IN (?)';
    params.push(ids);
  }
  let rows = [];
  try {
    [rows] = await db.query(
      `SELECT psm.user_id, CONCAT(u.first_name, ' ', u.last_name) AS user_name,
              ps.id AS project_service_id, ps.project_id,
              p.title AS project_title, l.business_name AS client_name,
              s.name AS service_name
       FROM project_service_members psm
       JOIN users u            ON u.id = psm.user_id
       JOIN project_services ps ON ps.id = psm.project_service_id
       JOIN projects p         ON p.id = ps.project_id
       LEFT JOIN services s    ON s.id = ps.service_id
       LEFT JOIN leads l       ON l.id = p.client_id
       WHERE u.is_active = 1 AND u.deleted = 0 AND u.is_admin = 0
         AND p.deleted = 0 AND p.status = 'active'
         AND ps.status = 'active'
         ${userFilter}
       ORDER BY u.first_name, p.title, s.name`,
      params
    );
  } catch (e) {
    console.warn('Daily Update requiredServices warning:', e.message);
    return [];
  }
  if (!rows.length) return [];
  const levels = await accessLevels(rows.map(r => r.user_id));
  // Only "Own" (1) must submit — "All" (2) are leads/reviewers and are exempt
  return rows.filter(r => (levels.get(Number(r.user_id)) || 0) === 1);
}

/** Set of "userId:projectServiceId" submitted on a date. */
async function submittedKeys(date, userIds = null) {
  const params = [date];
  let filter = '';
  if (Array.isArray(userIds)) {
    if (!userIds.length) return new Set();
    filter = 'AND submitted_by IN (?)';
    params.push(userIds);
  }
  try {
    const [rows] = await db.query(
      `SELECT DISTINCT submitted_by, project_service_id FROM smm_daily_journal
       WHERE journal_date = ? AND project_service_id IS NOT NULL ${filter}`,
      params
    );
    return new Set(rows.map(r => `${Number(r.submitted_by)}:${Number(r.project_service_id)}`));
  } catch (e) {
    return new Set();
  }
}

/**
 * One user's status for a date: { required: [...], pending: [...], submitted_count }.
 * Each item has project_service_id, project_id, project_title, client_name, service_name, submitted.
 */
async function userStatus(userId, date = todayIST()) {
  const req = await requiredServices([userId]);
  const done = await submittedKeys(date, [Number(userId)]);
  const required = req.map(r => ({
    project_service_id: r.project_service_id,
    project_id: r.project_id,
    project_title: r.project_title,
    client_name: r.client_name,
    service_name: r.service_name,
    submitted: done.has(`${Number(userId)}:${Number(r.project_service_id)}`),
  }));
  const pending = required.filter(r => !r.submitted);
  return { date, required, pending, submitted_count: required.length - pending.length };
}

/** "Project ▸ Service" label for messages. */
function serviceLabel(r) {
  return `${r.project_title || 'Project'} ▸ ${r.service_name || 'Service'}`;
}

/**
 * Validate a project / service pair for an entry. Returns the project_services row.
 * Non-admins must be a member of the service. Throws { status, message }.
 */
async function resolveEntryService(user, projectId, projectServiceId) {
  const pid = parseInt(projectId, 10);
  const sid = parseInt(projectServiceId, 10);
  if (!pid || !sid) throw { status: 400, message: 'Project and service are required' };
  const [rows] = await db.query(
    `SELECT ps.id, ps.project_id, ps.status, p.deleted, p.status AS project_status
     FROM project_services ps JOIN projects p ON p.id = ps.project_id
     WHERE ps.id = ?`,
    [sid]
  );
  if (!rows.length || Number(rows[0].project_id) !== pid || rows[0].deleted) {
    throw { status: 400, message: 'Selected service does not belong to this project' };
  }
  if (!user.is_admin) {
    const [m] = await db.query(
      'SELECT 1 FROM project_service_members WHERE project_service_id = ? AND user_id = ? LIMIT 1',
      [sid, user.id]
    );
    if (!m.length) throw { status: 403, message: 'You are not a member of this service' };
  }
  return rows[0];
}

// ─── Schema (auto-migrate on startup, idempotent, MariaDB syntax) ────────────

async function ensureDailyJournalSchema() {
  const steps = [
    `ALTER TABLE smm_daily_journal ADD COLUMN IF NOT EXISTS project_service_id INT UNSIGNED DEFAULT NULL AFTER project_id`,
    `ALTER TABLE smm_daily_journal ADD INDEX IF NOT EXISTS idx_sdj_service (project_service_id)`,
    `ALTER TABLE smm_daily_journal ADD INDEX IF NOT EXISTS idx_sdj_date_user (journal_date, submitted_by)`,
    // New uniqueness: one update per project + service + date + user.
    // Added before dropping the old key so the project_id FK always keeps an index.
    `ALTER TABLE smm_daily_journal ADD UNIQUE INDEX IF NOT EXISTS uq_journal_entry_svc (project_id, project_service_id, journal_date, submitted_by)`,
    `ALTER TABLE smm_daily_journal DROP INDEX IF EXISTS uq_journal_entry`,
  ];
  for (const sql of steps) {
    try { await db.query(sql); } catch (e) { console.error('⚠️  Daily Update schema (non-fatal):', e.message); }
  }
  console.log('✅  Daily Update schema checked');
}

module.exports = {
  todayIST,
  toDateStr,
  parseJson,
  parseEntry,
  accessLevels,
  requiredServices,
  submittedKeys,
  userStatus,
  serviceLabel,
  resolveEntryService,
  ensureDailyJournalSchema,
};
