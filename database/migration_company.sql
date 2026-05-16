USE crm_task_module;

-- ─── Company / Organization settings (single-row config) ─────────────────────
CREATE TABLE IF NOT EXISTS company_settings (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_name    VARCHAR(200) NOT NULL DEFAULT '',
  tagline         VARCHAR(255) NOT NULL DEFAULT '',
  email           VARCHAR(191) NOT NULL DEFAULT '',
  phone           VARCHAR(50)  NOT NULL DEFAULT '',
  website         VARCHAR(255) NOT NULL DEFAULT '',
  address_line1   VARCHAR(255) NOT NULL DEFAULT '',
  address_line2   VARCHAR(255) NOT NULL DEFAULT '',
  city            VARCHAR(100) NOT NULL DEFAULT '',
  state           VARCHAR(100) NOT NULL DEFAULT '',
  zip_code        VARCHAR(20)  NOT NULL DEFAULT '',
  country         VARCHAR(100) NOT NULL DEFAULT '',
  timezone        VARCHAR(50)  NOT NULL DEFAULT 'Asia/Kolkata',
  date_format     VARCHAR(20)  NOT NULL DEFAULT 'DD/MM/YYYY',
  currency        VARCHAR(10)  NOT NULL DEFAULT 'INR',
  currency_symbol VARCHAR(5)   NOT NULL DEFAULT '₹',
  logo_url        VARCHAR(500) NOT NULL DEFAULT '',
  favicon_url     VARCHAR(500) NOT NULL DEFAULT '',
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Seed default row
INSERT IGNORE INTO company_settings (id, company_name) VALUES (1, 'My Company');
