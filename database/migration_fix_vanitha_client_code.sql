-- ============================================================
-- Fix Client Code for Vanitha (Aster International School)
-- Assigns AFXCL014 and updates any associated invoice
-- Date: 2026-09-16
-- ============================================================

-- Step 1: Assign AFXCL014 to Vanitha / Aster International School
UPDATE leads
SET client_code = 'AFXCL014',
    converted_at = COALESCE(converted_at, NOW())
WHERE (name LIKE '%Vanitha%' OR business_name LIKE '%Aster%')
  AND (client_code IS NULL OR client_code = '');

-- Step 2: Update any invoice created for this client from '-CLIENT-' to '-AFXCL014-'
UPDATE invoices
SET invoice_number = REPLACE(invoice_number, '-CLIENT-', '-AFXCL014-')
WHERE lead_id = (
    SELECT id FROM leads
    WHERE client_code = 'AFXCL014'
    LIMIT 1
  )
  AND invoice_number LIKE '%-CLIENT-%';

-- Step 3: Verify the changes
SELECT id, lead_id, client_code, name, business_name, status, lead_stage, converted_at
FROM leads
WHERE client_code = 'AFXCL014';

SELECT id, invoice_number, lead_id, total_amount, status
FROM invoices
WHERE lead_id = (SELECT id FROM leads WHERE client_code = 'AFXCL014' LIMIT 1);
