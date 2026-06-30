-- Migration: Role-based Social Media Ops submenu permissions
-- Each role can have granular access to individual Social Media Ops submenus

CREATE TABLE IF NOT EXISTS role_social_permissions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  role_id INT UNSIGNED NOT NULL,
  social_overview TINYINT(1) NOT NULL DEFAULT 0,
  content_calendar TINYINT(1) NOT NULL DEFAULT 0,
  content_writing TINYINT(1) NOT NULL DEFAULT 0,
  shoot_planning TINYINT(1) NOT NULL DEFAULT 0,
  ads_planning TINYINT(1) NOT NULL DEFAULT 0,
  daily_journal TINYINT(1) NOT NULL DEFAULT 0,
  report_centre TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_role (role_id),
  CONSTRAINT fk_rsp_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed: For existing roles that already have creative_hub can_view > 0, grant all submenus
INSERT INTO role_social_permissions (role_id, social_overview, content_calendar, content_writing, shoot_planning, ads_planning, daily_journal, report_centre)
SELECT r.id, 1, 1, 1, 1, 1, 1, 1
FROM roles r
INNER JOIN role_permissions rp ON rp.role_id = r.id AND rp.module = 'creative_hub' AND rp.can_view > 0
ON DUPLICATE KEY UPDATE role_id = role_id;
