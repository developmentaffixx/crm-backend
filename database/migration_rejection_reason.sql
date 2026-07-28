USE u627061298_database_crm;

-- ============================================================
-- Add rejection_reason column to interview_candidates
-- Stores point-wise rejection reasons when candidate is rejected
-- ============================================================

ALTER TABLE interview_candidates
  ADD COLUMN rejection_reason TEXT DEFAULT NULL AFTER status;
