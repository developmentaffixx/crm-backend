USE crm_task_module;

-- ============================================================
-- Payroll - Add Freelancer Support
-- ============================================================

ALTER TABLE payroll
  ADD COLUMN IF NOT EXISTS is_freelancer     TINYINT(1) NOT NULL DEFAULT 0 AFTER auto_generated,
  ADD COLUMN IF NOT EXISTS freelancer_name   VARCHAR(255) DEFAULT NULL AFTER is_freelancer,
  ADD COLUMN IF NOT EXISTS freelancer_role   VARCHAR(255) DEFAULT NULL AFTER freelancer_name;
