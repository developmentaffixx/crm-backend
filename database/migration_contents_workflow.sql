-- ============================================================
-- Migration: Contents (posts) workflow
--   SMM Review (can_content_smm_approve) → PC/PM Approval (can_content_pcpm_approve)
--   → Mark as Done (can_content_complete)
--
-- NOTE: The backend applies all of this automatically on startup
-- (src/helpers/contentWorkflow.js → ensureContentWorkflowSchema), including the
-- one-time toggle copy. Running this file manually is optional (MariaDB syntax).
-- ============================================================

USE crm_task_module;

-- 1. Toggles (Settings → SM Ops → Contents → Content Approvals)
ALTER TABLE role_permissions
  ADD COLUMN IF NOT EXISTS can_content_smm_approve  TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS can_content_pcpm_approve TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS can_content_complete     TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE user_permissions
  ADD COLUMN IF NOT EXISTS can_content_smm_approve  TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS can_content_pcpm_approve TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS can_content_complete     TINYINT(1) NOT NULL DEFAULT 0;

-- 1b. One-time copy from the old module-level toggles (run ONCE — skip if already done)
-- UPDATE role_permissions SET
--   can_content_smm_approve  = IF(COALESCE(can_smm_approve,0) = 1, 1, 0),
--   can_content_pcpm_approve = IF(COALESCE(can_pcpm_approve,0) = 1 OR COALESCE(can_approve,0) = 1, 1, 0),
--   can_content_complete     = IF(COALESCE(can_smm_approve,0) = 1 OR COALESCE(can_pcpm_approve,0) = 1 OR COALESCE(can_complete,0) = 1, 1, 0)
-- WHERE module = 'creative_hub';
-- (same for user_permissions)

-- 2. Statuses: draft (unfilled placeholder) and smm_reviewed
ALTER TABLE content_write_requests MODIFY COLUMN status
  ENUM('draft','pending','smm_reviewed','approved','rejected','in_progress','completed') NOT NULL DEFAULT 'pending';

-- 3. Trail + Project ▸ Service ▸ Cycle link + autosave time
ALTER TABLE content_write_requests
  ADD COLUMN IF NOT EXISTS project_service_id INT UNSIGNED DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS cycle_id           INT UNSIGNED DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS smm_reviewed_by    INT UNSIGNED DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS smm_reviewed_at    DATETIME DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS returned_by        INT UNSIGNED DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS returned_at        DATETIME DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS completed_by       INT UNSIGNED DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS completed_at       DATETIME DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS draft_saved_at     DATETIME DEFAULT NULL;
ALTER TABLE content_write_requests
  ADD INDEX IF NOT EXISTS idx_cwr_slot (calendar_slot_id),
  ADD INDEX IF NOT EXISTS idx_cwr_cycle (cycle_id);

-- 4. History actions
ALTER TABLE smm_approval_history MODIFY COLUMN action
  ENUM('approve','reject','rework','submit','resubmit','complete','report_submit','report_approve','report_reject',
       'close_request','close_approve','close_reject','smm_accept','send_back','remodify') NOT NULL;

-- 5. Data fixes (safe to repeat) — see ensureContentWorkflowSchema for the exact statements:
--    5a unfilled placeholders → draft · 5b content status follows its calendar slot
--    5c project ▸ service ▸ cycle copied from the calendar plan
