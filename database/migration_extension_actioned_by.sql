-- Add actioned_by column to track who approved/rejected the extension request
ALTER TABLE task_deadline_extension_requests
  ADD COLUMN actioned_by INT UNSIGNED NULL DEFAULT NULL AFTER status,
  ADD CONSTRAINT fk_ext_actioned_by FOREIGN KEY (actioned_by) REFERENCES users(id);
