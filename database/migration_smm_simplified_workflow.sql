USE crm_task_module;

-- ============================================================
-- Simplified SMM Workflow - Migration
-- Adds linking columns + notification table for the new flow:
-- Book Slot → Assign → Notify → Fill on respective page → Approve/Reject → Complete
-- ============================================================

-- ─── 1. Add assigned_by to track who assigned the slot ────────────────────────

ALTER TABLE content_calendar_posts
  ADD COLUMN assigned_by INT UNSIGNED DEFAULT NULL AFTER assigned_to,
  ADD COLUMN linked_write_id INT UNSIGNED DEFAULT NULL AFTER approved_by,
  ADD CONSTRAINT fk_ccp_linked_write FOREIGN KEY (linked_write_id) REFERENCES content_write_requests(id) ON DELETE SET NULL;

ALTER TABLE content_calendar_shoots
  ADD COLUMN assigned_by INT UNSIGNED DEFAULT NULL AFTER assigned_to,
  ADD COLUMN linked_shoot_ref_id INT UNSIGNED DEFAULT NULL AFTER approved_by,
  ADD CONSTRAINT fk_ccs_linked_shoot_ref FOREIGN KEY (linked_shoot_ref_id) REFERENCES shoots(id) ON DELETE SET NULL;

ALTER TABLE content_calendar_ads
  ADD COLUMN assigned_by INT UNSIGNED DEFAULT NULL AFTER assigned_to,
  ADD COLUMN linked_campaign_ref_id INT UNSIGNED DEFAULT NULL AFTER approved_by;

-- ─── 2. Add slot_id column to respective tables for back-reference ────────────

ALTER TABLE content_write_requests
  ADD COLUMN calendar_slot_id INT UNSIGNED DEFAULT NULL AFTER content_id_code;

ALTER TABLE shoots
  ADD COLUMN calendar_slot_id INT UNSIGNED DEFAULT NULL AFTER shoot_id_code;

ALTER TABLE ad_campaigns
  ADD COLUMN calendar_slot_id INT UNSIGNED DEFAULT NULL AFTER id;

-- ─── 3. SMM Notifications table ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS smm_notifications (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  
  -- Who receives the notification
  user_id           INT UNSIGNED NOT NULL,
  
  -- Who triggered the notification
  triggered_by      INT UNSIGNED NOT NULL,
  
  -- Notification type
  type              ENUM(
    'slot_assigned',        -- You've been assigned a slot
    'slot_submitted',       -- Assignee submitted work (for assigner)
    'slot_approved',        -- Your work was approved (for assignee)
    'slot_rejected',        -- Your work was rejected (for assignee)
    'slot_completed'        -- Assignee marked as completed (for assigner)
  ) NOT NULL,
  
  -- Slot reference
  slot_type         ENUM('post','shoot','ad') NOT NULL,
  slot_id           INT UNSIGNED NOT NULL,
  
  -- Linked item reference (which page to navigate to)
  linked_item_type  ENUM('content_write','shoots','ads') DEFAULT NULL,
  linked_item_id    INT UNSIGNED DEFAULT NULL,
  
  -- Display info
  title             VARCHAR(255) NOT NULL,
  message           TEXT DEFAULT NULL,
  link              VARCHAR(500) DEFAULT NULL,
  
  -- Read status
  is_read           TINYINT(1) NOT NULL DEFAULT 0,
  read_at           DATETIME DEFAULT NULL,
  
  -- Tracking
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_smm_notif_user (user_id, is_read, created_at DESC),
  INDEX idx_smm_notif_slot (slot_type, slot_id),
  
  CONSTRAINT fk_smm_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_smm_notif_triggered FOREIGN KEY (triggered_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ─── 4. Update slot_status ENUM to include 'completed' ───────────────────────

ALTER TABLE content_calendar_posts
  MODIFY COLUMN slot_status ENUM('open','assigned','submitted','approved','rejected','completed') NOT NULL DEFAULT 'open';

ALTER TABLE content_calendar_shoots
  MODIFY COLUMN slot_status ENUM('open','assigned','submitted','approved','rejected','completed') NOT NULL DEFAULT 'open';

ALTER TABLE content_calendar_ads
  MODIFY COLUMN slot_status ENUM('open','assigned','submitted','approved','rejected','completed') NOT NULL DEFAULT 'open';
