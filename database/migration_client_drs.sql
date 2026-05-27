USE crm_task_module;

-- ============================================================
-- Client DRS (Discovery & Research Sheet) - Database Migration
-- Sections: Account Manager, Content Writer, Graphic Designer,
--           Video Editor, Videographer, Ads Manager
-- ============================================================

CREATE TABLE IF NOT EXISTS client_drs (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id           INT UNSIGNED NOT NULL,
  section             ENUM('account_manager','content_writer','graphic_designer','video_editor','videographer','ads_manager') NOT NULL,
  data                JSON NOT NULL,
  completed           TINYINT(1) NOT NULL DEFAULT 0,
  completed_by        INT UNSIGNED DEFAULT NULL,
  completed_at        DATETIME DEFAULT NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_client_section (client_id, section),
  CONSTRAINT fk_drs_client FOREIGN KEY (client_id) REFERENCES leads(id) ON DELETE CASCADE,
  CONSTRAINT fk_drs_completed_by FOREIGN KEY (completed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;
