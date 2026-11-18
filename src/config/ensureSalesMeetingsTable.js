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
      // ── Added for the Sales → Meetings rework ──
      // created_by = who BOOKED the meeting, attendee_id = who ATTENDS it
      'attendee_id INT UNSIGNED DEFAULT NULL',
      "meeting_type VARCHAR(30) NOT NULL DEFAULT 'discovery'",
      'location_or_link VARCHAR(500) DEFAULT NULL',
      'reschedule_of INT UNSIGNED DEFAULT NULL',
    ];
    for (const col of columns) {
      try {
        await db.query(`ALTER TABLE sales_meetings ADD COLUMN IF NOT EXISTS ${col}`);
      } catch (e) {
        console.error('[sales-meetings] column check failed:', col.split(' ')[0], e.message);
      }
    }

    // Existing rows: the person who booked the meeting also attends it.
    await db.query('UPDATE sales_meetings SET attendee_id = created_by WHERE attendee_id IS NULL');

    try {
      await db.query('ALTER TABLE sales_meetings ADD INDEX idx_attendee_id (attendee_id)');
    } catch (e) {
      if (e.code !== 'ER_DUP_KEYNAME') console.error('[sales-meetings] index idx_attendee_id:', e.message);
    }

    await seedMeetingAccessOnce();

    console.log('[sales-meetings] table verified/created');
  } catch (err) {
    console.error('[sales-meetings] ensureSalesMeetingsTable failed:', err.code, err.errno, err.message);
  }
}

/**
 * One-time migration of Meetings access.
 *
 * Before this rework the Meetings page was gated by the Sales → "leads" submenu
 * and every user could book / edit / delete their own meetings. Meetings now
 * have their own submenu ("meetings") plus on/off switches in Settings → Roles.
 *
 * So existing roles / users do not lose access, copy their current "leads"
 * level to "meetings" and switch on book / attend / edit / delete (the old
 * behaviour). Team Reports starts OFF. Runs only while NO "meetings" row exists
 * anywhere, so it never overwrites what an admin sets later.
 */
async function seedMeetingAccessOnce() {
  try {
    const [already] = await db.query(
      `SELECT 1 FROM role_submenu_permissions WHERE module = 'revenue' AND submenu = 'meetings'
       UNION ALL
       SELECT 1 FROM user_submenu_permissions WHERE module = 'revenue' AND submenu = 'meetings'
       LIMIT 1`
    );
    if (already.length > 0) return;

    await db.query(
      `INSERT IGNORE INTO role_submenu_permissions (role_id, module, submenu, can_access)
       SELECT role_id, 'revenue', 'meetings', can_access
       FROM role_submenu_permissions WHERE module = 'revenue' AND submenu = 'leads'`
    );
    for (const key of ['meeting_book', 'meeting_attend', 'meeting_edit', 'meeting_delete']) {
      await db.query(
        `INSERT IGNORE INTO role_submenu_permissions (role_id, module, submenu, can_access)
         SELECT role_id, 'revenue', ?, 1
         FROM role_submenu_permissions WHERE module = 'revenue' AND submenu = 'leads' AND can_access >= 1`,
        [key]
      );
    }

    // Per-user overrides on the old "leads" key
    await db.query(
      `INSERT IGNORE INTO user_submenu_permissions (user_id, module, submenu, can_access)
       SELECT user_id, 'revenue', 'meetings', can_access
       FROM user_submenu_permissions WHERE module = 'revenue' AND submenu = 'leads'`
    );
    for (const key of ['meeting_book', 'meeting_attend', 'meeting_edit', 'meeting_delete']) {
      await db.query(
        `INSERT IGNORE INTO user_submenu_permissions (user_id, module, submenu, can_access)
         SELECT user_id, 'revenue', ?, 1
         FROM user_submenu_permissions WHERE module = 'revenue' AND submenu = 'leads' AND can_access >= 1`,
        [key]
      );
    }
    console.log('[sales-meetings] meetings access seeded from leads access (one-time)');
  } catch (err) {
    console.error('[sales-meetings] seedMeetingAccessOnce failed:', err.message);
  }
}

module.exports = ensureSalesMeetingsTable;
