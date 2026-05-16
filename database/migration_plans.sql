-- ============================================================
-- Plans & Services Module - MySQL Schema
-- ============================================================

USE crm_task_module;

-- ------------------------------------------------------------
-- Services table (e.g., Web Development, SEO, Digital Marketing)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS services (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  icon        VARCHAR(50) DEFAULT '🌐',
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  deleted     TINYINT(1) NOT NULL DEFAULT 0,
  created_by  INT UNSIGNED,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_services_created FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Plans table (e.g., Basic, Standard, Premium per service)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plans (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  service_id  INT UNSIGNED NOT NULL,
  name        VARCHAR(255) NOT NULL,
  description VARCHAR(500),
  price       DECIMAL(12,2) NOT NULL DEFAULT 0,
  duration    ENUM('monthly','quarterly','half_yearly','yearly','one_time') NOT NULL DEFAULT 'monthly',
  is_popular  TINYINT(1) NOT NULL DEFAULT 0,
  sort_order  INT NOT NULL DEFAULT 0,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  deleted     TINYINT(1) NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_plans_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Plan features table (features/deliverables for each plan)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plan_features (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  plan_id     INT UNSIGNED NOT NULL,
  feature     VARCHAR(255) NOT NULL,
  value       VARCHAR(255) DEFAULT NULL,
  is_included TINYINT(1) NOT NULL DEFAULT 1,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_features_plan FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Service features (master list of features per service for comparison table)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_features (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  service_id  INT UNSIGNED NOT NULL,
  name        VARCHAR(255) NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_svc_features_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Feature values per plan (for comparison table: ✓, —, or text value)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plan_feature_values (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  plan_id            INT UNSIGNED NOT NULL,
  service_feature_id INT UNSIGNED NOT NULL,
  value              VARCHAR(255) NOT NULL DEFAULT '✓',
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pfv_plan    FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE,
  CONSTRAINT fk_pfv_feature FOREIGN KEY (service_feature_id) REFERENCES service_features(id) ON DELETE CASCADE,
  UNIQUE KEY uq_plan_feature (plan_id, service_feature_id)
) ENGINE=InnoDB;
