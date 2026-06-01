USE crm_task_module;

-- ============================================================
-- Expenses Module - v2 Migration
-- Add missing columns: expense_id_code, transaction_id, other_category
-- ============================================================

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS expense_id_code VARCHAR(20)  DEFAULT NULL AFTER id,
  ADD COLUMN IF NOT EXISTS transaction_id  VARCHAR(255) DEFAULT NULL AFTER payment_mode,
  ADD COLUMN IF NOT EXISTS other_category  VARCHAR(255) DEFAULT NULL AFTER category;
