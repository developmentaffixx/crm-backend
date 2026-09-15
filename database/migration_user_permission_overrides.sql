-- Migration: Per-User Permission Overrides (Option B)
-- These tables store overrides ON TOP of the role-based permissions.
-- Only rows that differ from the role default need to be stored.
-- Values: can_view/can_edit: 0=None, 1=Own, 2=All | can_create/can_delete: 0=No, 1=Yes

-- ─── Module-level overrides ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_permissions (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     INT UNSIGNED NOT NULL,
  module      VARCHAR(50)  NOT NULL,
  can_view    TINYINT(1)   NOT NULL DEFAULT 0,
  can_create  TINYINT(1)   NOT NULL DEFAULT 0,
  can_edit    TINYINT(1)   NOT NULL DEFAULT 0,
  can_delete  TINYINT(1)   NOT NULL DEFAULT 0,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_module (user_id, module),
  CONSTRAINT fk_up_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─── Submenu-level overrides ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_submenu_permissions (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id     INT UNSIGNED NOT NULL,
  module      VARCHAR(50)  NOT NULL,
  submenu     VARCHAR(50)  NOT NULL,
  can_access  TINYINT(1)   NOT NULL DEFAULT 0,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_module_submenu (user_id, module, submenu),
  CONSTRAINT fk_usp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
