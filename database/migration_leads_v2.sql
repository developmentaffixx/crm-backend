USE crm_task_module;

-- ============================================================
-- Leads Module v2 - Add lead_id and client_code columns
-- ============================================================

-- Add lead_id column (LD-YYMMDD-###)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS lead_id VARCHAR(20) DEFAULT NULL AFTER id;
ALTER TABLE leads ADD UNIQUE INDEX uk_lead_id (lead_id);

-- Add client_code column (AFXCL###) - assigned on convert to client
ALTER TABLE leads ADD COLUMN IF NOT EXISTS client_code VARCHAR(20) DEFAULT NULL AFTER lead_id;
ALTER TABLE leads ADD UNIQUE INDEX uk_client_code (client_code);
