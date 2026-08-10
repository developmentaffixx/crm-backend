USE crm_task_module;

-- ============================================================
-- Shoots Module - Add in_summary field for close requests
-- ============================================================

ALTER TABLE shoots ADD COLUMN in_summary TEXT DEFAULT NULL AFTER post_duration_minutes;
