USE crm_task_module;

-- ============================================================
-- RESET: Delete all SMM Operations data and start fresh
-- Run this BEFORE running migration_smm_simplified_workflow.sql
-- ============================================================

-- Disable foreign key checks temporarily
SET FOREIGN_KEY_CHECKS = 0;

-- 1. Delete all SMM notifications (if table exists)
DROP TABLE IF EXISTS smm_notifications;

-- 2. Delete all content calendar children
TRUNCATE TABLE content_calendar_ads;
TRUNCATE TABLE content_calendar_shoots;
TRUNCATE TABLE content_calendar_posts;

-- 3. Delete all content calendar plans
TRUNCATE TABLE content_calendar_plans;

-- 4. Delete all content write requests
TRUNCATE TABLE content_write_requests;

-- 5. Delete all shoots
TRUNCATE TABLE shoots;

-- 6. Delete all ad campaigns and reports
TRUNCATE TABLE ad_campaign_reports;
TRUNCATE TABLE ad_campaigns;

-- Re-enable foreign key checks
SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- DONE: All SMM data cleared. Now run:
-- migration_smm_simplified_workflow.sql
-- ============================================================
