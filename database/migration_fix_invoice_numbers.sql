-- Fix existing invoice numbers to use bill_date YYMM and global FY sequence
-- Run this ONCE to correct the 4 existing invoices

-- 1st invoice in FY 2026-27: Sachin, bill_date 09-04-2026
UPDATE invoices SET invoice_number = 'INV-2604-AFXCL001-001' WHERE invoice_number = 'INV-2606-AFXCL001-001';

-- 2nd invoice in FY 2026-27: vidjealatchoum balu, bill_date 27-04-2026
UPDATE invoices SET invoice_number = 'INV-2604-AFXCL002-002' WHERE invoice_number = 'INV-2606-AFXCL002-001';

-- 3rd invoice in FY 2026-27: Vivek, bill_date 30-04-2026
UPDATE invoices SET invoice_number = 'INV-2604-AFXCL004-003' WHERE invoice_number = 'INV-2606-AFXCL004-001';

-- 4th invoice in FY 2026-27: Swathiga Murugan, bill_date 30-04-2026
UPDATE invoices SET invoice_number = 'INV-2604-AFXCL003-004' WHERE invoice_number = 'INV-2606-AFXCL003-001';
