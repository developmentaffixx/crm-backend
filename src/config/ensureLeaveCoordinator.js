const db = require('./db');

/**
 * Leave → Head (coordinator) approval workflow schema.
 * Runs on server startup; safe to run repeatedly.
 *
 *   leaves.coordinator_id    : the Head tagged by the employee (NULL = no head, HR/Admin approves directly)
 *   leaves.head_status       : 'not_required' | 'pending' | 'approved' | 'rejected'
 *   leave_notifications      : in-app notifications for leave events (shown in the notification bell)
 *
 * Existing leaves keep head_status = 'not_required' so history is unaffected.
 * No foreign keys on purpose (same portability reason as ensureTeamTables).
 */
async function ensureLeaveCoordinator() {
  try {
    await db.query('ALTER TABLE leaves ADD COLUMN IF NOT EXISTS coordinator_id INT UNSIGNED NULL');
    await db.query(
      "ALTER TABLE leaves ADD COLUMN IF NOT EXISTS head_status ENUM('not_required','pending','approved','rejected') NOT NULL DEFAULT 'not_required'"
    );
    await db.query('ALTER TABLE leaves ADD COLUMN IF NOT EXISTS head_actioned_by INT UNSIGNED NULL');
    await db.query('ALTER TABLE leaves ADD COLUMN IF NOT EXISTS head_remarks VARCHAR(500) NULL');
    await db.query('ALTER TABLE leaves ADD COLUMN IF NOT EXISTS head_actioned_at DATETIME NULL');
    await db.query('ALTER TABLE leaves ADD INDEX IF NOT EXISTS idx_leaves_coordinator (coordinator_id)');

    await db.query(`
      CREATE TABLE IF NOT EXISTS leave_notifications (
        id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        user_id    INT UNSIGNED NOT NULL,
        leave_id   INT UNSIGNED NOT NULL,
        type       VARCHAR(30) NOT NULL,
        title      VARCHAR(255) NOT NULL,
        message    TEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_leave_notif_user (user_id, created_at),
        INDEX idx_leave_notif_leave (leave_id)
      ) ENGINE=InnoDB
    `);

    console.log('[leaves] coordinator columns / leave_notifications verified');
  } catch (err) {
    console.error('[leaves] ensureLeaveCoordinator failed (non-fatal):', err.message);
  }
}

module.exports = ensureLeaveCoordinator;
