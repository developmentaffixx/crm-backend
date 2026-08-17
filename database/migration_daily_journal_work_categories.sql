-- Migration: Add work_categories column to smm_daily_journal
-- This replaces activities_completed and key_activities fields
-- with a JSON object containing categories: Content, Shoot, Ads, Design - Editing

ALTER TABLE smm_daily_journal
ADD COLUMN work_categories JSON DEFAULT NULL AFTER submitted_by;

-- Note: Old columns (activities_completed, key_activities, approvals_pending) are kept
-- for backward compatibility with existing data but are no longer used by the form.
