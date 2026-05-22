USE crm_task_module;

-- Add status column to meetings table (if table already exists without it)
ALTER TABLE meetings
  ADD COLUMN status ENUM('scheduled','in_progress','completed','cancelled') NOT NULL DEFAULT 'scheduled'
  AFTER meeting_link;
