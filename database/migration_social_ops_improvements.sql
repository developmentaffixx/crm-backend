USE crm_task_module;

-- ============================================================
-- Social Media Ops Improvements Migration
-- ============================================================

-- 1. Add content_id_code column to content_write_requests if not exists
-- (Controller generates CNT-CLIENT-### codes but column may be missing)
ALTER TABLE content_write_requests
  ADD COLUMN IF NOT EXISTS content_id_code VARCHAR(50) DEFAULT NULL AFTER id;

-- Add unique index on content_id_code
ALTER TABLE content_write_requests
  ADD UNIQUE INDEX IF NOT EXISTS idx_cwr_content_id_code (content_id_code);

-- 2. Add unique constraint on daily journal to prevent duplicate entries
-- (Same user, same project, same date)
ALTER TABLE smm_daily_journal
  ADD UNIQUE INDEX IF NOT EXISTS uq_journal_project_date_user (project_id, journal_date, submitted_by);

-- 3. Link ad_campaigns to content_calendar_ads (bridge column)
ALTER TABLE content_calendar_ads
  ADD COLUMN IF NOT EXISTS linked_campaign_id INT UNSIGNED DEFAULT NULL AFTER plan_id;

ALTER TABLE ad_campaigns
  ADD COLUMN IF NOT EXISTS linked_calendar_ad_id INT UNSIGNED DEFAULT NULL AFTER notes;

-- 4. Add validation columns for workflow enforcement
ALTER TABLE content_calendar_posts
  ADD COLUMN IF NOT EXISTS brief_approved TINYINT(1) DEFAULT 0 AFTER status;

-- 5. Add pagination support index for content_calendar_plans
ALTER TABLE content_calendar_plans
  ADD INDEX IF NOT EXISTS idx_ccp_month_created (plan_month, created_at);

-- 6. Add reschedule validation - store plan month range
ALTER TABLE content_calendar_plans
  ADD COLUMN IF NOT EXISTS month_start DATE DEFAULT NULL AFTER plan_month,
  ADD COLUMN IF NOT EXISTS month_end DATE DEFAULT NULL AFTER month_start;
