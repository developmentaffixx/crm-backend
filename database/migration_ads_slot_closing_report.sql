-- ============================================================
-- Migration: Add amount_spent and report_notes to content_calendar_ads
-- ============================================================

USE crm_task_module;

ALTER TABLE content_calendar_ads
  ADD COLUMN IF NOT EXISTS amount_spent DECIMAL(10,2) DEFAULT NULL AFTER budget,
  ADD COLUMN IF NOT EXISTS report_notes TEXT DEFAULT NULL AFTER expected_outcomes;
