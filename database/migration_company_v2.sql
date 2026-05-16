USE crm_task_module;

-- ─── Add new columns to company_settings ──────────────────────────────────────
-- Run this AFTER migration_company.sql if the table already exists.

-- Tax / Registration
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS gst_number       VARCHAR(50)  NOT NULL DEFAULT '' AFTER country;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS tax_id           VARCHAR(50)  NOT NULL DEFAULT '' AFTER gst_number;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS registration_no  VARCHAR(100) NOT NULL DEFAULT '' AFTER tax_id;

-- Financial year
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS financial_year_start TINYINT NOT NULL DEFAULT 4 AFTER currency_symbol;

-- Social media
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS social_linkedin  VARCHAR(255) NOT NULL DEFAULT '' AFTER favicon_url;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS social_instagram VARCHAR(255) NOT NULL DEFAULT '' AFTER social_linkedin;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS social_twitter   VARCHAR(255) NOT NULL DEFAULT '' AFTER social_instagram;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS social_facebook  VARCHAR(255) NOT NULL DEFAULT '' AFTER social_twitter;

-- Bank details
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS bank_name        VARCHAR(200) NOT NULL DEFAULT '' AFTER social_facebook;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS bank_branch      VARCHAR(200) NOT NULL DEFAULT '' AFTER bank_name;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS bank_account_no  VARCHAR(50)  NOT NULL DEFAULT '' AFTER bank_branch;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS bank_ifsc        VARCHAR(20)  NOT NULL DEFAULT '' AFTER bank_account_no;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS bank_swift       VARCHAR(20)  NOT NULL DEFAULT '' AFTER bank_ifsc;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS bank_account_type VARCHAR(30) NOT NULL DEFAULT 'Current' AFTER bank_swift;

-- UPI
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS upi_id           VARCHAR(100) NOT NULL DEFAULT '' AFTER bank_account_type;
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS upi_qr_url       VARCHAR(500) NOT NULL DEFAULT '' AFTER upi_id;
