USE crm_task_module;

-- ============================================================
-- Capital / Credits Module - Enhance Source Column
-- Supports: 'Founder', 'Partner', 'Loan', 'Other Credits', etc.
-- ============================================================

ALTER TABLE capital MODIFY COLUMN source VARCHAR(100) NOT NULL DEFAULT 'Founder';
