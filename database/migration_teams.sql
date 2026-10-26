-- ============================================================
-- Team Management Migration
-- A "team" groups active users together. One or more members are
-- marked as 'head'. A head sees & approves tasks/tickets for every
-- member of their team (the head is counted as a member too).
--
-- Rules enforced by the app layer:
--   - A user belongs to at most ONE team (enforced by UNIQUE on user_id).
--   - A team can have one OR multiple heads.
--   - Only active users are added to teams.
--
-- Run this against crm_task_module database.
-- ============================================================

USE crm_task_module;

-- ------------------------------------------------------------
-- 1. Teams
-- ------------------------------------------------------------
-- NOTE: no foreign-key constraints — production schemas may differ
-- (e.g. users.id signedness) and strict FKs can fail with errno 150.
-- All relational rules are enforced in the application layer.
CREATE TABLE IF NOT EXISTS teams (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(150) NOT NULL,
  description TEXT,
  deleted     TINYINT(1) NOT NULL DEFAULT 0,
  created_by  INT UNSIGNED,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_teams_deleted (deleted)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- 2. Team members junction
-- role: 'head' = supervisor/approver for the team, 'member' = regular
-- A user can be in only one team -> UNIQUE on user_id.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS team_members (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  team_id    INT UNSIGNED NOT NULL,
  user_id    INT UNSIGNED NOT NULL,
  role       ENUM('head', 'member') NOT NULL DEFAULT 'member',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_team_member_user (user_id),
  INDEX idx_team_members_team (team_id),
  INDEX idx_team_members_role (role)
) ENGINE=InnoDB;
