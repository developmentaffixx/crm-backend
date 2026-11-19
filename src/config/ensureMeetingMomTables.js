const db = require('./db');

/**
 * Minutes of Meeting (MOM) tables, shared by Lead (sales_meetings) and
 * Client / Team (meetings) meetings.
 *   source = 'sales'   -> meeting_id is sales_meetings.id
 *   source = 'general' -> meeting_id is meetings.id
 * No foreign keys, following the other ensure* scripts.
 */
async function ensureMeetingMomTables() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS meeting_moms (
        id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        source              ENUM('sales','general') NOT NULL,
        meeting_id          INT UNSIGNED NOT NULL,
        discussion          TEXT DEFAULT NULL,
        client_requirements TEXT DEFAULT NULL,
        decisions           TEXT DEFAULT NULL,
        next_steps          TEXT DEFAULT NULL,
        submitted_by        INT UNSIGNED NOT NULL,
        created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_meeting (source, meeting_id)
      ) ENGINE=InnoDB
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS meeting_action_items (
        id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        source          ENUM('sales','general') NOT NULL,
        meeting_id      INT UNSIGNED NOT NULL,
        title           VARCHAR(255) NOT NULL,
        assigned_to     INT UNSIGNED DEFAULT NULL,
        due_date        DATE DEFAULT NULL,
        priority        ENUM('low','medium','high') NOT NULL DEFAULT 'medium',
        converted_type  ENUM('task','ticket') DEFAULT NULL,
        converted_id    INT UNSIGNED DEFAULT NULL,
        created_by      INT UNSIGNED NOT NULL,
        deleted         TINYINT(1) DEFAULT 0,
        created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_meeting (source, meeting_id)
      ) ENGINE=InnoDB
    `);
    console.log('[meeting-moms] tables verified/created');
  } catch (err) {
    console.error('[meeting-moms] ensureMeetingMomTables failed:', err.code, err.message);
  }
}

module.exports = ensureMeetingMomTables;
