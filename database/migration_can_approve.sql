-- Migration: Add can_approve column to role_permissions and user_permissions
-- This controls whether a user can access the Approvals page from the Tasks module.

ALTER TABLE role_permissions
  ADD COLUMN IF NOT EXISTS can_approve TINYINT(1) NOT NULL DEFAULT 0;

ALTER TABLE user_permissions
  ADD COLUMN IF NOT EXISTS can_approve TINYINT(1) NOT NULL DEFAULT 0;
