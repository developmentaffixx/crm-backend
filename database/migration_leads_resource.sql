USE crm_task_module;

-- ============================================================
-- Leads Module - Add resource column (Inbound/Outbound)
-- ============================================================

ALTER TABLE leads ADD COLUMN IF NOT EXISTS resource VARCHAR(20) DEFAULT NULL AFTER source;
