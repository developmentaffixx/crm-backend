-- ============================================================
-- Add 'upcoming' status to service_cycles ENUM
-- Allows cycles to be created for future date ranges
-- ============================================================

USE crm_task_module;

ALTER TABLE service_cycles
  MODIFY COLUMN status ENUM('upcoming','active','paused','completed','skipped') NOT NULL DEFAULT 'active';
