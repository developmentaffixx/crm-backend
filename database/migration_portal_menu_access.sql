USE crm_task_module;

-- ============================================================
-- Portal Menu Access - Per-client toggle for each portal menu
-- Extends client_portal_users with individual menu access flags
-- Default: all enabled (1) so existing clients keep full access
-- ============================================================

ALTER TABLE client_portal_users
  ADD COLUMN access_approvals TINYINT(1) NOT NULL DEFAULT 1 AFTER content_calendar_access,
  ADD COLUMN access_reports TINYINT(1) NOT NULL DEFAULT 1 AFTER access_approvals,
  ADD COLUMN access_files TINYINT(1) NOT NULL DEFAULT 1 AFTER access_reports,
  ADD COLUMN access_meetings TINYINT(1) NOT NULL DEFAULT 1 AFTER access_files,
  ADD COLUMN access_roadmap TINYINT(1) NOT NULL DEFAULT 1 AFTER access_meetings,
  ADD COLUMN access_ideas TINYINT(1) NOT NULL DEFAULT 1 AFTER access_roadmap,
  ADD COLUMN access_weekly_updates TINYINT(1) NOT NULL DEFAULT 1 AFTER access_ideas,
  ADD COLUMN access_milestones TINYINT(1) NOT NULL DEFAULT 1 AFTER access_weekly_updates,
  ADD COLUMN access_behind_scenes TINYINT(1) NOT NULL DEFAULT 1 AFTER access_milestones,
  ADD COLUMN access_knowledge_hub TINYINT(1) NOT NULL DEFAULT 1 AFTER access_behind_scenes,
  ADD COLUMN access_support TINYINT(1) NOT NULL DEFAULT 1 AFTER access_knowledge_hub;
