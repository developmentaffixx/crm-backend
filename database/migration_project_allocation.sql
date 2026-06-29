-- ============================================================
-- Project Allocation Sheet - MySQL Schema
-- ============================================================

USE crm_task_module;

CREATE TABLE IF NOT EXISTS project_allocation_sheets (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id          INT UNSIGNED NOT NULL,

  -- Client Point of Contact
  primary_contact_name    VARCHAR(255) DEFAULT NULL,
  primary_contact_mobile  VARCHAR(50) DEFAULT NULL,
  secondary_contact_name  VARCHAR(255) DEFAULT NULL,
  secondary_contact_mobile VARCHAR(50) DEFAULT NULL,

  -- Platforms Managed (JSON array of strings)
  platforms_managed   JSON DEFAULT NULL,

  -- Content Commitment
  commitment_reels            INT DEFAULT 0,
  commitment_static_posts     INT DEFAULT 0,
  commitment_stories          INT DEFAULT 0,
  commitment_content_calendar INT DEFAULT 0,
  commitment_insight_report   INT DEFAULT 0,
  commitment_strategy_call    INT DEFAULT 0,

  -- Shoot Commitment
  shoot_sessions      VARCHAR(50) DEFAULT NULL,
  shoot_hours         VARCHAR(50) DEFAULT NULL,

  -- Community Management Commitment
  community_dm_monitoring      VARCHAR(50) DEFAULT 'Daily',
  community_comment_monitoring VARCHAR(50) DEFAULT 'Daily',
  community_review_monitoring  VARCHAR(50) DEFAULT 'Daily',
  community_lead_escalation    VARCHAR(50) DEFAULT 'Daily',

  -- Ads Commitment
  ads_campaign_setup      TINYINT(1) DEFAULT 0,
  ads_campaign_monitoring TINYINT(1) DEFAULT 0,
  ads_optimization        TINYINT(1) DEFAULT 0,
  ads_reporting           TINYINT(1) DEFAULT 0,

  -- Team Allocation (JSON array: [{role, user_id, monthly_hours}])
  team_allocation     JSON DEFAULT NULL,

  -- Special Notes
  special_notes       TEXT DEFAULT NULL,

  created_by          INT UNSIGNED NOT NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_pas_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_pas_created FOREIGN KEY (created_by) REFERENCES users(id),
  UNIQUE KEY uq_project_allocation (project_id)
) ENGINE=InnoDB;
