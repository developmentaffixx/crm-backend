USE crm_task_module;

-- Add project_id column to content_calendar_plans
ALTER TABLE content_calendar_plans
  ADD COLUMN project_id INT UNSIGNED DEFAULT NULL AFTER client_id;

-- Make client_id optional (project may or may not have a client)
ALTER TABLE content_calendar_plans
  MODIFY COLUMN client_id INT UNSIGNED DEFAULT NULL;
