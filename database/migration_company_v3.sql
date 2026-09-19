USE crm_task_module;

-- ─── Add bank_account_name to company_settings ──────────────────────────────
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS bank_account_name VARCHAR(255) NOT NULL DEFAULT 'SCALEFORGE PRIVATE LIMITED' AFTER social_facebook;

-- Initialize default account name if blank
UPDATE company_settings 
SET bank_account_name = 'SCALEFORGE PRIVATE LIMITED' 
WHERE id = 1 AND (bank_account_name = '' OR bank_account_name IS NULL);
