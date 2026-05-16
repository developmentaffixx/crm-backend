USE crm_task_module;

-- ============================================================
-- Leads Module - Database Migration
-- ============================================================

-- ------------------------------------------------------------
-- Leads table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leads (
  id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name                  VARCHAR(150) NOT NULL,
  business_name         VARCHAR(200),
  service_required      VARCHAR(100),
  budget_min            DECIMAL(12,2) DEFAULT NULL,
  budget_max            DECIMAL(12,2) DEFAULT NULL,
  no_budget_idea        TINYINT(1) NOT NULL DEFAULT 0,
  purpose_of_services   TEXT,
  phone                 VARCHAR(30),
  email                 VARCHAR(191),
  address               TEXT,
  country               VARCHAR(100),
  state                 VARCHAR(100),
  city                  VARCHAR(100),
  zip_code              VARCHAR(20),
  temperature           ENUM('hot','warm','cold') NOT NULL DEFAULT 'cold',
  source                VARCHAR(100),
  status                VARCHAR(50) NOT NULL DEFAULT 'New',
  current_marketing_status TEXT,
  assigned_to           INT UNSIGNED DEFAULT NULL,
  created_by            INT UNSIGNED NOT NULL,
  deleted               TINYINT(1) NOT NULL DEFAULT 0,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_leads_assigned FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_leads_created  FOREIGN KEY (created_by)  REFERENCES users(id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Lead social links (multiple per lead)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_social_links (
  id        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  lead_id   INT UNSIGNED NOT NULL,
  platform  VARCHAR(50) NOT NULL,
  url       VARCHAR(500) NOT NULL,
  CONSTRAINT fk_lsl_lead FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Lead follow-ups (timeline entries)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_follow_ups (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  lead_id     INT UNSIGNED NOT NULL,
  type        VARCHAR(50) NOT NULL DEFAULT 'Phone Call',
  note        TEXT NOT NULL,
  follow_up_date DATETIME,
  created_by  INT UNSIGNED NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_lfu_lead FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  CONSTRAINT fk_lfu_user FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;
