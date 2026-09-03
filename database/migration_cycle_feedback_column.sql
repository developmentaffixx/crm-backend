-- ─────────────────────────────────────────────────────────────────────────────
-- Add dedicated feedback column to service_cycles
-- Previously, both the pause/complete/skip reason AND the cycle feedback
-- were stored in the same `notes` column, causing one to overwrite the other.
-- Now:
--   notes    = reason entered when pausing / completing / skipping a cycle
--   feedback = free-text feedback written by the team in the Feedback tab
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE service_cycles
  ADD COLUMN feedback TEXT NULL AFTER notes;
