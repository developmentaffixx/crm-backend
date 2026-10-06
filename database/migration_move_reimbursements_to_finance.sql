-- ============================================================================
-- Migration: Reassign Reimbursements to Vaidyanathan & Move to Finance Module
-- ============================================================================

-- 1. Reassign existing reimbursements belonging to Super Admin (user_id = 1) to Vaidyanathan
UPDATE reimbursements 
SET user_id = (
  SELECT id FROM users 
  WHERE email = 'vaidyanathan2003@gmail.com' 
     OR (first_name = 'Vaidyanathan' AND last_name = 'V')
  LIMIT 1
)
WHERE user_id = 1;

-- 2. Mirror/migrate submenu permissions for Reimbursements from 'people_ops' to 'finance'
INSERT INTO role_submenu_permissions (role_id, module, submenu, can_access)
SELECT role_id, 'finance', 'reimbursements', can_access
FROM role_submenu_permissions
WHERE module = 'people_ops' AND submenu = 'reimbursements'
ON DUPLICATE KEY UPDATE can_access = VALUES(can_access);

INSERT INTO user_submenu_permissions (user_id, module, submenu, can_access)
SELECT user_id, 'finance', 'reimbursements', can_access
FROM user_submenu_permissions
WHERE module = 'people_ops' AND submenu = 'reimbursements'
ON DUPLICATE KEY UPDATE can_access = VALUES(can_access);
