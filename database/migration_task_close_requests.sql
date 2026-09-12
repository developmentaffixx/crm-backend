-- ============================================================
-- Migration: task_close_requests
-- Purpose  : Allows a user to request that an overdue task be
--            marked as closed/completed, which unblocks clock-out
--            in the same way a deadline extension request does.
-- ============================================================

CREATE TABLE IF NOT EXISTS task_close_requests (
  id            INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  task_id       INT UNSIGNED     NOT NULL,
  requested_by  INT UNSIGNED     NOT NULL,
  reason        TEXT             NOT NULL,
  status        ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  reviewed_by   INT UNSIGNED     NULL,
  reviewed_at   DATETIME         NULL,
  reject_reason TEXT             NULL,
  deleted       TINYINT(1)       NOT NULL DEFAULT 0,
  created_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),

  -- Fast lookup used by clock-out check
  INDEX idx_tcr_task_status (task_id, status, deleted),

  CONSTRAINT fk_tcr_task      FOREIGN KEY (task_id)      REFERENCES tasks (id),
  CONSTRAINT fk_tcr_req_by    FOREIGN KEY (requested_by) REFERENCES users (id),
  CONSTRAINT fk_tcr_reviewed  FOREIGN KEY (reviewed_by)  REFERENCES users (id)
);
