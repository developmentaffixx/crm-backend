USE crm_task_module;

-- ============================================================
-- Fix Client Codes: Remove Starvault from clients page, reassign AFXCL005 to Swagath boutique store
-- Also fix related invoices
-- Date: 2026-06-25
-- ============================================================

-- Step 1: Revert Starvault back to a lead (remove from clients page)
-- Change status from 'Won' back to 'Contacted' and remove client_code
UPDATE leads
SET status = 'Contacted', client_code = NULL, converted_at = NULL
WHERE client_code = 'AFXCL005' AND name = 'Starvault';

-- Step 2: Update Swagath boutique store from AFXCL006 to AFXCL005
UPDATE leads
SET client_code = 'AFXCL005'
WHERE client_code = 'AFXCL006' AND name = 'Swagath boutique store';

-- Step 3: Soft-delete Starvault's invoice (INV-2606-AFXCL005-005)
UPDATE invoices
SET deleted = 1
WHERE invoice_number = 'INV-2606-AFXCL005-005';

-- Step 4: Update Swagath boutique store's invoice number from AFXCL006 to AFXCL005
-- Also update lead_id to point to Swagath's lead record
UPDATE invoices
SET invoice_number = 'INV-2606-AFXCL005-005',
    lead_id = (SELECT id FROM leads WHERE name = 'Swagath boutique store' AND client_code = 'AFXCL005' LIMIT 1)
WHERE invoice_number = 'INV-2606-AFXCL006-006';
