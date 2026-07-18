USE crm_task_module;

-- Add transaction_id column to capital table
ALTER TABLE capital
  ADD COLUMN transaction_id VARCHAR(100) DEFAULT NULL AFTER payment_mode;
