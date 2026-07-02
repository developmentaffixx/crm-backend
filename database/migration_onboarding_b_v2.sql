-- ============================================================
-- Onboarding B v2 — New columns for split fields
-- SAFE: Only adds new columns, does not modify existing data
-- ============================================================

USE crm_task_module;

-- About the Business section: add years_in_industry
ALTER TABLE client_onboarding_b
  ADD COLUMN years_in_industry VARCHAR(50) DEFAULT NULL AFTER years_in_business;

-- Business Performance: split into separate fields
ALTER TABLE client_onboarding_b
  ADD COLUMN daily_sales VARCHAR(100) DEFAULT NULL AFTER current_business_performance,
  ADD COLUMN monthly_sales VARCHAR(100) DEFAULT NULL AFTER daily_sales,
  ADD COLUMN daily_walkin VARCHAR(100) DEFAULT NULL AFTER monthly_sales,
  ADD COLUMN avg_customer VARCHAR(100) DEFAULT NULL AFTER daily_walkin;

-- Key Offers / USPs: split into two
ALTER TABLE client_onboarding_b
  ADD COLUMN key_offers TEXT DEFAULT NULL AFTER key_offers_usps,
  ADD COLUMN business_usps TEXT DEFAULT NULL AFTER key_offers;

-- Social Media Credentials: conditional fields
ALTER TABLE client_onboarding_b
  ADD COLUMN social_existing_id VARCHAR(255) DEFAULT NULL AFTER social_media_credentials,
  ADD COLUMN social_existing_password VARCHAR(255) DEFAULT NULL AFTER social_existing_id,
  ADD COLUMN social_new_email VARCHAR(255) DEFAULT NULL AFTER social_existing_password,
  ADD COLUMN social_new_phone VARCHAR(50) DEFAULT NULL AFTER social_new_email;

-- Digital Promotion Goals: split into months
ALTER TABLE client_onboarding_b
  ADD COLUMN goal_month_1 TEXT DEFAULT NULL AFTER digital_promotion_goals,
  ADD COLUMN goal_month_2 TEXT DEFAULT NULL AFTER goal_month_1,
  ADD COLUMN goal_month_3 TEXT DEFAULT NULL AFTER goal_month_2;

-- Brand Guidelines: yes/no + text
ALTER TABLE client_onboarding_b
  ADD COLUMN brand_guidelines_exists ENUM('yes','no') DEFAULT 'no' AFTER brand_guidelines,
  ADD COLUMN brand_guidelines_text TEXT DEFAULT NULL AFTER brand_guidelines_exists;

-- Business Assets: toggles for each type
ALTER TABLE client_onboarding_b
  ADD COLUMN asset_logo TINYINT(1) DEFAULT 0 AFTER brand_guidelines_text,
  ADD COLUMN asset_photos_videos TINYINT(1) DEFAULT 0 AFTER asset_logo,
  ADD COLUMN asset_flyers TINYINT(1) DEFAULT 0 AFTER asset_photos_videos,
  ADD COLUMN asset_brochures TINYINT(1) DEFAULT 0 AFTER asset_flyers;
