USE crm_task_module;

-- ============================================================
-- Expenses Module - Database Migration
-- ============================================================

CREATE TABLE IF NOT EXISTS expenses (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title           VARCHAR(255) NOT NULL,
  expense_date    DATE NOT NULL,
  expense_type    ENUM('client','team_member','company') NOT NULL DEFAULT 'company',
  client_id       INT UNSIGNED DEFAULT NULL,
  project_id      INT UNSIGNED DEFAULT NULL,
  category        VARCHAR(100) NOT NULL DEFAULT 'Miscellaneous expense',
  vendor_name     VARCHAR(255) NOT NULL,
  amount          DECIMAL(12,2) NOT NULL DEFAULT 0,
  payment_mode    ENUM('Cash','UPI','Bank','Card','Cheque') NOT NULL DEFAULT 'Cash',
  bill_copy       VARCHAR(500) DEFAULT NULL,
  created_by      INT UNSIGNED NOT NULL,
  deleted         TINYINT(1) NOT NULL DEFAULT 0,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_expenses_client  FOREIGN KEY (client_id) REFERENCES leads(id) ON DELETE SET NULL,
  CONSTRAINT fk_expenses_created FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;
