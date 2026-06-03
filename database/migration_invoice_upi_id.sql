-- Add upi_id column to invoices table
ALTER TABLE invoices ADD COLUMN upi_id VARCHAR(100) DEFAULT NULL AFTER branch;
