-- ============================================================
-- Fix Invoice Numbers with missing client codes:
-- Replace '-CLIENT-' with the respective client code:
-- 1. Scholar Spectra NEET JEE Coaching Center (AFXCL012):
--    INV-2609-CLIENT-016 -> INV-2609-AFXCL012-016
-- 2. Shivakumar Govindasamy (AFXCL013):
--    INV-2607-CLIENT-007 -> INV-2607-AFXCL013-007
-- ============================================================

-- 1. Update invoice for Scholar Spectra NEET JEE Coaching Center
UPDATE invoices 
SET invoice_number = 'INV-2609-AFXCL012-016' 
WHERE invoice_number = 'INV-2609-CLIENT-016';

-- 2. Update invoice for Shivakumar Govindasamy
UPDATE invoices 
SET invoice_number = 'INV-2607-AFXCL013-007' 
WHERE invoice_number = 'INV-2607-CLIENT-007';

-- Verification query
SELECT id, invoice_number, lead_id, bill_date, total_amount, status 
FROM invoices 
WHERE invoice_number IN ('INV-2609-AFXCL012-016', 'INV-2607-AFXCL013-007');
