-- Remove the sample_document template from document_templates table
-- Run this migration to clean up the sample document card from
-- Settings → HR Templates and People-Ops → Onboarding → Document Templates

DELETE FROM document_templates WHERE template_key = 'sample_document';
