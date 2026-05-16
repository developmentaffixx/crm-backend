USE crm_task_module;

-- ============================================================
-- Attendance Module - Database Migration
-- ============================================================

-- ------------------------------------------------------------
-- Attendance settings (single-row config)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance_settings (
  id                          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  shift_start_time            TIME NOT NULL DEFAULT '09:00:00',
  grace_period_minutes        INT UNSIGNED NOT NULL DEFAULT 10,
  work_hours_per_day          DECIMAL(3,1) NOT NULL DEFAULT 9.0,
  lunch_duration_minutes      INT UNSIGNED NOT NULL DEFAULT 60,
  required_productive_hours   DECIMAL(3,1) NOT NULL DEFAULT 8.0,
  week_start_day              ENUM('monday','sunday') NOT NULL DEFAULT 'monday',
  auto_clock_out_enabled      TINYINT(1) NOT NULL DEFAULT 0,
  updated_at                  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Seed default settings
INSERT IGNORE INTO attendance_settings (id) VALUES (1);

-- ------------------------------------------------------------
-- Attendance table (one record per user per day)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance (
  id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id               INT UNSIGNED NOT NULL,
  date                  DATE NOT NULL,
  clock_in              DATETIME NOT NULL,
  clock_out             DATETIME DEFAULT NULL,
  clock_in_status       ENUM('on_time','grace','late') NOT NULL DEFAULT 'on_time',
  late_reason           TEXT DEFAULT NULL,
  total_served_seconds  INT UNSIGNED NOT NULL DEFAULT 0,
  total_afs_seconds     INT UNSIGNED NOT NULL DEFAULT 0,
  notes                 TEXT DEFAULT NULL,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_date (user_id, date),
  CONSTRAINT fk_attendance_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- AFS (Away From System) logs
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS afs_logs (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id           INT UNSIGNED NOT NULL,
  attendance_id     INT UNSIGNED NOT NULL,
  start_time        DATETIME NOT NULL,
  end_time          DATETIME DEFAULT NULL,
  duration_seconds  INT UNSIGNED NOT NULL DEFAULT 0,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_afs_user       FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_afs_attendance FOREIGN KEY (attendance_id) REFERENCES attendance(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Daily plans (clock-in planning + clock-out review)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_plans (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  attendance_id   INT UNSIGNED NOT NULL,
  user_id         INT UNSIGNED NOT NULL,
  date            DATE NOT NULL,
  point_text      VARCHAR(500) NOT NULL,
  sort_order      INT UNSIGNED NOT NULL DEFAULT 1,
  is_additional   TINYINT(1) NOT NULL DEFAULT 0,
  status          ENUM('to_do','in_progress','completed') NOT NULL DEFAULT 'to_do',
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_dp_attendance FOREIGN KEY (attendance_id) REFERENCES attendance(id) ON DELETE CASCADE,
  CONSTRAINT fk_dp_user       FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
