USE crm_task_module;

-- ============================================================
-- Lead Stages v2 - Simplified Pipeline (Single Source of Truth)
-- Merges 'status' and 'lead_stage' into one field: lead_stage
-- Old stages: Cold, Contacted, Replied, Interested, Qualified, Meeting Scheduled, Proposal Sent, Negotiation, Won, Lost
-- New stages: New, Contacted, Replied, Interested, Qualified, Meeting, Proposal, Negotiation, Won, Lost
-- ============================================================

-- Rename old stage values to new ones
UPDATE leads SET lead_stage = 'New' WHERE lead_stage = 'Cold';
UPDATE leads SET lead_stage = 'Meeting' WHERE lead_stage = 'Meeting Scheduled';
UPDATE leads SET lead_stage = 'Proposal' WHERE lead_stage = 'Proposal Sent';

-- Sync status column with lead_stage (lead_stage is now the single source of truth)
UPDATE leads SET status = lead_stage;

-- Update temperature based on current lead_stage (auto-align)
UPDATE leads SET temperature = 'cold' WHERE lead_stage IN ('New', 'Contacted', 'Replied');
UPDATE leads SET temperature = 'warm' WHERE lead_stage IN ('Interested', 'Qualified');
UPDATE leads SET temperature = 'hot' WHERE lead_stage IN ('Meeting', 'Proposal', 'Negotiation');

-- Update lead_score based on current stage (auto-align)
UPDATE leads SET lead_score = 1 WHERE lead_stage IN ('New', 'Contacted', 'Lost');
UPDATE leads SET lead_score = 2 WHERE lead_stage = 'Replied';
UPDATE leads SET lead_score = 3 WHERE lead_stage IN ('Interested', 'Qualified');
UPDATE leads SET lead_score = 4 WHERE lead_stage IN ('Meeting', 'Proposal', 'Negotiation');
UPDATE leads SET lead_score = 5 WHERE lead_stage = 'Won';
