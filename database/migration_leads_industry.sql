USE crm_task_module;

-- Add industry column to leads table
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS industry VARCHAR(100) DEFAULT NULL AFTER business_name;
