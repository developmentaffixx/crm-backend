-- Add brand_name column to quotations table
ALTER TABLE quotations ADD COLUMN brand_name VARCHAR(255) NULL AFTER client_name;
