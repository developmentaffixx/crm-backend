USE crm_task_module;

-- ============================================================
-- Shoot Timers Migration
-- Lets collaborators "punch" (clock in/out) on a shoot, mirroring the
-- task_active_timers / task_time_logs pattern so punched shoot time can be
-- summed into each user's productive time exactly like task/ticket/meeting time.
-- ============================================================

-- Per-user active (running) punch — one live punch per user per shoot.
CREATE TABLE IF NOT EXISTS shoot_active_timers (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  shoot_id   INT UNSIGNED NOT NULL,
  user_id    INT UNSIGNED NOT NULL,
  started_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_shoot_user_timer (shoot_id, user_id),
  CONSTRAINT fk_sat_shoot FOREIGN KEY (shoot_id) REFERENCES shoots(id) ON DELETE CASCADE,
  CONSTRAINT fk_sat_user  FOREIGN KEY (user_id)  REFERENCES users(id)
) ENGINE=InnoDB;

-- Index for quick lookup of a user's active shoot timers across all shoots.
CREATE INDEX idx_sat_user ON shoot_active_timers (user_id);

-- Completed punch sessions — one row per punch-in/punch-out pair.
CREATE TABLE IF NOT EXISTS shoot_time_logs (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  shoot_id   INT UNSIGNED NOT NULL,
  user_id    INT UNSIGNED NOT NULL,
  started_at DATETIME NOT NULL,
  ended_at   DATETIME NOT NULL,
  duration   INT UNSIGNED NOT NULL COMMENT 'Duration in seconds',
  note       TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_stl_shoot FOREIGN KEY (shoot_id) REFERENCES shoots(id) ON DELETE CASCADE,
  CONSTRAINT fk_stl_user  FOREIGN KEY (user_id)  REFERENCES users(id)
) ENGINE=InnoDB;

CREATE INDEX idx_stl_user_date ON shoot_time_logs (user_id, started_at);

SELECT 'migration_shoot_timers applied' AS status;
