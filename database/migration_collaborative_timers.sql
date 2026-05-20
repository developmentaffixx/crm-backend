-- ============================================================
-- Collaborative Timers Migration
-- Allows multiple users to run timers on the same task simultaneously
-- Run this against crm_task_module database
-- ============================================================

USE crm_task_module;

-- Per-user active timer tracking
CREATE TABLE IF NOT EXISTS task_active_timers (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  task_id    INT UNSIGNED NOT NULL,
  user_id    INT UNSIGNED NOT NULL,
  started_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_task_user_timer (task_id, user_id),
  CONSTRAINT fk_tat_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_tat_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

-- Index for quick lookup of user's active timers across all tasks
CREATE INDEX idx_tat_user ON task_active_timers (user_id);
