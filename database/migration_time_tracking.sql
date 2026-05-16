-- ============================================================
-- Time Tracking Migration
-- Run this against crm_task_module database
-- ============================================================

USE crm_task_module;

-- Add time tracking columns to tasks
ALTER TABLE tasks
  ADD COLUMN time_spent     INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Total accumulated seconds',
  ADD COLUMN timer_started_at DATETIME NULL DEFAULT NULL COMMENT 'Current active session start (NULL = not running)';

-- Time log entries table
CREATE TABLE IF NOT EXISTS task_time_logs (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  task_id      INT UNSIGNED NOT NULL,
  user_id      INT UNSIGNED NOT NULL,
  started_at   DATETIME NOT NULL,
  ended_at     DATETIME NOT NULL,
  duration     INT UNSIGNED NOT NULL COMMENT 'Duration in seconds',
  note         TEXT,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_tl_task FOREIGN KEY (task_id) REFERENCES tasks(id),
  CONSTRAINT fk_tl_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;
