USE crm_task_module;

-- ============================================================
-- Software Licenses Module - Database Migration
-- ============================================================

CREATE TABLE IF NOT EXISTS software_licenses (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  software_name       VARCHAR(255) NOT NULL,
  vendor              VARCHAR(255) DEFAULT NULL,
  license_type        ENUM('Subscription','Perpetual','Free','Trial') NOT NULL DEFAULT 'Subscription',
  license_key         VARCHAR(500) DEFAULT NULL,
  cost                DECIMAL(12,2) NOT NULL DEFAULT 0,
  billing_cycle       ENUM('Monthly','Quarterly','Half-Yearly','Annual','One-Time') DEFAULT 'Monthly',
  total_seats         INT UNSIGNED DEFAULT NULL,
  start_date          DATE NOT NULL,
  expiry_date         DATE DEFAULT NULL,
  assigned_to         VARCHAR(500) DEFAULT NULL,
  status              ENUM('Active','Expired','Cancelled','Trial') NOT NULL DEFAULT 'Active',
  notes               TEXT DEFAULT NULL,
  created_by          INT UNSIGNED NOT NULL,
  deleted             TINYINT(1) NOT NULL DEFAULT 0,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_sl_created FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;
