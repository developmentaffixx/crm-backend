-- Approval History for Content Writing, Shoots, Ads
-- Tracks all approve/reject/rework actions with timestamps

USE crm_task_module;

CREATE TABLE IF NOT EXISTS smm_approval_history (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  module        ENUM('content_write', 'shoots', 'ads') NOT NULL,
  record_id     INT UNSIGNED NOT NULL,
  action        ENUM('approve', 'reject', 'rework', 'submit', 'resubmit') NOT NULL,
  remarks       TEXT DEFAULT NULL,
  acted_by      INT UNSIGNED NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_approval_hist_record (module, record_id, created_at DESC),
  CONSTRAINT fk_approval_hist_user FOREIGN KEY (acted_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
