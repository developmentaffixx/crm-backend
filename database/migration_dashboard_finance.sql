-- ============================================================
-- Migration: Add dashboard_finance submenu permission
-- This allows assigning Finance Dashboard access to roles/users
-- via the existing submenu permission system.
-- ============================================================

-- 1. Insert the submenu definition (if a submenus registry table exists)
--    This is a no-op if your system reads submenu keys dynamically from
--    role_submenu_permissions / user_submenu_permissions directly.
--    Safe to run multiple times (INSERT IGNORE).

INSERT IGNORE INTO submenus (module, submenu, label, sort_order)
VALUES ('dashboard', 'dashboard_finance', 'Finance Dashboard', 30)
ON DUPLICATE KEY UPDATE label = 'Finance Dashboard';

-- 2. Grant Finance Dashboard access to the Admin role (role_id = 1).
--    Adjust role_id if your admin role has a different ID.
INSERT INTO role_submenu_permissions (role_id, module, submenu, can_access)
VALUES (1, 'dashboard', 'dashboard_finance', 2)
ON DUPLICATE KEY UPDATE can_access = 2;

-- Done. To grant access to other roles, run:
-- INSERT INTO role_submenu_permissions (role_id, module, submenu, can_access)
-- VALUES (<role_id>, 'dashboard', 'dashboard_finance', 1)
-- ON DUPLICATE KEY UPDATE can_access = 1;
