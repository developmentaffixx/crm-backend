-- ============================================================
-- Ads Planning Module - MySQL Schema
-- ============================================================

USE crm_task_module;

-- Ad Campaigns
CREATE TABLE IF NOT EXISTS ad_campaigns (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id        INT UNSIGNED NOT NULL,
  campaign_name     VARCHAR(255) NOT NULL,
  platform          VARCHAR(100) DEFAULT NULL,
  objective         VARCHAR(255) DEFAULT NULL,
  budget            DECIMAL(10,2) DEFAULT NULL,
  start_date        DATE DEFAULT NULL,
  end_date          DATE DEFAULT NULL,
  assignment_type   ENUM('auto','self') DEFAULT 'self',
  assigned_to       INT UNSIGNED DEFAULT NULL,
  status            ENUM('draft','pending_approval','approved','active','paused','completed','rejected') DEFAULT 'draft',
  notes             TEXT DEFAULT NULL,
  created_by        INT UNSIGNED NOT NULL,
  deleted           TINYINT(1) NOT NULL DEFAULT 0,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_ac_project  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_ac_assigned FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_ac_created  FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- Post-Ad Reports (one per campaign)
CREATE TABLE IF NOT EXISTS ad_campaign_reports (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  campaign_id       INT UNSIGNED NOT NULL,
  reach             INT DEFAULT 0,
  impressions       INT DEFAULT 0,
  clicks            INT DEFAULT 0,
  ctr               DECIMAL(5,2) DEFAULT NULL,
  cpc               DECIMAL(10,2) DEFAULT NULL,
  cpl               DECIMAL(10,2) DEFAULT NULL,
  leads             INT DEFAULT 0,
  conversions       INT DEFAULT 0,
  amount_spent      DECIMAL(10,2) DEFAULT NULL,
  best_performing_ad TEXT DEFAULT NULL,
  recommendations   TEXT DEFAULT NULL,
  created_by        INT UNSIGNED NOT NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_acr_campaign FOREIGN KEY (campaign_id) REFERENCES ad_campaigns(id) ON DELETE CASCADE,
  CONSTRAINT fk_acr_created  FOREIGN KEY (created_by) REFERENCES users(id),
  UNIQUE KEY uq_campaign_report (campaign_id)
) ENGINE=InnoDB;
