-- Migration: Update project_allocation_sheets for deliverables changes
-- 1. Change commitment_stories, commitment_content_calendar, commitment_insight_report, commitment_strategy_call from INT to VARCHAR (dropdown values)
-- 2. Change shoot_sessions to VARCHAR (dropdown: Main Session / Patch Session)
-- 3. Add ads_pre_ad_report and ads_post_ad_report columns
-- 4. Remove old ads columns (campaign_setup, campaign_monitoring, optimization, reporting)

ALTER TABLE project_allocation_sheets
  MODIFY COLUMN commitment_stories VARCHAR(50) DEFAULT NULL,
  MODIFY COLUMN commitment_content_calendar VARCHAR(50) DEFAULT NULL,
  MODIFY COLUMN commitment_insight_report VARCHAR(50) DEFAULT NULL,
  MODIFY COLUMN commitment_strategy_call VARCHAR(50) DEFAULT NULL,
  MODIFY COLUMN shoot_sessions VARCHAR(50) DEFAULT NULL,
  MODIFY COLUMN shoot_hours VARCHAR(50) DEFAULT NULL;

ALTER TABLE project_allocation_sheets
  ADD COLUMN ads_pre_ad_report TINYINT(1) DEFAULT 0 AFTER ads_reporting,
  ADD COLUMN ads_post_ad_report TINYINT(1) DEFAULT 0 AFTER ads_pre_ad_report;

ALTER TABLE project_allocation_sheets
  DROP COLUMN ads_campaign_setup,
  DROP COLUMN ads_campaign_monitoring,
  DROP COLUMN ads_optimization,
  DROP COLUMN ads_reporting;
