USE crm_task_module;

-- ============================================================
-- Lead Stages v2 - Simplified Pipeline (Single Source of Truth)
-- Merges 'status' and 'lead_stage' into one field: lead_stage
-- Old stages: Cold, Contacted, Replied, Interested, Qualified, Meeting Scheduled, Proposal Sent, Negotiation, Won, Lost
-- New stages: New, Contacted, Replied, Interested, Qualified, Meeting, Proposal, Negotiation, Won, Lost
-- ============================================================

-- Step 1: Fix leads where status = 'Won' but lead_stage is out of sync
UPDATE leads SET lead_stage = 'Won', lead_score = 5, temperature = 'hot' WHERE status = 'Won';
UPDATE leads SET lead_stage = 'Lost', lead_score = 1, temperature = 'cold' WHERE status = 'Lost' AND lead_stage NOT IN ('Lost');

-- Step 2: Rename old stage values to new ones
UPDATE leads SET lead_stage = 'New' WHERE lead_stage = 'Cold';
UPDATE leads SET lead_stage = 'Meeting' WHERE lead_stage = 'Meeting Scheduled';
UPDATE leads SET lead_stage = 'Proposal' WHERE lead_stage = 'Proposal Sent';

-- Step 3: Sync status column with lead_stage (lead_stage is now the single source of truth)
UPDATE leads SET status = lead_stage WHERE status != lead_stage;

-- Step 4: Update temperature based on current lead_stage (auto-align)
UPDATE leads SET temperature = 'cold' WHERE lead_stage IN ('New', 'Contacted', 'Replied') AND status != 'Won';
UPDATE leads SET temperature = 'warm' WHERE lead_stage IN ('Interested', 'Qualified');
UPDATE leads SET temperature = 'hot' WHERE lead_stage IN ('Meeting', 'Proposal', 'Negotiation', 'Won');
UPDATE leads SET temperature = 'cold' WHERE lead_stage = 'Lost';

-- Step 5: Update lead_score based on current stage (auto-align)
UPDATE leads SET lead_score = 1 WHERE lead_stage IN ('New', 'Contacted', 'Lost');
UPDATE leads SET lead_score = 2 WHERE lead_stage = 'Replied';
UPDATE leads SET lead_score = 3 WHERE lead_stage IN ('Interested', 'Qualified');
UPDATE leads SET lead_score = 4 WHERE lead_stage IN ('Meeting', 'Proposal', 'Negotiation');
UPDATE leads SET lead_score = 5 WHERE lead_stage = 'Won';
