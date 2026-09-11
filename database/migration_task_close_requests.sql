-- ============================================================
-- Migration: task_close_requests
-- Purpose  : Allows a user to request that an overdue task be
--            marked as closed/completed, which unblocks clock-out
--            in the same way a deadline extension request does.
-- ============================================================

CREATE TABLE IF NOT EXISTS task_close_requests (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  task_id       INT UNSIGNED NOT NULL,
  requested_by  INT UNSIGNED NOT NULL,        -- user submitting the request
  reason        TEXT         NOT NULL,        -- why they want it closed
  status        ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  reviewed_by   INT UNSIGNED     NULL,        -- admin/manager who acted on it
  reviewed_at   DATETIME         NULL,
  reject_reason TEXT             NULL,
  deleted       TINYINT(1)   NOT NULL DEFAULT 0,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_tcr_task      FOREIGN KEY (task_id)      REFERENCES tasks  (id),
  CONSTRAINT fk_tcr_req_by    FOREIGN KEY (requested_by) REFERENCES users  (id),
  CONSTRAINT fk_tcr_reviewed  FOREIGN KEY (reviewed_by)  REFERENCES users  (id)
);

-- Prevent duplicate pending close requests for the same task
CREATE UNIQUE INDEX IF NOT EXISTS uq_tcr_task_pending
  ON task_close_requests (task_id, status, deleted)
  -- NOTE: MySQL does not support partial indexes; enforce in application layer.
  -- This index is intentionally left as a regular composite index for reference.
;

-- Drop the pseudo-unique index above (MySQL syntax workaround)
-- Uniqueness for pending requests is enforced at the application level.
DROP INDEX IF EXISTS uq_tcr_task_pending ON task_close_requests;

-- Simple composite index for fast lookups used in clock-out check
CREATE INDEX IF NOT EXISTS idx_tcr_task_status
  ON task_close_requests (task_id, status, deleted);
