-- Migration: Add closing_statement column to tasks table
-- This field stores the mandatory closing statement (min 30 words) 
-- that users must provide when marking a task as done.

ALTER TABLE tasks ADD COLUMN closing_statement TEXT DEFAULT NULL;
