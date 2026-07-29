-- ============================================================
-- Task Comments Migration
-- Feature: Text and audio comments on tasks + notifications
-- ============================================================

USE crm_task_module;

CREATE TABLE IF NOT EXISTS task_comments (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  task_id         INT UNSIGNED NOT NULL,
  user_id         INT UNSIGNED NOT NULL,
  comment_type    ENUM('text', 'audio') NOT NULL DEFAULT 'text',
  content         TEXT NULL COMMENT 'Text content for text comments',
  audio_url       VARCHAR(500) NULL COMMENT 'Cloudinary URL for audio comments',
  audio_public_id VARCHAR(255) NULL COMMENT 'Cloudinary public_id for deletion',
  duration        INT UNSIGNED NULL COMMENT 'Audio duration in seconds',
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_task_comments_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_task_comments_user FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_tc_task (task_id),
  INDEX idx_tc_created (created_at)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Task Comment Notifications Table
-- Tracks unread comment notifications per user
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_comment_notifications (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       INT UNSIGNED NOT NULL,
  task_id       INT UNSIGNED NOT NULL,
  triggered_by  INT UNSIGNED NOT NULL,
  comment_type  ENUM('text', 'audio') NOT NULL DEFAULT 'text',
  message       VARCHAR(255) NOT NULL,
  is_read       TINYINT(1) NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tcn_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_tcn_task FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  CONSTRAINT fk_tcn_triggered FOREIGN KEY (triggered_by) REFERENCES users(id),
  INDEX idx_tcn_user_read (user_id, is_read),
  INDEX idx_tcn_created (created_at)
) ENGINE=InnoDB;
