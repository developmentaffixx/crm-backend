-- ============================================================
-- SMM Slot Links Migration
-- Run this on the live database to enable the full workflow:
-- Calendar → Fill → Submit → Approve/Reject → Re-work
-- ============================================================

USE crm_task_module;

-- 1. Add calendar_slot_id to content_write_requests (links post slot to content write record)
ALTER TABLE content_write_requests
  ADD COLUMN IF NOT EXISTS calendar_slot_id INT UNSIGNED DEFAULT NULL AFTER content_id_code;

-- 2. Add calendar_slot_id to shoots (links shoot slot to shoot record)
ALTER TABLE shoots
  ADD COLUMN IF NOT EXISTS calendar_slot_id INT UNSIGNED DEFAULT NULL AFTER shoot_id_code;

-- 3. Add calendar_slot_id to ad_campaigns (links ad slot to ad campaign record)
--    Note: linked_calendar_ad_id already exists, calendar_slot_id is added for consistent naming
ALTER TABLE ad_campaigns
  ADD COLUMN IF NOT EXISTS calendar_slot_id INT UNSIGNED DEFAULT NULL AFTER id;

-- 4. Ensure submitted_at column exists on all three calendar tables
ALTER TABLE content_calendar_posts
  ADD COLUMN IF NOT EXISTS submitted_at DATETIME DEFAULT NULL AFTER slot_status;

ALTER TABLE content_calendar_shoots
  ADD COLUMN IF NOT EXISTS submitted_at DATETIME DEFAULT NULL AFTER slot_status;

ALTER TABLE content_calendar_ads
  ADD COLUMN IF NOT EXISTS submitted_at DATETIME DEFAULT NULL AFTER slot_status;

-- 5. Ensure smm_notifications table exists (from migration_smm_simplified_workflow.sql)
CREATE TABLE IF NOT EXISTS smm_notifications (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id           INT UNSIGNED NOT NULL,
  triggered_by      INT UNSIGNED NOT NULL,
  type              ENUM('slot_assigned','slot_submitted','slot_approved','slot_rejected','slot_completed') NOT NULL,
  slot_type         ENUM('post','shoot','ad') NOT NULL,
  slot_id           INT UNSIGNED NOT NULL,
  linked_item_type  ENUM('content_write','shoots','ads') DEFAULT NULL,
  linked_item_id    INT UNSIGNED DEFAULT NULL,
  title             VARCHAR(255) NOT NULL,
  message           TEXT DEFAULT NULL,
  link              VARCHAR(500) DEFAULT NULL,
  is_read           TINYINT(1) NOT NULL DEFAULT 0,
  read_at           DATETIME DEFAULT NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_smm_notif_user (user_id, is_read, created_at DESC),
  INDEX idx_smm_notif_slot (slot_type, slot_id),
  CONSTRAINT fk_smm_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_smm_notif_triggered FOREIGN KEY (triggered_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
