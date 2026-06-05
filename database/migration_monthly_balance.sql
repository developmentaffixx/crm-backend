-- ============================================================
-- Monthly Balance System - Database Migration
-- Tracks running deficit/surplus within a month, resets monthly
-- ============================================================

-- Monthly balance log (one record per user per month)
CREATE TABLE IF NOT EXISTS monthly_balance_log (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id         INT UNSIGNED NOT NULL,
  month_year      DATE NOT NULL COMMENT 'First day of the month (e.g., 2026-06-01)',
  required_hours  DECIMAL(6,2) NOT NULL DEFAULT 0 COMMENT 'Total expected hours for the month (up to today)',
  completed_hours DECIMAL(6,2) NOT NULL DEFAULT 0 COMMENT 'Total productive hours completed',
  balance_hours   DECIMAL(6,2) NOT NULL DEFAULT 0 COMMENT 'Positive = surplus, Negative = deficit',
  status          ENUM('on_track','surplus','deficit') NOT NULL DEFAULT 'on_track',
  finalized       TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 = month ended, balance frozen',
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_mbl_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_user_month (user_id, month_year)
) ENGINE=InnoDB;

-- Indexes
CREATE INDEX idx_mbl_month ON monthly_balance_log (month_year);
CREATE INDEX idx_mbl_status ON monthly_balance_log (status);
CREATE INDEX idx_mbl_user_finalized ON monthly_balance_log (user_id, finalized);
