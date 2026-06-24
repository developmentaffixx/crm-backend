USE crm_task_module;

-- ============================================================
-- Shoots Module v2 - Add Reporting Time & Post Duration fields
-- Replace start_time/end_time schedule with single reporting_time
-- Replace post-shoot counts with post duration (start/end/total)
-- ============================================================

-- Add reporting_time column
ALTER TABLE shoots ADD COLUMN reporting_time TIME DEFAULT NULL AFTER shoot_date;

-- Add post-duration columns (filled after shoot is completed)
ALTER TABLE shoots ADD COLUMN post_start_time TIME DEFAULT NULL AFTER reshoot_reason;
ALTER TABLE shoots ADD COLUMN post_end_time TIME DEFAULT NULL AFTER post_start_time;
ALTER TABLE shoots ADD COLUMN post_duration_minutes INT UNSIGNED DEFAULT NULL AFTER post_end_time;

-- Migrate existing data: copy start_time to reporting_time
UPDATE shoots SET reporting_time = start_time WHERE start_time IS NOT NULL;
