USE u627061298_database_crm;

-- ============================================================
-- Interview Scheduler V2 Migration
-- Changes:
--   1. Update status enum on interview_candidates
--   2. Update verdict enum on interview_rounds (add 'pass')
--   3. New table: interview_question_bank
-- ============================================================

-- 1. Update candidate status enum to new flow
ALTER TABLE interview_candidates
  MODIFY COLUMN status ENUM('new','in_process','selected','rejected','on_hold') NOT NULL DEFAULT 'new';

-- 2. Update round verdict enum — add 'pass' (means passed this round, go to next)
ALTER TABLE interview_rounds
  MODIFY COLUMN verdict ENUM('pass','selected','rejected','on_hold') DEFAULT NULL;

-- 3. Drop shortlisted_by / shortlisted_at (no longer used)
ALTER TABLE interview_candidates
  DROP FOREIGN KEY IF EXISTS fk_ic_shortlisted_by;

ALTER TABLE interview_candidates
  DROP COLUMN IF EXISTS shortlisted_by,
  DROP COLUMN IF EXISTS shortlisted_at;

-- 4. Interview Question Bank (Admin manages questions per position)
CREATE TABLE IF NOT EXISTS interview_question_bank (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  position_name  VARCHAR(120) NOT NULL,
  question       TEXT NOT NULL,
  order_no       TINYINT UNSIGNED NOT NULL DEFAULT 1,
  created_by     INT UNSIGNED DEFAULT NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_iqb_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_iqb_position (position_name)
) ENGINE=InnoDB;
