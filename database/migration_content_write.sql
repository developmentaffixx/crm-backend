USE crm_task_module;

-- ============================================================
-- Write Content Module - Database Migration
-- ============================================================

-- ------------------------------------------------------------
-- Content write requests table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_write_requests (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  
  -- Client & Service
  client_brand_id     INT UNSIGNED DEFAULT NULL,
  service_type        ENUM('social_media_management','content_writing','seo_optimization','ad_campaigns') NOT NULL,
  platform            VARCHAR(100) NOT NULL,
  content_type        ENUM('reel_video_script','static_post','carousel','blog_article','ad_copy','email_newsletter') NOT NULL,
  
  -- Deadline
  deadline            DATE NOT NULL,
  
  -- Content Details
  hook_opening_line   TEXT,
  core_message        TEXT,
  call_to_action      TEXT,
  hashtags            TEXT,
  reference_links     TEXT,
  visual_style_notes  TEXT,
  brand_assets_link   VARCHAR(500) DEFAULT NULL,
  special_instructions TEXT,
  
  -- Approval workflow
  status              ENUM('pending','approved','rejected','in_progress','completed') NOT NULL DEFAULT 'pending',
  admin_remarks       TEXT DEFAULT NULL,
  approved_by         INT UNSIGNED DEFAULT NULL,
  approved_at         DATETIME DEFAULT NULL,
  
  -- Tracking
  created_by          INT UNSIGNED NOT NULL,
  deleted             TINYINT(1) NOT NULL DEFAULT 0,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_cwr_client   FOREIGN KEY (client_brand_id) REFERENCES leads(id) ON DELETE SET NULL,
  CONSTRAINT fk_cwr_creator  FOREIGN KEY (created_by)      REFERENCES users(id),
  CONSTRAINT fk_cwr_approver FOREIGN KEY (approved_by)     REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;
