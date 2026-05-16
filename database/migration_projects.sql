-- ============================================================
-- Projects Module - MySQL Schema
-- ============================================================

USE crm_task_module;

-- ------------------------------------------------------------
-- Projects table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title           VARCHAR(255) NOT NULL,
  description     TEXT,
  project_type    ENUM('internal','external') NOT NULL DEFAULT 'internal',
  client_id       INT UNSIGNED DEFAULT NULL,
  service_id      INT UNSIGNED DEFAULT NULL,
  start_date      DATE DEFAULT NULL,
  end_date        DATE DEFAULT NULL,
  status          ENUM('open','in_progress','completed','cancelled') NOT NULL DEFAULT 'open',
  created_by      INT UNSIGNED NOT NULL,
  deleted         TINYINT(1) NOT NULL DEFAULT 0,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_projects_client  FOREIGN KEY (client_id)  REFERENCES leads(id) ON DELETE SET NULL,
  CONSTRAINT fk_projects_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE SET NULL,
  CONSTRAINT fk_projects_created FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Project team members (many-to-many)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_members (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id  INT UNSIGNED NOT NULL,
  user_id     INT UNSIGNED NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pm_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_pm_user    FOREIGN KEY (user_id)    REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_project_user (project_id, user_id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Project tasks (link existing tasks to a project)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_tasks (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id  INT UNSIGNED NOT NULL,
  task_id     INT UNSIGNED NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pt_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_pt_task    FOREIGN KEY (task_id)    REFERENCES tasks(id) ON DELETE CASCADE,
  UNIQUE KEY uq_project_task (project_id, task_id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Project activity / notes timeline
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_activities (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id  INT UNSIGNED NOT NULL,
  type        VARCHAR(50) NOT NULL DEFAULT 'note',
  note        TEXT NOT NULL,
  created_by  INT UNSIGNED NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pa_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_pa_user    FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;
