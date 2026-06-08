-- ─────────────────────────────────────────────────────────────────────────────
-- Proposal Plans — pre-configured plans for the Proposal module
-- ─────────────────────────────────────────────────────────────────────────────

-- Services for proposals (separate from main services)
CREATE TABLE IF NOT EXISTS proposal_services (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  icon        VARCHAR(10)  DEFAULT '🌐',
  created_by  INT          NOT NULL,
  created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
  deleted     TINYINT(1)   DEFAULT 0
);

-- Plan columns per service (e.g. Basic, Growth, Premium)
CREATE TABLE IF NOT EXISTS proposal_service_plans (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  service_id      INT          NOT NULL,
  name            VARCHAR(255) NOT NULL,
  subtitle        VARCHAR(255) DEFAULT NULL,
  price           VARCHAR(100) DEFAULT NULL,
  is_recommended  TINYINT(1)   DEFAULT 0,
  sort_order      INT          DEFAULT 0,
  FOREIGN KEY (service_id) REFERENCES proposal_services(id) ON DELETE CASCADE
);

-- Feature rows per service
CREATE TABLE IF NOT EXISTS proposal_service_features (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  service_id  INT          NOT NULL,
  name        VARCHAR(255) NOT NULL,
  sort_order  INT          DEFAULT 0,
  FOREIGN KEY (service_id) REFERENCES proposal_services(id) ON DELETE CASCADE
);

-- Values: feature × plan matrix
CREATE TABLE IF NOT EXISTS proposal_plan_values (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  feature_id  INT          NOT NULL,
  plan_id     INT          NOT NULL,
  value       VARCHAR(500) DEFAULT '—',
  UNIQUE KEY unique_feature_plan (feature_id, plan_id),
  FOREIGN KEY (feature_id) REFERENCES proposal_service_features(id) ON DELETE CASCADE,
  FOREIGN KEY (plan_id)    REFERENCES proposal_service_plans(id) ON DELETE CASCADE
);
