USE crm_task_module;

-- Roles table
CREATE TABLE IF NOT EXISTS roles (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  is_system   TINYINT(1) NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Role permissions per module
CREATE TABLE IF NOT EXISTS role_permissions (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  role_id    INT UNSIGNED NOT NULL,
  module     VARCHAR(50) NOT NULL,
  can_view   TINYINT(1) NOT NULL DEFAULT 0,  -- 0=none, 1=own, 2=all
  can_create TINYINT(1) NOT NULL DEFAULT 0,
  can_edit   TINYINT(1) NOT NULL DEFAULT 0,  -- 0=none, 1=own, 2=all
  can_delete TINYINT(1) NOT NULL DEFAULT 0,  -- 0=none, 1=own, 2=all
  UNIQUE KEY uq_role_module (role_id, module),
  CONSTRAINT fk_rp_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Role change audit trail
CREATE TABLE IF NOT EXISTS user_role_history (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id      INT UNSIGNED NOT NULL,
  from_role_id INT UNSIGNED,
  to_role_id   INT UNSIGNED NOT NULL,
  changed_by   INT UNSIGNED NOT NULL,
  reason       TEXT,
  changed_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_urh_user    FOREIGN KEY (user_id)    REFERENCES users(id),
  CONSTRAINT fk_urh_changed FOREIGN KEY (changed_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- General audit log
CREATE TABLE IF NOT EXISTS audit_logs (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     INT UNSIGNED,
  action      VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50),
  entity_id   INT UNSIGNED,
  details     JSON,
  ip_address  VARCHAR(45),
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_al_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- Task settings (single-row config table)
CREATE TABLE IF NOT EXISTS task_settings (
  id                          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  members_can_create_tasks    TINYINT(1) NOT NULL DEFAULT 1,
  require_approval_new_tasks  TINYINT(1) NOT NULL DEFAULT 1,
  require_approval_completion TINYINT(1) NOT NULL DEFAULT 1,
  default_priority            ENUM('low','medium','high') NOT NULL DEFAULT 'medium',
  max_deadline_extension_days INT NOT NULL DEFAULT 30,
  updated_at                  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Add role_id to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id INT UNSIGNED DEFAULT NULL;
ALTER TABLE users ADD CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE SET NULL;

-- Seed default roles
INSERT IGNORE INTO roles (id, name, description, is_system) VALUES
(1, 'Admin',      'Full system access',                    1),
(2, 'Manager',    'Manage team tasks and view reports',    0),
(3, 'Developer',  'Create and manage own tasks',           0),
(4, 'Intern',     'View and work on assigned tasks only',  0);

-- Seed default permissions for Manager role
INSERT IGNORE INTO role_permissions (role_id, module, can_view, can_create, can_edit, can_delete) VALUES
(2, 'tasks',     2, 1, 2, 1),
(2, 'approvals', 2, 0, 0, 0),
(2, 'users',     2, 0, 0, 0),
(2, 'reports',   2, 0, 0, 0),
(2, 'settings',  0, 0, 0, 0);

-- Seed default permissions for Developer role
INSERT IGNORE INTO role_permissions (role_id, module, can_view, can_create, can_edit, can_delete) VALUES
(3, 'tasks',     1, 1, 1, 1),
(3, 'approvals', 1, 0, 0, 0),
(3, 'users',     0, 0, 0, 0),
(3, 'reports',   0, 0, 0, 0),
(3, 'settings',  0, 0, 0, 0);

-- Seed default permissions for Intern role
INSERT IGNORE INTO role_permissions (role_id, module, can_view, can_create, can_edit, can_delete) VALUES
(4, 'tasks',     1, 0, 0, 0),
(4, 'approvals', 1, 0, 0, 0),
(4, 'users',     0, 0, 0, 0),
(4, 'reports',   0, 0, 0, 0),
(4, 'settings',  0, 0, 0, 0);

-- Seed task settings row
INSERT IGNORE INTO task_settings (id) VALUES (1);
