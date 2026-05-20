USE crm_task_module;

-- ============================================================
-- Vendor Agreements v2 - Add agreement_id column (VAG-YY-###)
-- ============================================================

-- Add agreement_id column
ALTER TABLE vendor_agreements ADD COLUMN IF NOT EXISTS agreement_id VARCHAR(20) DEFAULT NULL AFTER id;

-- Add unique index on agreement_id
ALTER TABLE vendor_agreements ADD UNIQUE INDEX uk_agreement_id (agreement_id);
