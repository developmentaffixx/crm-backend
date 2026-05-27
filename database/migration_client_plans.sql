-- ============================================================
-- Client Plans Module - Database Migration
-- Tracks which clients are subscribed to which plans
-- ============================================================

USE crm_task_module;

-- ------------------------------------------------------------
-- Client Plans junction table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_plans (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id     INT UNSIGNED NOT NULL,
  plan_id       INT UNSIGNED NOT NULL,
  service_id    INT UNSIGNED NOT NULL,
  start_date    DATE NOT NULL,
  end_date      DATE DEFAULT NULL,
  status        ENUM('active','expired','cancelled','upgraded') NOT NULL DEFAULT 'active',
  amount        DECIMAL(12,2) NOT NULL DEFAULT 0,
  notes         TEXT,
  created_by    INT UNSIGNED DEFAULT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_cp_client  FOREIGN KEY (client_id)  REFERENCES leads(id) ON DELETE CASCADE,
  CONSTRAINT fk_cp_plan    FOREIGN KEY (plan_id)    REFERENCES plans(id) ON DELETE CASCADE,
  CONSTRAINT fk_cp_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE,
  CONSTRAINT fk_cp_created FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;
