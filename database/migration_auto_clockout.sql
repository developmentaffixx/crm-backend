-- ============================================================
-- Auto Clock-Out Feature - Database Migration
-- ============================================================

-- Add auto_clock_out flag to attendance table
ALTER TABLE attendance ADD COLUMN auto_clock_out TINYINT(1) NOT NULL DEFAULT 0 AFTER total_afs_seconds;

-- Add corrected_clock_out for when user submits actual time next day
ALTER TABLE attendance ADD COLUMN corrected_clock_out DATETIME DEFAULT NULL AFTER auto_clock_out;

-- Add correction_submitted_at timestamp
ALTER TABLE attendance ADD COLUMN correction_submitted_at DATETIME DEFAULT NULL AFTER corrected_clock_out;
