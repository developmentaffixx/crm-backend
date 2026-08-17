USE crm_task_module;

-- ─── Content Protection settings ──────────────────────────────────────────────
-- Adds toggle columns to company_settings for screenshot/screen recording prevention,
-- watermarking, and sensitive data protection.

ALTER TABLE company_settings
  ADD COLUMN IF NOT EXISTS content_protection_enabled    TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cp_screenshot_block          TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS cp_screen_record_block       TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS cp_watermark_enabled         TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS cp_watermark_opacity         TINYINT UNSIGNED NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS cp_sensitive_data_hover      TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cp_right_click_block         TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS cp_devtools_block            TINYINT(1) NOT NULL DEFAULT 0;
