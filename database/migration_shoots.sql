USE crm_task_module;

-- ============================================================
-- Shoots Module - Database Migration
-- ============================================================

-- ------------------------------------------------------------
-- Shoots table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shoots (
  id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

  -- Client & Project
  client_brand_id       INT UNSIGNED DEFAULT NULL,
  project_campaign_name VARCHAR(255) NOT NULL,

  -- Schedule
  shoot_date            DATE NOT NULL,
  start_time            TIME NOT NULL,
  end_time              TIME NOT NULL,

  -- Location
  location_type         ENUM('client','office','outdoor_event') NOT NULL,
  exact_address         TEXT,
  city                  VARCHAR(100),
  maps_link             VARCHAR(500) DEFAULT NULL,

  -- Team (stored as JSON arrays of user IDs)
  photographers         JSON DEFAULT NULL,
  videographers         JSON DEFAULT NULL,
  shoot_manager_id      INT UNSIGNED DEFAULT NULL,

  -- Post-shoot counts (filled after shoot)
  photos_clicked        INT UNSIGNED DEFAULT NULL,
  video_clips           INT UNSIGNED DEFAULT NULL,
  reels_shot            INT UNSIGNED DEFAULT NULL,
  equipment_used        TEXT DEFAULT NULL,

  -- Shoot status & reshoot
  shoot_status          ENUM('completed','partially_completed','reshoot_required') DEFAULT NULL,
  reshoot_reason        TEXT DEFAULT NULL,

  -- Two-stage approval workflow
  -- Stage 1: pending_approval -> approved (shoot request approved)
  -- Stage 2: pending_completion -> completed (post-shoot data approved)
  status                ENUM('pending_approval','approved','rejected','pending_completion','completed') NOT NULL DEFAULT 'pending_approval',
  
  -- Stage 1 approval
  approved_by           INT UNSIGNED DEFAULT NULL,
  approved_at           DATETIME DEFAULT NULL,
  approval_remarks      TEXT DEFAULT NULL,

  -- Stage 2 approval
  completion_approved_by INT UNSIGNED DEFAULT NULL,
  completion_approved_at DATETIME DEFAULT NULL,
  completion_remarks     TEXT DEFAULT NULL,

  -- Tracking
  created_by            INT UNSIGNED NOT NULL,
  deleted               TINYINT(1) NOT NULL DEFAULT 0,
  created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_shoots_client    FOREIGN KEY (client_brand_id) REFERENCES leads(id) ON DELETE SET NULL,
  CONSTRAINT fk_shoots_manager   FOREIGN KEY (shoot_manager_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_shoots_creator   FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_shoots_approver  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_shoots_comp_appr FOREIGN KEY (completion_approved_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;
