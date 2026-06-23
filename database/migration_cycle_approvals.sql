-- ============================================================
-- Cycle Approvals - Client approval tracking per cycle
-- SAFE: Only creates new table
-- ============================================================

USE crm_task_module;

CREATE TABLE IF NOT EXISTS cycle_approvals (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cycle_id    INT UNSIGNED NOT NULL,
  title       VARCHAR(255) NOT NULL,
  status      ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  notes       TEXT,
  approved_at DATETIME DEFAULT NULL,
  created_by  INT UNSIGNED NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_cappr_cycle FOREIGN KEY (cycle_id) REFERENCES service_cycles(id) ON DELETE CASCADE,
  CONSTRAINT fk_cappr_user  FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;
