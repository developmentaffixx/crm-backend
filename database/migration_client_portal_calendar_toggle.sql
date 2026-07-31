USE crm_task_module;

-- Add content calendar access toggle to client portal users
ALTER TABLE client_portal_users 
  ADD COLUMN content_calendar_access TINYINT(1) NOT NULL DEFAULT 0 
  COMMENT '1 = client can see content calendar on portal, 0 = hidden'
  AFTER is_active;
