-- ============================================================
-- Tasks V2 Migration
-- Features: Multi-assignee, Activity log, Rejected state, Pagination support
-- Run this against crm_task_module database
-- ============================================================

USE crm_task_module;

-- ------------------------------------------------------------
-- 1. Multi-Assignee Junction Table
-- primary_assignee remains on tasks table for backward compat
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_assignees (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  task_id    INT UNSIGNED NOT NULL,
  user_id    INT UNSIGNED NOT NULL,
  role       ENUM('primary', 'collaborator') NOT NULL DEFAULT 'collaborator',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_task_assignee_user (task_id, user_id),
  CONSTRAINT fk_task_assignees_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_task_assignees_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- 2. Activity Log / History Table
-- Tracks all changes on a task for audit trail
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_activity_log (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  task_id    INT UNSIGNED NOT NULL,
  user_id    INT UNSIGNED NOT NULL,
  action     VARCHAR(50) NOT NULL COMMENT 'created, updated, status_changed, assigned, approved, rejected, marked_done, reopened, deleted, timer_started, timer_stopped, extension_requested, forwarded',
  field_name VARCHAR(50) NULL COMMENT 'Which field changed (for updates)',
  old_value  TEXT NULL,
  new_value  TEXT NULL,
  note       TEXT NULL COMMENT 'Optional description',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_task_activity_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_task_activity_user FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_tal_task (task_id),
  INDEX idx_tal_created (created_at)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- 3. Update is_active to support rejected state
-- is_active: 0=pending, 1=active, 2=pending_closing, 3=closed, 4=rejected
-- ------------------------------------------------------------
-- No schema change needed since is_active is TINYINT(1), value 4 is valid

-- ------------------------------------------------------------
-- 4. Add indexes for pagination/sorting performance
-- ------------------------------------------------------------
ALTER TABLE tasks ADD INDEX idx_tasks_deadline (deadline);
ALTER TABLE tasks ADD INDEX idx_tasks_priority (priority);
ALTER TABLE tasks ADD INDEX idx_tasks_status (status);
ALTER TABLE tasks ADD INDEX idx_tasks_is_active (is_active);
ALTER TABLE tasks ADD INDEX idx_tasks_created_at (created_at);
ALTER TABLE tasks ADD INDEX idx_tasks_assigned_to (assigned_to);

-- ------------------------------------------------------------
-- 5. Populate task_assignees from existing assigned_to data
-- (Run once to backfill existing tasks)
-- ------------------------------------------------------------
INSERT IGNORE INTO task_assignees (task_id, user_id, role)
SELECT id, assigned_to, 'primary' FROM tasks WHERE deleted = 0 AND assigned_to IS NOT NULL;
