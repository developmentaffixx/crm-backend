USE crm_task_module;

-- ─── Calendar Events table ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS calendar_events (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title         VARCHAR(255) NOT NULL,
  description   TEXT DEFAULT NULL,
  start_time    DATETIME NOT NULL,
  end_time      DATETIME NOT NULL,
  all_day       TINYINT(1) NOT NULL DEFAULT 0,
  color         VARCHAR(20) NOT NULL DEFAULT 'blue',
  category      ENUM('meeting','task','project','personal','other') NOT NULL DEFAULT 'other',
  user_id       INT UNSIGNED NOT NULL,
  deleted       TINYINT(1) NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_events_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;
