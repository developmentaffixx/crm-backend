-- Migration: Project Service Members
-- Assigns team members at the service level instead of project level
-- Only assigned members (+ admins) can access that service's data

CREATE TABLE IF NOT EXISTS project_service_members (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_service_id  INT UNSIGNED NOT NULL,
  user_id             INT UNSIGNED NOT NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_psm_project_service FOREIGN KEY (project_service_id) REFERENCES project_services(id) ON DELETE CASCADE,
  CONSTRAINT fk_psm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_service_user (project_service_id, user_id)
) ENGINE=InnoDB;

-- Seed: copy existing project_members into project_service_members for all services
-- This ensures existing projects don't lose access
INSERT IGNORE INTO project_service_members (project_service_id, user_id)
SELECT ps.id, pm.user_id
FROM project_members pm
JOIN project_services ps ON ps.project_id = pm.project_id;
