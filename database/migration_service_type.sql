-- ============================================================
-- Service Type Migration
-- Adds service_type column to services table
-- Distinguishes between recurring (monthly cycles) and one-time services
-- SAFE: Only adds a new column with default value
-- ============================================================

USE crm_task_module;

-- Add service_type column (default 'recurring' for backward compat)
ALTER TABLE services
  ADD COLUMN service_type ENUM('recurring', 'one_time') NOT NULL DEFAULT 'recurring' AFTER icon;

-- Migrate existing "Web Development" service to one_time
UPDATE services SET service_type = 'one_time' WHERE name = 'Web Development' AND deleted = 0;
