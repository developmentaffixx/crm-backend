const db = require('./db');

/**
 * Requests to meet the Founder (department-head requests and employee one-to-ones).
 * When approved, a row is created in `meetings` (type 'office') and linked via meeting_id.
 */
async function ensureMeetingRequestsTable() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS meeting_requests (
        id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        request_type      ENUM('department','one_to_one') NOT NULL,
        requested_by      INT UNSIGNED NOT NULL,
        founder_id        INT UNSIGNED NOT NULL,
        title             VARCHAR(255) NOT NULL,
        purpose           TEXT DEFAULT NULL,
        preferred_date    DATE NOT NULL,
        preferred_time    TIME DEFAULT NULL,
        duration_minutes  SMALLINT UNSIGNED NOT NULL DEFAULT 30,
        status            ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
        decision_note     TEXT DEFAULT NULL,
        decided_by        INT UNSIGNED DEFAULT NULL,
        decided_at        DATETIME DEFAULT NULL,
        meeting_id        INT UNSIGNED DEFAULT NULL,
        created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_founder_status (founder_id, status),
        INDEX idx_requested_by (requested_by)
      ) ENGINE=InnoDB
    `);
    console.log('[meeting-requests] table verified/created');
  } catch (err) {
    console.error('[meeting-requests] ensureMeetingRequestsTable failed:', err.code, err.message);
  }
}

module.exports = ensureMeetingRequestsTable;
