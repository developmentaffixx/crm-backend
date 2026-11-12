-- ============================================================
-- Migration: Shoots two-stage approval + workflow fixes
--   Stage 1  Shoot Approval  (can_shoot_approve)
--   Stage 2  Close Approval  (can_shoot_close_approve)
--
-- NOTE: The backend applies all of this automatically on startup
-- (src/helpers/adsWorkflow.js + src/helpers/shootsWorkflow.js).
-- Running this file manually is optional and safe to repeat (MariaDB syntax).
-- ============================================================

USE crm_task_module;

-- 1. Permission toggles (shown under SM Ops → Submenu Access → Shoots)
ALTER TABLE role_permissions
  ADD COLUMN IF NOT EXISTS can_shoot_approve       TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS can_shoot_close_approve TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE user_permissions
  ADD COLUMN IF NOT EXISTS can_shoot_approve       TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS can_shoot_close_approve TINYINT(1) NOT NULL DEFAULT 0;

-- 2. 'draft' status for calendar placeholders that haven't been filled yet
ALTER TABLE shoots MODIFY COLUMN status
  ENUM('draft','pending_approval','approved','rejected','pending_completion','completed') NOT NULL DEFAULT 'pending_approval';

-- 3. Close request tracking + footage on the shoot itself
ALTER TABLE shoots
  ADD COLUMN IF NOT EXISTS calendar_slot_id   INT UNSIGNED DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS close_requested_by INT UNSIGNED DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS close_requested_at DATETIME DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS footage_drive_link TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS shoot_statement    TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS footage_updated_by INT UNSIGNED DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS footage_updated_at DATETIME DEFAULT NULL;

-- Legacy columns no longer written by the app
ALTER TABLE shoots MODIFY COLUMN start_time TIME NULL DEFAULT NULL;
ALTER TABLE shoots MODIFY COLUMN end_time   TIME NULL DEFAULT NULL;

ALTER TABLE content_calendar_shoots
  ADD COLUMN IF NOT EXISTS completed_at DATETIME DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS completed_by INT UNSIGNED DEFAULT NULL;

-- 4. History actions for the close stage
ALTER TABLE smm_approval_history MODIFY COLUMN action
  ENUM('approve','reject','rework','submit','resubmit','complete','report_submit','report_approve','report_reject',
       'close_request','close_approve','close_reject') NOT NULL;

-- 5. Data fixes
-- 5a. Unfilled calendar placeholders → draft (out of the approval queue)
UPDATE shoots s
JOIN content_calendar_shoots cs ON cs.id = s.calendar_slot_id
SET s.status = 'draft'
WHERE s.deleted = 0 AND s.status = 'pending_approval'
  AND s.project_campaign_name = 'TBD' AND cs.slot_status = 'assigned';

-- 5b. Calendar slot approved but shoot left pending (old approveSlot didn't sync)
UPDATE shoots s
JOIN content_calendar_shoots cs ON cs.id = s.calendar_slot_id
SET s.status = 'approved', s.approved_by = COALESCE(s.approved_by, cs.approved_by), s.approved_at = COALESCE(s.approved_at, cs.approved_at)
WHERE s.deleted = 0 AND s.status = 'pending_approval' AND cs.slot_status = 'approved';

-- 5c. Shoot completed but calendar slot still approved (old close approval didn't sync)
UPDATE content_calendar_shoots cs
JOIN shoots s ON s.calendar_slot_id = cs.id AND s.deleted = 0
SET cs.slot_status = 'completed', cs.completed_at = COALESCE(cs.completed_at, s.completion_approved_at, NOW())
WHERE s.status = 'completed' AND cs.slot_status = 'approved';

-- Optional: give existing approvers the new toggles (copies from PC/PM Approval).
-- UPDATE role_permissions SET can_shoot_approve = 1, can_shoot_close_approve = 1
--   WHERE module = 'creative_hub' AND can_pcpm_approve = 1;
-- UPDATE user_permissions SET can_shoot_approve = 1, can_shoot_close_approve = 1
--   WHERE module = 'creative_hub' AND can_pcpm_approve = 1;
