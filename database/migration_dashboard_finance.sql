-- ============================================================
-- Migration: Add dashboard_finance submenu permission
--
-- Your system stores submenu access directly in
-- role_submenu_permissions — no separate submenus table needed.
--
-- Run this ONE query to grant Finance Dashboard access
-- to role_id = 1 (admin role). Adjust role_id as needed.
-- ============================================================

INSERT INTO role_submenu_permissions (role_id, module, submenu, can_access)
VALUES (1, 'dashboard', 'dashboard_finance', 2)
ON DUPLICATE KEY UPDATE can_access = 2;

-- ============================================================
-- After running this, you can also assign it to other roles
-- via Settings → Roles → Dashboard → "Dashboard 3 (Finance)"
-- (the option now appears in the UI automatically).
-- ============================================================
