-- ============================================================
-- Ticket Timers Migration
-- Adds start/stop timer support for Work mode tickets
-- (similar to task_active_timers for tasks)
-- Run this against crm_task_module database
-- ============================================================

USE crm_task_module;

-- Per-user active timer tracking for tickets
CREATE TABLE IF NOT EXISTS ticket_active_timers (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ticket_id  INT UNSIGNED NOT NULL,
  user_id    INT UNSIGNED NOT NULL,
  started_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ticket_user_timer (ticket_id, user_id),
  CONSTRAINT fk_tkat_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  CONSTRAINT fk_tkat_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

-- Index for quick lookup of user's active timers across all tickets
CREATE INDEX idx_tkat_user ON ticket_active_timers (user_id);

-- Add started_at, ended_at, duration columns to ticket_time_logs for timer-based entries
ALTER TABLE ticket_time_logs
  ADD COLUMN started_at DATETIME DEFAULT NULL AFTER description,
  ADD COLUMN ended_at   DATETIME DEFAULT NULL AFTER started_at,
  ADD COLUMN duration   INT UNSIGNED DEFAULT NULL AFTER ended_at;

-- Add timer_started_at to tickets table for backward compat
ALTER TABLE tickets
  ADD COLUMN timer_started_at DATETIME DEFAULT NULL AFTER total_time_minutes;

-- Add paused_ticket_id to afs_logs for ticket timer pause/resume
ALTER TABLE afs_logs
  ADD COLUMN paused_ticket_id INT UNSIGNED DEFAULT NULL AFTER paused_task_id,
  ADD CONSTRAINT fk_afs_paused_ticket FOREIGN KEY (paused_ticket_id) REFERENCES tickets(id) ON DELETE SET NULL;
