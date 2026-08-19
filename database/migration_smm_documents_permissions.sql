-- Migration: SMM Documents - Role & User based access permissions
-- Adds access_type, allowed_roles, allowed_users columns to smm_documents table
-- access_type: 'all' (everyone), 'roles' (specific roles), 'users' (specific users), 'roles_and_users' (both)
-- allowed_roles: JSON array of role IDs (e.g. [1, 2, 4])
-- allowed_users: JSON array of user IDs (e.g. [5, 12, 18])

ALTER TABLE smm_documents
  ADD COLUMN IF NOT EXISTS access_type ENUM('all', 'roles', 'users', 'roles_and_users') NOT NULL DEFAULT 'all' AFTER page_targets,
  ADD COLUMN IF NOT EXISTS allowed_roles JSON DEFAULT NULL AFTER access_type,
  ADD COLUMN IF NOT EXISTS allowed_users JSON DEFAULT NULL AFTER allowed_roles;
