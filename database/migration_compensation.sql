-- ============================================================
-- Compensation System - Database Migration
-- Option C: Hybrid (auto within week, request across weeks)
-- ============================================================

-- Compensation requests (for cross-week deficit clearing)
CREATE TABLE IF NOT EXISTS compensation_requests (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id         INT UNSIGNED NOT NULL,
  deficit_week    DATE NOT NULL COMMENT 'Monday of the deficit week',
  deficit_hours   DECIMAL(5,2) NOT NULL COMMENT 'Total deficit hours for that week',
  planned_date    DATE NOT NULL COMMENT 'Date employee will work extra',
  planned_start   TIME DEFAULT NULL COMMENT 'Planned start time',
  planned_end     TIME DEFAULT NULL COMMENT 'Planned end time',
  planned_hours   DECIMAL(5,2) NOT NULL COMMENT 'Hours planned to compensate',
  actual_hours    DECIMAL(5,2) DEFAULT NULL COMMENT 'Auto-filled from attendance after clock-out',
  status          ENUM('pending','approved','rejected','completed','expired','cancelled') NOT NULL DEFAULT 'pending',
  approved_by     INT UNSIGNED DEFAULT NULL,
  approved_at     DATETIME DEFAULT NULL,
  remarks         TEXT DEFAULT NULL,
  deleted         TINYINT(1) NOT NULL DEFAULT 0,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_comp_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_comp_approver FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Track weekly deficit history (auto-calculated at end of each week)
CREATE TABLE IF NOT EXISTS weekly_deficit_log (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id         INT UNSIGNED NOT NULL,
  week_start      DATE NOT NULL COMMENT 'Monday of the week',
  required_hours  DECIMAL(5,2) NOT NULL,
  completed_hours DECIMAL(5,2) NOT NULL,
  deficit_hours   DECIMAL(5,2) NOT NULL COMMENT 'Positive = deficit, Negative = surplus',
  compensated_hours DECIMAL(5,2) NOT NULL DEFAULT 0 COMMENT 'Hours cleared via compensation',
  remaining_deficit DECIMAL(5,2) NOT NULL DEFAULT 0 COMMENT 'Unresolved deficit',
  status          ENUM('on_track','deficit','compensated','partially_compensated','unresolved') NOT NULL DEFAULT 'on_track',
  auto_compensated TINYINT(1) NOT NULL DEFAULT 0 COMMENT '1 if cleared by same-week extra hours',
  deadline_date   DATE DEFAULT NULL COMMENT 'Must compensate by this date',
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_wdl_user FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE KEY uq_user_week (user_id, week_start)
) ENGINE=InnoDB;

-- Indexes
CREATE INDEX idx_comp_user_status ON compensation_requests (user_id, status);
CREATE INDEX idx_comp_planned_date ON compensation_requests (planned_date);
CREATE INDEX idx_comp_deficit_week ON compensation_requests (deficit_week);
CREATE INDEX idx_wdl_user_week ON weekly_deficit_log (user_id, week_start);
CREATE INDEX idx_wdl_status ON weekly_deficit_log (status);
