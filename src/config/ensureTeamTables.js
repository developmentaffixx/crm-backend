const db = require('./db');

/**
 * Ensures the Team Management tables exist. Runs on server startup so a code
 * deploy is enough to make the feature work — no manual migration step needed.
 * Safe to run repeatedly (CREATE TABLE IF NOT EXISTS).
 */
async function ensureTeamTables() {
  try {
    // NOTE: tables are created WITHOUT foreign-key constraints on purpose.
    // Production schemas can differ (e.g. users.id signedness), and a strict
    // FK would make CREATE TABLE fail with errno 150. All relational rules
    // (one team per user, valid users, cascade cleanup) are enforced in the
    // application layer, so the DB-level FKs are not required for correctness.
    await db.query(`
      CREATE TABLE IF NOT EXISTS teams (
        id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        name        VARCHAR(150) NOT NULL,
        description TEXT,
        deleted     TINYINT(1) NOT NULL DEFAULT 0,
        created_by  INT UNSIGNED,
        created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_teams_deleted (deleted)
      ) ENGINE=InnoDB
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS team_members (
        id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        team_id    INT UNSIGNED NOT NULL,
        user_id    INT UNSIGNED NOT NULL,
        role       ENUM('head', 'member') NOT NULL DEFAULT 'member',
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_team_member_user (user_id),
        INDEX idx_team_members_team (team_id),
        INDEX idx_team_members_role (role)
      ) ENGINE=InnoDB
    `);

    console.log('[teams] tables verified/created');
  } catch (err) {
    console.error('[teams] ensureTeamTables failed:', err.code, err.errno, err.message);
    throw err;
  }
}

module.exports = ensureTeamTables;
