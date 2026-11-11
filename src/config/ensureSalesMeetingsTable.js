const db = require('./db');

/**
 * Ensures the `sales_meetings` table (Revenue → Meetings) exists and has all
 * the columns the code uses. Runs on server startup; safe to run repeatedly.
 *
 * Previously this table was only created by database/migration_sales_meetings.sql,
 * which uses FOREIGN KEYs. On servers where users.id / leads.id signedness
 * differs, that CREATE fails (errno 150) and the table never exists → every
 * /api/sales-meetings call returns 500. Created here WITHOUT FKs (same approach
 * as ensureTeamTables.js); relations are enforced in the application layer.
 */
async function ensureSalesMeetingsTable() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS sales_meetings (
        id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        lead_id               INT UNSIGNED DEFAULT NULL,
        created_by            INT UNSIGNED NOT NULL,
        meeting_date          DATE NOT NULL,
        slot                  ENUM('morning','afternoon','evening') NOT NULL,
        mode                  ENUM('online','offline') DEFAULT 'online',
        title                 VARCHAR(255) DEFAULT NULL,
        notes                 TEXT DEFAULT NULL,
        pre_confirmed         TINYINT(1) DEFAULT 0,
        pre_confirmed_at      DATETIME DEFAULT NULL,
        pre_confirmed_by      INT UNSIGNED DEFAULT NULL,
        post_confirmed        TINYINT(1) DEFAULT 0,
        post_confirmed_at     DATETIME DEFAULT NULL,
        post_confirmed_note   TEXT DEFAULT NULL,
        outcome               ENUM('pending','attended','no_show','rescheduled','converted','follow_up') DEFAULT 'pending',
        followup_meeting_id   INT UNSIGNED DEFAULT NULL,
        linked_follow_up_id   INT UNSIGNED DEFAULT NULL,
        deleted               TINYINT(1) DEFAULT 0,
        created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at            DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_meeting_date (meeting_date),
        INDEX idx_created_by (created_by),
        INDEX idx_lead_id (lead_id)
      ) ENGINE=InnoDB
    `);

    // If an older/partial version of the table exists, add any missing columns.
    const columns = [
      "mode ENUM('online','offline') DEFAULT 'online'",
      'title VARCHAR(255) DEFAULT NULL',
      'notes TEXT DEFAULT NULL',
      'pre_confirmed TINYINT(1) DEFAULT 0',
      'pre_confirmed_at DATETIME DEFAULT NULL',
      'pre_confirmed_by INT UNSIGNED DEFAULT NULL',
      'post_confirmed TINYINT(1) DEFAULT 0',
      'post_confirmed_at DATETIME DEFAULT NULL',
      'post_confirmed_note TEXT DEFAULT NULL',
      "outcome ENUM('pending','attended','no_show','rescheduled','converted','follow_up') DEFAULT 'pending'",
      'followup_meeting_id INT UNSIGNED DEFAULT NULL',
      'linked_follow_up_id INT UNSIGNED DEFAULT NULL',
      'deleted TINYINT(1) DEFAULT 0',
      'created_at DATETIME DEFAULT CURRENT_TIMESTAMP',
      'updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP',
    ];
    for (const col of columns) {
      try {
        await db.query(`ALTER TABLE sales_meetings ADD COLUMN IF NOT EXISTS ${col}`);
      } catch (e) {
        console.error('[sales-meetings] column check failed:', col.split(' ')[0], e.message);
      }
    }

    console.log('[sales-meetings] table verified/created');
  } catch (err) {
    console.error('[sales-meetings] ensureSalesMeetingsTable failed:', err.code, err.errno, err.message);
  }
}

module.exports = ensureSalesMeetingsTable;
