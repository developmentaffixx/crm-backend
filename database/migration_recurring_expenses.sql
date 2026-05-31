USE crm_task_module;

-- ============================================================
-- Recurring Expenses Module - Database Migration
-- ============================================================

CREATE TABLE IF NOT EXISTS recurring_expenses (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title             VARCHAR(255) NOT NULL,
  amount            DECIMAL(12,2) NOT NULL DEFAULT 0,
  category          VARCHAR(100) NOT NULL DEFAULT 'Miscellaneous expense',
  other_category    VARCHAR(255) DEFAULT NULL,
  vendor_name       VARCHAR(255) NOT NULL,
  payment_mode      ENUM('Cash','UPI','Bank','Card','Cheque') NOT NULL DEFAULT 'Cash',
  expense_type      ENUM('client','team_member','company') NOT NULL DEFAULT 'company',
  client_id         INT UNSIGNED DEFAULT NULL,
  project_id        INT UNSIGNED DEFAULT NULL,
  frequency         ENUM('daily','weekly','monthly','quarterly','yearly') NOT NULL DEFAULT 'monthly',
  repeat_day        TINYINT UNSIGNED DEFAULT NULL COMMENT 'Day of week (0=Sun..6=Sat) for weekly, day of month (1-31) for monthly/quarterly/yearly',
  start_date        DATE NOT NULL,
  end_date          DATE DEFAULT NULL COMMENT 'NULL means no end (runs forever)',
  next_run_date     DATE NOT NULL,
  status            ENUM('active','paused','completed') NOT NULL DEFAULT 'active',
  created_by        INT UNSIGNED NOT NULL,
  deleted           TINYINT(1) NOT NULL DEFAULT 0,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_recurring_exp_client  FOREIGN KEY (client_id) REFERENCES leads(id) ON DELETE SET NULL,
  CONSTRAINT fk_recurring_exp_created FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- Add recurring_expense_id to expenses table to track auto-generated entries
ALTER TABLE expenses ADD COLUMN recurring_expense_id INT UNSIGNED DEFAULT NULL AFTER bill_copy;
ALTER TABLE expenses ADD COLUMN is_auto_generated TINYINT(1) NOT NULL DEFAULT 0 AFTER recurring_expense_id;
ALTER TABLE expenses ADD CONSTRAINT fk_expenses_recurring FOREIGN KEY (recurring_expense_id) REFERENCES recurring_expenses(id) ON DELETE SET NULL;
