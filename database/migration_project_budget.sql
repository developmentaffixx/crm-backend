-- ============================================================
-- Add budget field to projects table
-- Enables budget vs actual expense tracking in reports
-- ============================================================

USE crm_task_module;

ALTER TABLE projects
  ADD COLUMN budget DECIMAL(12,2) DEFAULT NULL AFTER end_date;
