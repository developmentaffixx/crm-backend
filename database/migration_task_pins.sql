-- ============================================================
-- Task Pins Migration
-- Feature: Per-user task pinning (max 3 pins per user)
-- ============================================================

USE crm_task_module;

-- ------------------------------------------------------------
-- Task Pins Table
-- Each user can pin up to 3 tasks for quick access
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_pins (
  id        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id   INT UNSIGNED NOT NULL,
  task_id   INT UNSIGNED NOT NULL,
  pinned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_task_pin (user_id, task_id),
  CONSTRAINT fk_task_pins_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_task_pins_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  INDEX idx_task_pins_user (user_id)
) ENGINE=InnoDB;
