-- ============================================================
-- Migration: Rejected Tasks - 8 Hour Visibility Window
-- Adds rejected_at timestamp to track when a task was rejected
-- so it can be hidden from the user's main table after 8 hours.
-- ============================================================

USE crm_task_module;

-- Add rejected_at column to tasks table
ALTER TABLE tasks ADD COLUMN rejected_at DATETIME NULL DEFAULT NULL AFTER is_active;

-- Add index for efficient querying of rejected tasks within time window
ALTER TABLE tasks ADD INDEX idx_tasks_rejected_at (rejected_at);
