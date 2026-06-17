USE crm_task_module;

-- Add brand_year column to leads table
ALTER TABLE leads ADD COLUMN brand_year YEAR DEFAULT NULL AFTER business_name;
