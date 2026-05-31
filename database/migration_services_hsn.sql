USE crm_task_module;

-- Add hsn_code column to services table for invoice HSN auto-fill
ALTER TABLE services
  ADD COLUMN IF NOT EXISTS hsn_code VARCHAR(50) NOT NULL DEFAULT '' AFTER description;
