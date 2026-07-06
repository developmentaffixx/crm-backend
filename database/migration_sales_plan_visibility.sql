-- Migration: Add visible_to_users column to sales_plan
-- Allows admins to toggle which cards are visible to regular users

ALTER TABLE sales_plan
ADD COLUMN visible_to_users TINYINT(1) NOT NULL DEFAULT 1
COMMENT 'Whether this section is visible to non-admin users (1=visible, 0=hidden)';
