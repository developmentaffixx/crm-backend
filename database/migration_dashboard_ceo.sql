-- ============================================================
-- Migration: CEO Dashboard ("Dashboard 4 (CEO)") submenu permission
--
-- OPTIONAL. No schema change is required — submenu access is stored in
-- role_submenu_permissions, and the option appears automatically in
-- Settings → Roles → Dashboard → "Dashboard 4 (CEO)".
--
-- The easiest way is to tick it in the Roles UI. If you prefer SQL,
-- this grants it to the role named 'CEO' (adjust the name if different):
-- ============================================================

INSERT INTO role_submenu_permissions (role_id, module, submenu, can_access)
SELECT r.id, 'dashboard', 'dashboard_ceo', 2
FROM roles r
WHERE r.name = 'CEO'
ON DUPLICATE KEY UPDATE can_access = 2;
