USE crm_task_module;

-- Add cycle_id to content_calendar_plans so plans are linked to a specific cycle
ALTER TABLE content_calendar_plans
  ADD COLUMN cycle_id INT UNSIGNED DEFAULT NULL AFTER project_id;

-- Add index for faster lookups
ALTER TABLE content_calendar_plans
  ADD INDEX idx_ccp_cycle (cycle_id);
