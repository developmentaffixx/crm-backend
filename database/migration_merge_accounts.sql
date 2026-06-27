-- ============================================================
-- MERGE PROJECTS INTO ACCOUNTS WITH MULTIPLE SERVICES
-- 
-- 1. Affixx: PRJ-INT-001 (Affixx Media) = surviving account
--    - PRJ-INT-002 (Affixx Personal Branding) → becomes a service
--    - PRJ-INT-003 (Affixx Tech Development) → becomes a service
--
-- 2. Neelas Sarees: PRJ-AFXCL002-001 (Neelas sarees - SMM) = surviving account
--    - PRJ-AFXCL002-002 (Neelas sarees - Development) → becomes a service
--
-- IMPORTANT: Run this ONCE. Check your project_id_code values match before running.
-- ============================================================

USE crm_task_module;

-- ──────────────────────────────────────────────────────────────────────────────
-- STEP 1: RENAME SURVIVING ACCOUNTS
-- ──────────────────────────────────────────────────────────────────────────────

-- Rename "Affixx Media" → "Affixx Media" (keep as is, it's already correct)
-- If you want just "Affixx", uncomment below:
-- UPDATE projects SET title = 'Affixx' WHERE project_id_code = 'PRJ-INT-001' AND deleted = 0;

-- Rename "Neelas sarees - SMM" → "Neelas Sarees"
UPDATE projects SET title = 'Neelas Sarees' WHERE project_id_code = 'PRJ-AFXCL002-001' AND deleted = 0;

-- ──────────────────────────────────────────────────────────────────────────────
-- STEP 2: ENSURE SERVICES EXIST IN THE services TABLE
-- (These are the service definitions — check if they already exist)
-- ──────────────────────────────────────────────────────────────────────────────

-- Insert services if not exists (adjust names as needed)
INSERT INTO services (name, icon, service_type, is_active, created_by)
SELECT 'Tech Development', '💻', 'one_time', 1, 1
FROM dual WHERE NOT EXISTS (SELECT 1 FROM services WHERE name = 'Tech Development' AND deleted = 0);

INSERT INTO services (name, icon, service_type, is_active, created_by)
SELECT 'Personal Branding', '🎨', 'recurring', 1, 1
FROM dual WHERE NOT EXISTS (SELECT 1 FROM services WHERE name = 'Personal Branding' AND deleted = 0);

INSERT INTO services (name, icon, service_type, is_active, created_by)
SELECT 'Media', '📱', 'recurring', 1, 1
FROM dual WHERE NOT EXISTS (SELECT 1 FROM services WHERE name = 'Media' AND deleted = 0);

INSERT INTO services (name, icon, service_type, is_active, created_by)
SELECT 'Development', '🛠️', 'one_time', 1, 1
FROM dual WHERE NOT EXISTS (SELECT 1 FROM services WHERE name = 'Development' AND deleted = 0);

-- SMM should already exist, but just in case:
INSERT INTO services (name, icon, service_type, is_active, created_by)
SELECT 'SMM', '📢', 'recurring', 1, 1
FROM dual WHERE NOT EXISTS (SELECT 1 FROM services WHERE name = 'SMM' AND deleted = 0);

-- ──────────────────────────────────────────────────────────────────────────────
-- STEP 3: CREATE project_services ENTRIES FOR AFFIXX MEDIA (PRJ-INT-001)
-- Link each old project's service_id into project_services of the surviving account
-- ──────────────────────────────────────────────────────────────────────────────

-- Get the surviving Affixx project id
SET @affixx_id = (SELECT id FROM projects WHERE project_id_code = 'PRJ-INT-001' AND deleted = 0 LIMIT 1);
SET @affixx_tech_id = (SELECT id FROM projects WHERE project_id_code = 'PRJ-INT-003' AND deleted = 0 LIMIT 1);
SET @affixx_branding_id = (SELECT id FROM projects WHERE project_id_code = 'PRJ-INT-002' AND deleted = 0 LIMIT 1);

-- Service IDs
SET @svc_tech = (SELECT id FROM services WHERE name = 'Tech Development' AND deleted = 0 LIMIT 1);
SET @svc_branding = (SELECT id FROM services WHERE name = 'Personal Branding' AND deleted = 0 LIMIT 1);
SET @svc_media = (SELECT id FROM services WHERE name = 'Media' AND deleted = 0 LIMIT 1);

-- Add services to the surviving Affixx account (ignore if already exists)
INSERT IGNORE INTO project_services (project_id, service_id, start_date, status, created_by)
SELECT @affixx_id, @svc_media, p.start_date, 'active', p.created_by
FROM projects p WHERE p.id = @affixx_id;

INSERT IGNORE INTO project_services (project_id, service_id, start_date, status, created_by)
SELECT @affixx_id, @svc_tech, p.start_date, p.status, p.created_by
FROM projects p WHERE p.id = @affixx_tech_id;

INSERT IGNORE INTO project_services (project_id, service_id, start_date, status, created_by)
SELECT @affixx_id, @svc_branding, p.start_date, p.status, p.created_by
FROM projects p WHERE p.id = @affixx_branding_id;

-- ──────────────────────────────────────────────────────────────────────────────
-- STEP 4: MOVE CYCLES FROM OLD AFFIXX PROJECTS → SURVIVING ACCOUNT
-- ──────────────────────────────────────────────────────────────────────────────

-- Move cycles from Affixx Tech Dev to surviving account under its project_service
SET @ps_tech = (SELECT id FROM project_services WHERE project_id = @affixx_id AND service_id = @svc_tech LIMIT 1);
UPDATE service_cycles SET project_id = @affixx_id, project_service_id = @ps_tech
WHERE project_id = @affixx_tech_id;

-- Move cycles from Affixx Branding to surviving account under its project_service
SET @ps_branding = (SELECT id FROM project_services WHERE project_id = @affixx_id AND service_id = @svc_branding LIMIT 1);
UPDATE service_cycles SET project_id = @affixx_id, project_service_id = @ps_branding
WHERE project_id = @affixx_branding_id;

-- Ensure existing cycles on Affixx Media itself are linked to the Media service
SET @ps_media = (SELECT id FROM project_services WHERE project_id = @affixx_id AND service_id = @svc_media LIMIT 1);
UPDATE service_cycles SET project_service_id = @ps_media
WHERE project_id = @affixx_id AND project_service_id IS NULL;

-- ──────────────────────────────────────────────────────────────────────────────
-- STEP 5: MOVE TASKS & TICKETS FROM OLD AFFIXX PROJECTS
-- ──────────────────────────────────────────────────────────────────────────────

-- Move project_tasks
UPDATE project_tasks SET project_id = @affixx_id WHERE project_id = @affixx_tech_id;
UPDATE project_tasks SET project_id = @affixx_id WHERE project_id = @affixx_branding_id;

-- Move tickets
UPDATE tickets SET project_id = @affixx_id WHERE project_id = @affixx_tech_id;
UPDATE tickets SET project_id = @affixx_id WHERE project_id = @affixx_branding_id;

-- Move project_members (ignore duplicates)
INSERT IGNORE INTO project_members (project_id, user_id)
SELECT @affixx_id, user_id FROM project_members WHERE project_id = @affixx_tech_id;
INSERT IGNORE INTO project_members (project_id, user_id)
SELECT @affixx_id, user_id FROM project_members WHERE project_id = @affixx_branding_id;

-- Move activities
UPDATE project_activities SET project_id = @affixx_id WHERE project_id = @affixx_tech_id;
UPDATE project_activities SET project_id = @affixx_id WHERE project_id = @affixx_branding_id;

-- ──────────────────────────────────────────────────────────────────────────────
-- STEP 6: SOFT-DELETE OLD AFFIXX PROJECTS
-- ──────────────────────────────────────────────────────────────────────────────

UPDATE projects SET deleted = 1 WHERE id = @affixx_tech_id;
UPDATE projects SET deleted = 1 WHERE id = @affixx_branding_id;

-- ══════════════════════════════════════════════════════════════════════════════
-- NEELAS SAREES MERGE
-- ══════════════════════════════════════════════════════════════════════════════

SET @neelas_smm_id = (SELECT id FROM projects WHERE project_id_code = 'PRJ-AFXCL002-001' AND deleted = 0 LIMIT 1);
SET @neelas_dev_id = (SELECT id FROM projects WHERE project_id_code = 'PRJ-AFXCL002-002' AND deleted = 0 LIMIT 1);

SET @svc_smm = (SELECT id FROM services WHERE name = 'SMM' AND deleted = 0 LIMIT 1);
SET @svc_dev = (SELECT id FROM services WHERE name = 'Development' AND deleted = 0 LIMIT 1);

-- Add services to surviving Neelas account
INSERT IGNORE INTO project_services (project_id, service_id, start_date, status, created_by)
SELECT @neelas_smm_id, @svc_smm, p.start_date, 'active', p.created_by
FROM projects p WHERE p.id = @neelas_smm_id;

INSERT IGNORE INTO project_services (project_id, service_id, start_date, status, created_by)
SELECT @neelas_smm_id, @svc_dev, p.start_date, p.status, p.created_by
FROM projects p WHERE p.id = @neelas_dev_id;

-- Move cycles from Dev project to surviving account
SET @ps_neelas_dev = (SELECT id FROM project_services WHERE project_id = @neelas_smm_id AND service_id = @svc_dev LIMIT 1);
UPDATE service_cycles SET project_id = @neelas_smm_id, project_service_id = @ps_neelas_dev
WHERE project_id = @neelas_dev_id;

-- Link existing SMM cycles
SET @ps_neelas_smm = (SELECT id FROM project_services WHERE project_id = @neelas_smm_id AND service_id = @svc_smm LIMIT 1);
UPDATE service_cycles SET project_service_id = @ps_neelas_smm
WHERE project_id = @neelas_smm_id AND project_service_id IS NULL;

-- Move tasks, tickets, members, activities
UPDATE project_tasks SET project_id = @neelas_smm_id WHERE project_id = @neelas_dev_id;
UPDATE tickets SET project_id = @neelas_smm_id WHERE project_id = @neelas_dev_id;
INSERT IGNORE INTO project_members (project_id, user_id)
SELECT @neelas_smm_id, user_id FROM project_members WHERE project_id = @neelas_dev_id;
UPDATE project_activities SET project_id = @neelas_smm_id WHERE project_id = @neelas_dev_id;

-- Soft-delete old Neelas Dev project
UPDATE projects SET deleted = 1 WHERE id = @neelas_dev_id;

-- ──────────────────────────────────────────────────────────────────────────────
-- DONE! The merged projects are now soft-deleted.
-- The surviving accounts have all services, cycles, tasks, and tickets.
-- ──────────────────────────────────────────────────────────────────────────────
