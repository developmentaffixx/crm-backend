USE crm_task_module;

-- ============================================================
-- Advanced Profile Features - Database Migration
-- ============================================================

-- ------------------------------------------------------------
-- User Sessions table (for session management)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_sessions (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       INT UNSIGNED NOT NULL,
  token_hash    VARCHAR(64) NOT NULL,
  device        VARCHAR(200) DEFAULT NULL,
  browser       VARCHAR(200) DEFAULT NULL,
  ip_address    VARCHAR(45) DEFAULT NULL,
  last_active   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_current    TINYINT(1) NOT NULL DEFAULT 0,
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Emergency Contacts table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS emergency_contacts (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       INT UNSIGNED NOT NULL,
  name          VARCHAR(200) NOT NULL,
  relationship  VARCHAR(100) NOT NULL,
  phone         VARCHAR(50) NOT NULL,
  email         VARCHAR(191) DEFAULT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ec_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- User Skills table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_skills (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       INT UNSIGNED NOT NULL,
  skill         VARCHAR(100) NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_skill (user_id, skill),
  CONSTRAINT fk_skills_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- User Activity Log (profile-level audit trail)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_activity_log (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       INT UNSIGNED NOT NULL,
  action        VARCHAR(100) NOT NULL,
  description   VARCHAR(500) DEFAULT NULL,
  metadata      JSON DEFAULT NULL,
  ip_address    VARCHAR(45) DEFAULT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ual_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;


-- ------------------------------------------------------------
-- Add responsibilities text field to roles table
-- ------------------------------------------------------------
ALTER TABLE roles ADD COLUMN IF NOT EXISTS responsibilities TEXT DEFAULT NULL AFTER description;


-- ------------------------------------------------------------
-- Track password change timestamp
-- ------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at DATETIME DEFAULT NULL AFTER password_hash;
