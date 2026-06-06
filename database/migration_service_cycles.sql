-- ============================================================
-- Service Cycles Module - Database Migration
-- Auto-generated monthly cycles for project/services
-- SAFE: Only creates new tables, does not modify existing ones
-- ============================================================

USE crm_task_module;

-- ------------------------------------------------------------
-- Service Cycles table
-- Each project (service) can have multiple monthly cycles
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS service_cycles (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id      INT UNSIGNED NOT NULL,
  cycle_number    INT UNSIGNED NOT NULL,
  title           VARCHAR(100) NOT NULL,
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  status          ENUM('upcoming','active','completed','skipped') NOT NULL DEFAULT 'upcoming',
  notes           TEXT,
  created_by      INT UNSIGNED DEFAULT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_sc_project  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_sc_created  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uq_project_cycle (project_id, cycle_number)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Cycle Sections table
-- Each cycle has 7 standard sections that repeat
-- Planning, Research, Tasks, Approvals, Execution, Reporting, Feedback
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cycle_sections (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cycle_id        INT UNSIGNED NOT NULL,
  section_key     ENUM('planning','research','tasks','approvals','execution','reporting','feedback') NOT NULL,
  title           VARCHAR(100) NOT NULL,
  content         TEXT,
  status          ENUM('not_started','in_progress','completed') NOT NULL DEFAULT 'not_started',
  completed_by    INT UNSIGNED DEFAULT NULL,
  completed_at    DATETIME DEFAULT NULL,
  sort_order      TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_cs_cycle      FOREIGN KEY (cycle_id) REFERENCES service_cycles(id) ON DELETE CASCADE,
  CONSTRAINT fk_cs_completed  FOREIGN KEY (completed_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uq_cycle_section (cycle_id, section_key)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Cycle Tasks - link tasks to a specific cycle
-- (Separate from project_tasks which links tasks to project level)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cycle_tasks (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cycle_id    INT UNSIGNED NOT NULL,
  task_id     INT UNSIGNED NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ct_cycle FOREIGN KEY (cycle_id) REFERENCES service_cycles(id) ON DELETE CASCADE,
  CONSTRAINT fk_ct_task  FOREIGN KEY (task_id)  REFERENCES tasks(id) ON DELETE CASCADE,
  UNIQUE KEY uq_cycle_task (cycle_id, task_id)
) ENGINE=InnoDB;
