USE crm_task_module;

-- ============================================================
-- Project Resource Hub - Database Migration
-- DRS and IBRS for Projects
-- ============================================================

-- ------------------------------------------------------------
-- Project DRS (Discovery & Research Sheet)
-- Same sections as client DRS but scoped to project
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_drs (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id          INT UNSIGNED NOT NULL,
  section             ENUM('account_manager','content_writer','graphic_designer','video_editor','videographer','ads_manager') NOT NULL,
  data                JSON NOT NULL,
  completed           TINYINT(1) NOT NULL DEFAULT 0,
  completed_by        INT UNSIGNED DEFAULT NULL,
  completed_at        DATETIME DEFAULT NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_project_drs_section (project_id, section),
  CONSTRAINT fk_pdrs_project      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_pdrs_completed_by FOREIGN KEY (completed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Project IBRS (Initial Business Research Sheet)
-- Stored as JSON sections similar to DRS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_ibrs (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id          INT UNSIGNED NOT NULL,
  section             VARCHAR(100) NOT NULL,
  data                JSON NOT NULL,
  completed           TINYINT(1) NOT NULL DEFAULT 0,
  completed_by        INT UNSIGNED DEFAULT NULL,
  completed_at        DATETIME DEFAULT NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_project_ibrs_section (project_id, section),
  CONSTRAINT fk_pibrs_project      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_pibrs_completed_by FOREIGN KEY (completed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;
