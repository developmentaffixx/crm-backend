-- ─────────────────────────────────────────────────────────────────────────────
-- Drop the old proposals table (replaced by new Proposal Engine)
-- Run this migration to clean up the old proposal system
-- NOTE: This is irreversible. Backup data if needed before running.
-- ─────────────────────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS proposals;
