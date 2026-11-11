const db = require('./db');

/**
 * Ensures the CEO Reminder tables exist. Runs on server startup so a code
 * deploy is enough — no manual migration step. Safe to run repeatedly.
 * No FK constraints (same portability reason as ensureTeamTables.js).
 */
async function ensureReminderTables() {
  try {
    // One row per recipient. A reminder sent to several heads at once shares a batch_id.
    await db.query(`
      CREATE TABLE IF NOT EXISTS ceo_reminders (
        id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        reminder_code     VARCHAR(30) DEFAULT NULL,
        batch_id          VARCHAR(40) NOT NULL,
        type              ENUM('task','ticket','deadline','meeting','discussion','follow_up','general') NOT NULL DEFAULT 'general',
        title             VARCHAR(255) NOT NULL,
        description       TEXT,
        priority          ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
        due_at            DATETIME DEFAULT NULL,

        -- Recipient (a team head from Settings → Team Management)
        recipient_user_id INT UNSIGNED NOT NULL,
        team_id           INT UNSIGNED DEFAULT NULL,
        team_name         VARCHAR(150) DEFAULT NULL,

        -- Optional link to an existing record (never creates a new one)
        linked_type       ENUM('task','ticket','sales_meeting') DEFAULT NULL,
        linked_id         INT UNSIGNED DEFAULT NULL,

        -- Meeting / scheduled discussion details
        meeting_date      DATE DEFAULT NULL,
        meeting_time      TIME DEFAULT NULL,
        agenda            TEXT,

        status            ENUM('pending','viewed','acknowledged','in_progress','completed','closed') NOT NULL DEFAULT 'pending',

        -- Lifecycle timestamps
        delivered_at      DATETIME DEFAULT NULL,
        viewed_at         DATETIME DEFAULT NULL,
        acknowledged_at   DATETIME DEFAULT NULL,
        in_progress_at    DATETIME DEFAULT NULL,
        completed_at      DATETIME DEFAULT NULL,
        closed_at         DATETIME DEFAULT NULL,

        followup_count    INT UNSIGNED NOT NULL DEFAULT 0,
        last_followup_at  DATETIME DEFAULT NULL,
        due_soon_notified_at DATETIME DEFAULT NULL,
        overdue_notified_at  DATETIME DEFAULT NULL,

        created_by        INT UNSIGNED NOT NULL,
        deleted           TINYINT(1) NOT NULL DEFAULT 0,
        created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

        INDEX idx_rem_recipient (recipient_user_id, status),
        INDEX idx_rem_team (team_id),
        INDEX idx_rem_batch (batch_id),
        INDEX idx_rem_link (linked_type, linked_id),
        INDEX idx_rem_due (due_at),
        INDEX idx_rem_deleted (deleted)
      ) ENGINE=InnoDB
    `);

    // Full history / timeline for every reminder
    await db.query(`
      CREATE TABLE IF NOT EXISTS ceo_reminder_activity (
        id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        reminder_id  INT UNSIGNED NOT NULL,
        action       VARCHAR(30) NOT NULL,
        from_status  VARCHAR(20) DEFAULT NULL,
        to_status    VARCHAR(20) DEFAULT NULL,
        note         TEXT,
        acted_by     INT UNSIGNED DEFAULT NULL,
        created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_rem_act_reminder (reminder_id)
      ) ENGINE=InnoDB
    `);

    console.log('[ceo-reminders] tables verified/created');
  } catch (err) {
    console.error('[ceo-reminders] ensureReminderTables failed:', err.code, err.errno, err.message);
  }
}

module.exports = ensureReminderTables;
