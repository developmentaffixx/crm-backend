-- Add project_overview column to proposals table
ALTER TABLE proposals
  ADD COLUMN project_overview TEXT DEFAULT NULL
  AFTER brand_color;
