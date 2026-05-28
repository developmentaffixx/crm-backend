USE crm_task_module;

-- ============================================================
-- Content Calendar Module - Database Migration
-- ============================================================

-- ------------------------------------------------------------
-- Monthly content plans (parent table)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_calendar_plans (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  
  -- Client & Month
  client_id           INT UNSIGNED NOT NULL,
  plan_month          DATE NOT NULL COMMENT 'First day of the month (e.g. 2026-05-01)',
  
  -- Strategy
  primary_goal        TEXT,
  target_audience     TEXT,
  budget_allocation   VARCHAR(255) DEFAULT NULL,
  hero_offer          VARCHAR(255) DEFAULT NULL,
  
  -- Status & Tracking
  status              ENUM('draft','active','completed') NOT NULL DEFAULT 'draft',
  created_by          INT UNSIGNED NOT NULL,
  deleted             TINYINT(1) NOT NULL DEFAULT 0,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_ccp_client  FOREIGN KEY (client_id)  REFERENCES leads(id) ON DELETE CASCADE,
  CONSTRAINT fk_ccp_creator FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Content calendar posts (child of plans)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_calendar_posts (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  plan_id             INT UNSIGNED NOT NULL,
  
  -- Link to approved brief (optional)
  linked_brief_id     INT UNSIGNED DEFAULT NULL,
  
  -- Post details
  post_no             VARCHAR(10) DEFAULT NULL,
  platform            VARCHAR(100) DEFAULT NULL,
  format              ENUM('reel','static_post','carousel','blog_article','story','ad_copy','email_newsletter') NOT NULL,
  topic               TEXT NOT NULL,
  ad_target           ENUM('organic','paid') NOT NULL DEFAULT 'organic',
  shoot_date          DATE DEFAULT NULL,
  posting_date        DATE NOT NULL,
  cta                 VARCHAR(255) DEFAULT NULL,
  status              ENUM('planned','in_progress','done','cancelled') NOT NULL DEFAULT 'planned',
  
  -- Tracking
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_ccpost_plan  FOREIGN KEY (plan_id)         REFERENCES content_calendar_plans(id) ON DELETE CASCADE,
  CONSTRAINT fk_ccpost_brief FOREIGN KEY (linked_brief_id) REFERENCES content_write_requests(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Content calendar shoots (child of plans)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_calendar_shoots (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  plan_id             INT UNSIGNED NOT NULL,
  
  -- Link to approved shoot (optional)
  linked_shoot_id     INT UNSIGNED DEFAULT NULL,
  
  -- Shoot details
  shoot_date          DATE NOT NULL,
  location            VARCHAR(255) DEFAULT NULL,
  description         TEXT,
  num_videos          INT UNSIGNED NOT NULL DEFAULT 0,
  num_photos          INT UNSIGNED NOT NULL DEFAULT 0,
  talent              VARCHAR(255) DEFAULT NULL,
  production_notes    TEXT,
  status              ENUM('planned','confirmed','completed','cancelled') NOT NULL DEFAULT 'planned',
  
  -- Tracking
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_ccshoot_plan  FOREIGN KEY (plan_id)         REFERENCES content_calendar_plans(id) ON DELETE CASCADE,
  CONSTRAINT fk_ccshoot_shoot FOREIGN KEY (linked_shoot_id) REFERENCES shoots(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Content calendar ads (child of plans)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_calendar_ads (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  plan_id             INT UNSIGNED NOT NULL,
  
  -- Ad details
  ad_no               VARCHAR(20) DEFAULT NULL,
  creative_name       VARCHAR(255) DEFAULT NULL,
  campaign_objective  ENUM('lead_generation','brand_awareness','traffic','engagement','conversions','app_installs') NOT NULL,
  platform            VARCHAR(100) DEFAULT NULL,
  ad_status           ENUM('planned','running','paused','completed','cancelled') NOT NULL DEFAULT 'planned',
  target_audience     TEXT,
  budget              VARCHAR(100) DEFAULT NULL,
  start_date          DATE NOT NULL,
  end_date            DATE DEFAULT NULL,
  expected_outcomes   TEXT,
  
  -- Tracking
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_ccad_plan FOREIGN KEY (plan_id) REFERENCES content_calendar_plans(id) ON DELETE CASCADE
) ENGINE=InnoDB;
