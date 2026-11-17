-- Leave → Head (coordinator) approval workflow.
-- Also applied automatically on server start by src/config/ensureLeaveCoordinator.js.

ALTER TABLE leaves ADD COLUMN IF NOT EXISTS coordinator_id INT UNSIGNED NULL;
ALTER TABLE leaves ADD COLUMN IF NOT EXISTS head_status ENUM('not_required','pending','approved','rejected') NOT NULL DEFAULT 'not_required';
ALTER TABLE leaves ADD COLUMN IF NOT EXISTS head_actioned_by INT UNSIGNED NULL;
ALTER TABLE leaves ADD COLUMN IF NOT EXISTS head_remarks VARCHAR(500) NULL;
ALTER TABLE leaves ADD COLUMN IF NOT EXISTS head_actioned_at DATETIME NULL;
ALTER TABLE leaves ADD INDEX IF NOT EXISTS idx_leaves_coordinator (coordinator_id);

CREATE TABLE IF NOT EXISTS leave_notifications (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    INT UNSIGNED NOT NULL,
  leave_id   INT UNSIGNED NOT NULL,
  type       VARCHAR(30) NOT NULL,
  title      VARCHAR(255) NOT NULL,
  message    TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_leave_notif_user (user_id, created_at),
  INDEX idx_leave_notif_leave (leave_id)
) ENGINE=InnoDB;
