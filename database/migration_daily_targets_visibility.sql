USE crm_task_module;

-- Add is_visible column to daily_targets_settings to control target bar visibility in Daily Reporting
ALTER TABLE daily_targets_settings
  ADD COLUMN IF NOT EXISTS is_visible TINYINT(1) NOT NULL DEFAULT 1 AFTER id;
