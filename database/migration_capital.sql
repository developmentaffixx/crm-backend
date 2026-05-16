USE crm_task_module;

-- ============================================================
-- Capital / Investments Module - Database Migration
-- ============================================================

CREATE TABLE IF NOT EXISTS capital (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title           VARCHAR(255) NOT NULL,
  amount          DECIMAL(12,2) NOT NULL DEFAULT 0,
  capital_date    DATE NOT NULL,
  source          ENUM('Founder','Partner','Loan','Other') NOT NULL DEFAULT 'Founder',
  payment_mode    ENUM('Cash','UPI','Bank','Card','Cheque') NOT NULL DEFAULT 'Bank',
  note            TEXT DEFAULT NULL,
  created_by      INT UNSIGNED NOT NULL,
  deleted         TINYINT(1) NOT NULL DEFAULT 0,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_capital_created FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;
