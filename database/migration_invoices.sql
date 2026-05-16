-- ============================================================
-- Invoices Module - MySQL Schema
-- ============================================================

USE crm_task_module;

-- ------------------------------------------------------------
-- Invoices table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoices (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  invoice_number  VARCHAR(50) NOT NULL UNIQUE,
  lead_id         INT UNSIGNED,
  status          ENUM('New','Partial','Paid','Overdue') NOT NULL DEFAULT 'New',
  bill_date       DATE NOT NULL,
  due_date        DATE NOT NULL,
  from_address    TEXT,
  subtotal        DECIMAL(12,2) NOT NULL DEFAULT 0,
  discount        DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_amount    DECIMAL(12,2) NOT NULL DEFAULT 0,
  paid_amount     DECIMAL(12,2) NOT NULL DEFAULT 0,
  balance_amount  DECIMAL(12,2) NOT NULL DEFAULT 0,
  bank_name       VARCHAR(255) DEFAULT NULL,
  account_number  VARCHAR(100) DEFAULT NULL,
  ifsc_code       VARCHAR(50) DEFAULT NULL,
  branch          VARCHAR(255) DEFAULT NULL,
  note            TEXT,
  qr_code_url     VARCHAR(500) DEFAULT NULL,
  created_by      INT UNSIGNED,
  deleted         TINYINT(1) NOT NULL DEFAULT 0,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_invoices_lead FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL,
  CONSTRAINT fk_invoices_created FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Invoice items table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoice_items (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  invoice_id      INT UNSIGNED NOT NULL,
  service_id      INT UNSIGNED DEFAULT NULL,
  description     VARCHAR(500) DEFAULT NULL,
  hsn_code        VARCHAR(50) DEFAULT NULL,
  quantity        DECIMAL(10,2) NOT NULL DEFAULT 1,
  rate            DECIMAL(12,2) NOT NULL DEFAULT 0,
  amount          DECIMAL(12,2) NOT NULL DEFAULT 0,
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_invoice_items_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
  CONSTRAINT fk_invoice_items_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Invoice payments table (payment history)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoice_payments (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  invoice_id      INT UNSIGNED NOT NULL,
  payment_date    DATE NOT NULL,
  payment_method  ENUM('Cash','Bank','UPI') NOT NULL DEFAULT 'Cash',
  amount          DECIMAL(12,2) NOT NULL DEFAULT 0,
  reference_id    VARCHAR(100) DEFAULT NULL,
  created_by      INT UNSIGNED,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_payments_invoice FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
  CONSTRAINT fk_payments_created FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Add bank details columns to company_settings if not exist
-- ------------------------------------------------------------
ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS bank_name VARCHAR(255) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS account_number VARCHAR(100) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ifsc_code VARCHAR(50) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS bank_branch VARCHAR(255) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS invoice_note TEXT,
  ADD COLUMN IF NOT EXISTS invoice_qr_url VARCHAR(500) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS gstin VARCHAR(50) NOT NULL DEFAULT '';
