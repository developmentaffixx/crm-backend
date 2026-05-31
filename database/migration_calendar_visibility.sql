USE crm_task_module;

-- Add visibility column to calendar_events
ALTER TABLE calendar_events
  ADD COLUMN visibility ENUM('personal', 'team', 'company') NOT NULL DEFAULT 'personal' AFTER category;
