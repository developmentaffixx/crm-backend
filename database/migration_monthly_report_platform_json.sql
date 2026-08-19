-- Migration: Change platform column from ENUM to JSON for multi-select support
-- Run this if you already created the table with ENUM platform

-- Step 1: Add new JSON column
ALTER TABLE smm_monthly_reports ADD COLUMN IF NOT EXISTS platform_new JSON DEFAULT NULL AFTER platform;

-- Step 2: Migrate existing data
UPDATE smm_monthly_reports SET platform_new = JSON_ARRAY(platform) WHERE platform_new IS NULL;

-- Step 3: Drop old column and rename
ALTER TABLE smm_monthly_reports DROP COLUMN platform;
ALTER TABLE smm_monthly_reports CHANGE COLUMN platform_new platform JSON NOT NULL DEFAULT (JSON_ARRAY('instagram'));

-- Also drop the old unique key that included platform and add new one
ALTER TABLE smm_monthly_reports DROP INDEX IF EXISTS uq_project_month_platform;
ALTER TABLE smm_monthly_reports ADD UNIQUE KEY IF NOT EXISTS uq_project_month (project_id, reporting_month);
