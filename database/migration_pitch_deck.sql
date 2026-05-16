-- ============================================================
-- Pitch Deck Module - MySQL Schema
-- ============================================================

USE crm_task_module;

-- ------------------------------------------------------------
-- Pitch Decks table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pitch_decks (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  lead_id         INT UNSIGNED NOT NULL,
  title           VARCHAR(255) NOT NULL,
  status          ENUM('draft','final') NOT NULL DEFAULT 'draft',

  -- Step 1: Company Overview
  company_name    VARCHAR(255),
  company_tagline VARCHAR(500),
  company_description TEXT,
  company_logo_url VARCHAR(500),

  -- Step 7: Thanks slide
  thanks_message  TEXT,
  contact_name    VARCHAR(255),
  contact_email   VARCHAR(255),
  contact_phone   VARCHAR(100),
  contact_website VARCHAR(255),

  created_by      INT UNSIGNED NOT NULL,
  deleted         TINYINT(1) NOT NULL DEFAULT 0,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_pitchdeck_lead    FOREIGN KEY (lead_id) REFERENCES leads(id),
  CONSTRAINT fk_pitchdeck_created FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Step 2: Problem / Client Research & Ideas
-- type: 'pain_point', 'gap', 'opportunity'
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pitch_deck_problems (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  pitch_deck_id INT UNSIGNED NOT NULL,
  type          ENUM('pain_point','gap','opportunity') NOT NULL,
  content       VARCHAR(500) NOT NULL,
  sort_order    INT NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pdprob_deck FOREIGN KEY (pitch_deck_id) REFERENCES pitch_decks(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Step 3: Selected Services (logos)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pitch_deck_services (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  pitch_deck_id INT UNSIGNED NOT NULL,
  service_id    INT UNSIGNED NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pdsvc_deck    FOREIGN KEY (pitch_deck_id) REFERENCES pitch_decks(id) ON DELETE CASCADE,
  CONSTRAINT fk_pdsvc_service FOREIGN KEY (service_id) REFERENCES services(id),
  UNIQUE KEY uq_deck_service (pitch_deck_id, service_id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Step 4: 90-Day Goals
-- month: 1, 2, or 3
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pitch_deck_goals (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  pitch_deck_id INT UNSIGNED NOT NULL,
  month         TINYINT UNSIGNED NOT NULL,
  goal          VARCHAR(500) NOT NULL,
  sort_order    INT NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pdgoal_deck FOREIGN KEY (pitch_deck_id) REFERENCES pitch_decks(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Step 5 & 6: Selected Plans
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pitch_deck_plans (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  pitch_deck_id INT UNSIGNED NOT NULL,
  plan_id       INT UNSIGNED NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pdplan_deck FOREIGN KEY (pitch_deck_id) REFERENCES pitch_decks(id) ON DELETE CASCADE,
  CONSTRAINT fk_pdplan_plan FOREIGN KEY (plan_id) REFERENCES plans(id),
  UNIQUE KEY uq_deck_plan (pitch_deck_id, plan_id)
) ENGINE=InnoDB;
