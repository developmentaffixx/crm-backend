const db = require('./db');

/**
 * Adds the delay-type columns to task_deadline_extension_requests.
 * Runs on server startup; safe to run repeatedly.
 *   delay_type    : 'client' | 'team' | 'general'
 *   delay_reasons : JSON array of the selected options (client / team only)
 */
async function ensureExtensionColumns() {
  try {
    await db.query(
      "ALTER TABLE task_deadline_extension_requests ADD COLUMN IF NOT EXISTS delay_type VARCHAR(20) NOT NULL DEFAULT 'general'"
    );
    await db.query(
      'ALTER TABLE task_deadline_extension_requests ADD COLUMN IF NOT EXISTS delay_reasons TEXT NULL'
    );
    console.log('[extensions] delay_type / delay_reasons columns verified');

    // "Delay Request" permission (Settings → Roles → Tasks). Default ON for every
    // existing role; INSERT IGNORE never overwrites a value that was already saved.
    await db.query(
      `INSERT IGNORE INTO role_submenu_permissions (role_id, module, submenu, can_access)
       SELECT id, 'tasks', 'delay_request', 1 FROM roles`
    );
  } catch (err) {
    console.error('[extensions] ensureExtensionColumns failed (non-fatal):', err.message);
  }
}

module.exports = ensureExtensionColumns;
