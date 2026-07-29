-- Migration: Generalized submenu permissions for all modules
-- This replaces the module-specific approach (role_social_permissions) with a generic table
-- that works for any module's submenus.
-- Values: 0 = None, 1 = Own, 2 = All

CREATE TABLE IF NOT EXISTS role_submenu_permissions (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  role_id    INT UNSIGNED NOT NULL,
  module     VARCHAR(50) NOT NULL,
  submenu    VARCHAR(50) NOT NULL,
  can_access TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_role_module_submenu (role_id, module, submenu),
  CONSTRAINT fk_rsmp_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Migrate existing social permissions data into the new generic table
INSERT INTO role_submenu_permissions (role_id, module, submenu, can_access)
SELECT role_id, 'creative_hub', 'social_overview', social_overview FROM role_social_permissions WHERE social_overview > 0
ON DUPLICATE KEY UPDATE can_access = VALUES(can_access);

INSERT INTO role_submenu_permissions (role_id, module, submenu, can_access)
SELECT role_id, 'creative_hub', 'content_calendar', content_calendar FROM role_social_permissions WHERE content_calendar > 0
ON DUPLICATE KEY UPDATE can_access = VALUES(can_access);

INSERT INTO role_submenu_permissions (role_id, module, submenu, can_access)
SELECT role_id, 'creative_hub', 'content_writing', content_writing FROM role_social_permissions WHERE content_writing > 0
ON DUPLICATE KEY UPDATE can_access = VALUES(can_access);

INSERT INTO role_submenu_permissions (role_id, module, submenu, can_access)
SELECT role_id, 'creative_hub', 'shoot_planning', shoot_planning FROM role_social_permissions WHERE shoot_planning > 0
ON DUPLICATE KEY UPDATE can_access = VALUES(can_access);

INSERT INTO role_submenu_permissions (role_id, module, submenu, can_access)
SELECT role_id, 'creative_hub', 'ads_planning', ads_planning FROM role_social_permissions WHERE ads_planning > 0
ON DUPLICATE KEY UPDATE can_access = VALUES(can_access);

INSERT INTO role_submenu_permissions (role_id, module, submenu, can_access)
SELECT role_id, 'creative_hub', 'daily_journal', daily_journal FROM role_social_permissions WHERE daily_journal > 0
ON DUPLICATE KEY UPDATE can_access = VALUES(can_access);

INSERT INTO role_submenu_permissions (role_id, module, submenu, can_access)
SELECT role_id, 'creative_hub', 'report_centre', report_centre FROM role_social_permissions WHERE report_centre > 0
ON DUPLICATE KEY UPDATE can_access = VALUES(can_access);

-- Seed: For roles that have people_ops can_view > 0, grant ALL (2) for all people_ops submenus
INSERT INTO role_submenu_permissions (role_id, module, submenu, can_access)
SELECT rp.role_id, 'people_ops', 'on_boarding', 2
FROM role_permissions rp WHERE rp.module = 'people_ops' AND rp.can_view > 0
ON DUPLICATE KEY UPDATE can_access = VALUES(can_access);

INSERT INTO role_submenu_permissions (role_id, module, submenu, can_access)
SELECT rp.role_id, 'people_ops', 'recruitment', 2
FROM role_permissions rp WHERE rp.module = 'people_ops' AND rp.can_view > 0
ON DUPLICATE KEY UPDATE can_access = VALUES(can_access);

INSERT INTO role_submenu_permissions (role_id, module, submenu, can_access)
SELECT rp.role_id, 'people_ops', 'leaves', 2
FROM role_permissions rp WHERE rp.module = 'people_ops' AND rp.can_view > 0
ON DUPLICATE KEY UPDATE can_access = VALUES(can_access);

INSERT INTO role_submenu_permissions (role_id, module, submenu, can_access)
SELECT rp.role_id, 'people_ops', 'reimbursements', 2
FROM role_permissions rp WHERE rp.module = 'people_ops' AND rp.can_view > 0
ON DUPLICATE KEY UPDATE can_access = VALUES(can_access);

-- Seed: For roles that have revenue can_view > 0, grant ALL (2) for all revenue submenus
INSERT INTO role_submenu_permissions (role_id, module, submenu, can_access)
SELECT rp.role_id, 'revenue', 'leads', 2
FROM role_permissions rp WHERE rp.module = 'revenue' AND rp.can_view > 0
ON DUPLICATE KEY UPDATE can_access = VALUES(can_access);

INSERT INTO role_submenu_permissions (role_id, module, submenu, can_access)
SELECT rp.role_id, 'revenue', 'proposals', 2
FROM role_permissions rp WHERE rp.module = 'revenue' AND rp.can_view > 0
ON DUPLICATE KEY UPDATE can_access = VALUES(can_access);

INSERT INTO role_submenu_permissions (role_id, module, submenu, can_access)
SELECT rp.role_id, 'revenue', 'quotations', 2
FROM role_permissions rp WHERE rp.module = 'revenue' AND rp.can_view > 0
ON DUPLICATE KEY UPDATE can_access = VALUES(can_access);

INSERT INTO role_submenu_permissions (role_id, module, submenu, can_access)
SELECT rp.role_id, 'revenue', 'vendor_agreement', 2
FROM role_permissions rp WHERE rp.module = 'revenue' AND rp.can_view > 0
ON DUPLICATE KEY UPDATE can_access = VALUES(can_access);

INSERT INTO role_submenu_permissions (role_id, module, submenu, can_access)
SELECT rp.role_id, 'revenue', 'introduction', 2
FROM role_permissions rp WHERE rp.module = 'revenue' AND rp.can_view > 0
ON DUPLICATE KEY UPDATE can_access = VALUES(can_access);

-- Seed: For roles that have finance can_view > 0, grant ALL (2) for all finance submenus
INSERT INTO role_submenu_permissions (role_id, module, submenu, can_access)
SELECT rp.role_id, 'finance', 'invoices', 2
FROM role_permissions rp WHERE rp.module = 'finance' AND rp.can_view > 0
ON DUPLICATE KEY UPDATE can_access = VALUES(can_access);

INSERT INTO role_submenu_permissions (role_id, module, submenu, can_access)
SELECT rp.role_id, 'finance', 'expenses', 2
FROM role_permissions rp WHERE rp.module = 'finance' AND rp.can_view > 0
ON DUPLICATE KEY UPDATE can_access = VALUES(can_access);

INSERT INTO role_submenu_permissions (role_id, module, submenu, can_access)
SELECT rp.role_id, 'finance', 'income', 2
FROM role_permissions rp WHERE rp.module = 'finance' AND rp.can_view > 0
ON DUPLICATE KEY UPDATE can_access = VALUES(can_access);

INSERT INTO role_submenu_permissions (role_id, module, submenu, can_access)
SELECT rp.role_id, 'finance', 'assets', 2
FROM role_permissions rp WHERE rp.module = 'finance' AND rp.can_view > 0
ON DUPLICATE KEY UPDATE can_access = VALUES(can_access);

INSERT INTO role_submenu_permissions (role_id, module, submenu, can_access)
SELECT rp.role_id, 'finance', 'payroll', 2
FROM role_permissions rp WHERE rp.module = 'finance' AND rp.can_view > 0
ON DUPLICATE KEY UPDATE can_access = VALUES(can_access);

INSERT INTO role_submenu_permissions (role_id, module, submenu, can_access)
SELECT rp.role_id, 'finance', 'software_licenses', 2
FROM role_permissions rp WHERE rp.module = 'finance' AND rp.can_view > 0
ON DUPLICATE KEY UPDATE can_access = VALUES(can_access);

INSERT INTO role_submenu_permissions (role_id, module, submenu, can_access)
SELECT rp.role_id, 'finance', 'inventories', 2
FROM role_permissions rp WHERE rp.module = 'finance' AND rp.can_view > 0
ON DUPLICATE KEY UPDATE can_access = VALUES(can_access);

-- Seed: For roles that have reports can_view > 0, grant ALL (2) for all reports submenus
INSERT INTO role_submenu_permissions (role_id, module, submenu, can_access)
SELECT rp.role_id, 'reports', 'employees', 2
FROM role_permissions rp WHERE rp.module = 'reports' AND rp.can_view > 0
ON DUPLICATE KEY UPDATE can_access = VALUES(can_access);

INSERT INTO role_submenu_permissions (role_id, module, submenu, can_access)
SELECT rp.role_id, 'reports', 'clients', 2
FROM role_permissions rp WHERE rp.module = 'reports' AND rp.can_view > 0
ON DUPLICATE KEY UPDATE can_access = VALUES(can_access);

INSERT INTO role_submenu_permissions (role_id, module, submenu, can_access)
SELECT rp.role_id, 'reports', 'tickets', 2
FROM role_permissions rp WHERE rp.module = 'reports' AND rp.can_view > 0
ON DUPLICATE KEY UPDATE can_access = VALUES(can_access);

INSERT INTO role_submenu_permissions (role_id, module, submenu, can_access)
SELECT rp.role_id, 'reports', 'leads', 2
FROM role_permissions rp WHERE rp.module = 'reports' AND rp.can_view > 0
ON DUPLICATE KEY UPDATE can_access = VALUES(can_access);

INSERT INTO role_submenu_permissions (role_id, module, submenu, can_access)
SELECT rp.role_id, 'reports', 'projects', 2
FROM role_permissions rp WHERE rp.module = 'reports' AND rp.can_view > 0
ON DUPLICATE KEY UPDATE can_access = VALUES(can_access);

INSERT INTO role_submenu_permissions (role_id, module, submenu, can_access)
SELECT rp.role_id, 'reports', 'finance', 2
FROM role_permissions rp WHERE rp.module = 'reports' AND rp.can_view > 0
ON DUPLICATE KEY UPDATE can_access = VALUES(can_access);

INSERT INTO role_submenu_permissions (role_id, module, submenu, can_access)
SELECT rp.role_id, 'reports', 'performance', 2
FROM role_permissions rp WHERE rp.module = 'reports' AND rp.can_view > 0
ON DUPLICATE KEY UPDATE can_access = VALUES(can_access);
