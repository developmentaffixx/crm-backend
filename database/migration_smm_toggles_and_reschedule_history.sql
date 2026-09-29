-- Migration: Add can_complete column to role_permissions & user_permissions
-- And create content_calendar_reschedule_history table

ALTER TABLE role_permissions
  ADD COLUMN IF NOT EXISTS can_complete TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE user_permissions
  ADD COLUMN IF NOT EXISTS can_complete TINYINT(1) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS content_calendar_reschedule_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  item_type ENUM('post', 'shoot', 'ad') NOT NULL,
  item_id INT NOT NULL,
  old_date VARCHAR(50) DEFAULT NULL,
  new_date VARCHAR(50) DEFAULT NULL,
  reason TEXT NOT NULL,
  rescheduled_by INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_item (item_type, item_id)
);
