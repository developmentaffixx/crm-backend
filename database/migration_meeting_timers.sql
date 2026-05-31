-- ============================================================
-- Meeting Timers Migration
-- Adds start/stop timer support for meetings
-- (similar to task_active_timers / ticket_active_timers)
-- Run this against crm_task_module database
-- ============================================================

USE crm_task_module;

-- Per-user active timer tracking for meetings
CREATE TABLE IF NOT EXISTS meeting_active_timers (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  meeting_id INT UNSIGNED NOT NULL,
  user_id    INT UNSIGNED NOT NULL,
  started_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_meeting_user_timer (meeting_id, user_id),
  CONSTRAINT fk_mat_meeting FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
  CONSTRAINT fk_mat_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

-- Index for quick lookup of user's active timers across all meetings
CREATE INDEX idx_mat_user ON meeting_active_timers (user_id);

-- Meeting time logs (records each timer session)
CREATE TABLE IF NOT EXISTS meeting_time_logs (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  meeting_id  INT UNSIGNED NOT NULL,
  user_id     INT UNSIGNED NOT NULL,
  started_at  DATETIME NOT NULL,
  ended_at    DATETIME NOT NULL,
  duration    INT UNSIGNED NOT NULL COMMENT 'Duration in seconds',
  note        TEXT DEFAULT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_mtl_meeting FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE,
  CONSTRAINT fk_mtl_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE INDEX idx_mtl_meeting ON meeting_time_logs (meeting_id);
CREATE INDEX idx_mtl_user ON meeting_time_logs (user_id);

-- Add total_time_seconds to meetings table for quick access
ALTER TABLE meetings
  ADD COLUMN total_time_seconds INT UNSIGNED NOT NULL DEFAULT 0 AFTER mom;

-- Add timer_started_at to meetings table for backward compat
ALTER TABLE meetings
  ADD COLUMN timer_started_at DATETIME DEFAULT NULL AFTER total_time_seconds;

-- Add paused_meeting_id to afs_logs for meeting timer pause/resume
ALTER TABLE afs_logs
  ADD COLUMN paused_meeting_id INT UNSIGNED DEFAULT NULL AFTER paused_ticket_id,
  ADD CONSTRAINT fk_afs_paused_meeting FOREIGN KEY (paused_meeting_id) REFERENCES meetings(id) ON DELETE SET NULL;
