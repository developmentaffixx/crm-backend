USE crm_task_module;

-- ============================================================
-- Client Resource Hub - Database Migration
-- Onboarding A, Onboarding B, Files, Notes
-- ============================================================

-- ------------------------------------------------------------
-- Client Onboarding A (basic client info captured at conversion)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_onboarding_a (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id           INT UNSIGNED NOT NULL UNIQUE,
  company_name        VARCHAR(255) DEFAULT NULL,
  client_name         VARCHAR(255) DEFAULT NULL,
  designation         VARCHAR(150) DEFAULT NULL,
  email               VARCHAR(191) DEFAULT NULL,
  phone               VARCHAR(30) DEFAULT NULL,
  full_address        TEXT DEFAULT NULL,
  gst_number          VARCHAR(50) DEFAULT NULL,
  start_date          DATE DEFAULT NULL,
  industry            VARCHAR(150) DEFAULT NULL,
  completed           TINYINT(1) NOT NULL DEFAULT 0,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_onb_a_client FOREIGN KEY (client_id) REFERENCES leads(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Client Onboarding B (detailed business info - unlocked after A)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_onboarding_b (
  id                          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id                   INT UNSIGNED NOT NULL UNIQUE,

  -- Business Information
  client_code                 VARCHAR(20) DEFAULT NULL,
  business_name               VARCHAR(255) DEFAULT NULL,
  business_tagline            VARCHAR(255) DEFAULT NULL,
  business_hours              VARCHAR(255) DEFAULT NULL,
  business_category           VARCHAR(150) DEFAULT NULL,
  mode_of_business            ENUM('online','offline','both') DEFAULT 'online',
  business_address            TEXT DEFAULT NULL,
  business_phone              VARCHAR(30) DEFAULT NULL,
  business_whatsapp           VARCHAR(30) DEFAULT NULL,
  about_business              TEXT DEFAULT NULL,
  years_in_business           VARCHAR(50) DEFAULT NULL,

  -- Business Performance & Plans
  current_business_performance TEXT DEFAULT NULL,
  key_offers_usps             TEXT DEFAULT NULL,
  advertising_regulations     ENUM('yes','no') DEFAULT 'no',
  advertising_regulations_explain TEXT DEFAULT NULL,

  -- Products & Services (stored as JSON array)
  products_services           JSON DEFAULT NULL,

  -- Digital Presence
  social_media_credentials    ENUM('existing','need_to_create') DEFAULT 'existing',
  digital_promotion_goals     TEXT DEFAULT NULL,
  previous_digital_marketing  ENUM('yes','no') DEFAULT 'no',
  previous_digital_marketing_report TEXT DEFAULT NULL,

  -- Branding & Assets
  brand_guidelines            TEXT DEFAULT NULL,
  logo_file_path              VARCHAR(500) DEFAULT NULL,
  photos_videos_paths         JSON DEFAULT NULL,
  flyers_paths                JSON DEFAULT NULL,
  brochures_paths             JSON DEFAULT NULL,

  -- Communication & Approvals
  preferred_contact_mode      ENUM('call','whatsapp','both') DEFAULT 'call',
  approval_contact_name       VARCHAR(200) DEFAULT NULL,
  approval_contact_designation VARCHAR(150) DEFAULT NULL,
  approval_contact_number     VARCHAR(30) DEFAULT NULL,
  approval_contact_time       VARCHAR(200) DEFAULT NULL,
  lead_followup_responsibility ENUM('client','agency') DEFAULT 'client',

  completed                   TINYINT(1) NOT NULL DEFAULT 0,
  created_at                  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_onb_b_client FOREIGN KEY (client_id) REFERENCES leads(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Client Folders (hierarchical)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_folders (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id     INT UNSIGNED NOT NULL,
  parent_id     INT UNSIGNED DEFAULT NULL,
  name          VARCHAR(255) NOT NULL,
  created_by    INT UNSIGNED NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_cfolder_client FOREIGN KEY (client_id) REFERENCES leads(id) ON DELETE CASCADE,
  CONSTRAINT fk_cfolder_parent FOREIGN KEY (parent_id) REFERENCES client_folders(id) ON DELETE CASCADE,
  CONSTRAINT fk_cfolder_user   FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Client Files (uploaded documents/assets)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_files (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id     INT UNSIGNED NOT NULL,
  folder_id     INT UNSIGNED DEFAULT NULL,
  file_name     VARCHAR(255) NOT NULL,
  file_path     VARCHAR(500) NOT NULL,
  file_type     VARCHAR(50) DEFAULT NULL,
  file_size     INT UNSIGNED DEFAULT NULL,
  category      VARCHAR(100) DEFAULT NULL,
  uploaded_by   INT UNSIGNED NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cf_client FOREIGN KEY (client_id) REFERENCES leads(id) ON DELETE CASCADE,
  CONSTRAINT fk_cf_folder FOREIGN KEY (folder_id) REFERENCES client_folders(id) ON DELETE SET NULL,
  CONSTRAINT fk_cf_user   FOREIGN KEY (uploaded_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Client Notes
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_notes (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id     INT UNSIGNED NOT NULL,
  title         VARCHAR(255) DEFAULT NULL,
  content       TEXT NOT NULL,
  created_by    INT UNSIGNED NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_cn_client FOREIGN KEY (client_id) REFERENCES leads(id) ON DELETE CASCADE,
  CONSTRAINT fk_cn_user   FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;
