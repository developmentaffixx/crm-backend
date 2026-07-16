-- ============================================================
-- Task Service Link Migration
-- Adds service_id to project_tasks so a task can be linked to
-- a specific service within its project.
-- ============================================================

USE crm_task_module;

-- Add service_id column to project_tasks (nullable for backward compat)
ALTER TABLE project_tasks
  ADD COLUMN service_id INT UNSIGNED DEFAULT NULL AFTER project_id;

-- Add foreign key constraint
ALTER TABLE project_tasks
  ADD CONSTRAINT fk_pt_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL;
