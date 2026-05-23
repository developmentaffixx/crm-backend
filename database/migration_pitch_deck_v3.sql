-- ============================================================
-- Pitch Deck V3 - New slide types & template-driven structure
-- ============================================================

USE crm_task_module;

-- ------------------------------------------------------------
-- Safe ADD COLUMN helper (skips if column already exists)
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS safe_add_column;
DELIMITER //
CREATE PROCEDURE safe_add_column(IN tbl VARCHAR(64), IN col VARCHAR(64), IN col_def VARCHAR(500))
BEGIN
  SET @exists = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = tbl AND COLUMN_NAME = col);
  IF @exists = 0 THEN
    SET @sql = CONCAT('ALTER TABLE ', tbl, ' ADD COLUMN ', col, ' ', col_def);
    PREPARE stmt FROM @sql;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END //
DELIMITER ;

-- ------------------------------------------------------------
-- Add slide_config JSON to industries (defines which slides appear)
-- ------------------------------------------------------------
CALL safe_add_column('pitch_deck_industries', 'slide_config', 'JSON NULL AFTER img_thanks');

-- ------------------------------------------------------------
-- New columns on pitch_decks for additional slide data
-- ------------------------------------------------------------
CALL safe_add_column('pitch_decks', 'opportunity_intro', 'TEXT NULL AFTER company_logo_url');
CALL safe_add_column('pitch_decks', 'opportunity_stats', 'JSON NULL AFTER opportunity_intro');
CALL safe_add_column('pitch_decks', 'service_features_data', 'JSON NULL AFTER opportunity_stats');
CALL safe_add_column('pitch_decks', 'ad_investment', 'JSON NULL AFTER service_features_data');
CALL safe_add_column('pitch_decks', 'investment_summary', 'JSON NULL AFTER ad_investment');
CALL safe_add_column('pitch_decks', 'why_us', 'JSON NULL AFTER investment_summary');
CALL safe_add_column('pitch_decks', 'cta_title', 'VARCHAR(255) NULL AFTER why_us');
CALL safe_add_column('pitch_decks', 'cta_subtitle', 'TEXT NULL AFTER cta_title');
CALL safe_add_column('pitch_decks', 'cta_steps', 'JSON NULL AFTER cta_subtitle');

-- ------------------------------------------------------------
-- Add default content columns to industries (pre-fill for forms)
-- ------------------------------------------------------------
CALL safe_add_column('pitch_deck_industries', 'default_service_features', 'JSON NULL AFTER slide_config');
CALL safe_add_column('pitch_deck_industries', 'default_why_us', 'JSON NULL AFTER default_service_features');
CALL safe_add_column('pitch_deck_industries', 'default_opportunity_stats', 'JSON NULL AFTER default_why_us');
CALL safe_add_column('pitch_deck_industries', 'default_opportunity_intro', 'TEXT NULL AFTER default_opportunity_stats');

-- ------------------------------------------------------------
-- Pitch Deck Custom Slides (for "What We Deliver" / services detail)
-- Each service can have bullet features shown in the deck
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pitch_deck_service_features (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  pitch_deck_id INT UNSIGNED NOT NULL,
  service_id    INT UNSIGNED NOT NULL,
  features      JSON NOT NULL,
  sort_order    INT NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_pdsf_deck FOREIGN KEY (pitch_deck_id) REFERENCES pitch_decks(id) ON DELETE CASCADE,
  CONSTRAINT fk_pdsf_service FOREIGN KEY (service_id) REFERENCES services(id),
  UNIQUE KEY uq_deck_svc_feat (pitch_deck_id, service_id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Update ALL industries with the SAME slide_config
-- (same steps for all, only background image differs)
-- ------------------------------------------------------------
UPDATE pitch_deck_industries SET slide_config = JSON_ARRAY(
  JSON_OBJECT('type', 'company', 'enabled', true, 'label', 'Title Slide'),
  JSON_OBJECT('type', 'opportunity', 'enabled', true, 'label', 'Your Opportunity'),
  JSON_OBJECT('type', 'services_detail', 'enabled', true, 'label', 'What We Deliver'),
  JSON_OBJECT('type', 'ad_investment', 'enabled', true, 'label', 'Ad Investment'),
  JSON_OBJECT('type', 'investment_summary', 'enabled', true, 'label', 'Investment Summary'),
  JSON_OBJECT('type', 'why_us', 'enabled', true, 'label', 'Why Partner With Us'),
  JSON_OBJECT('type', 'thanks', 'enabled', true, 'label', 'CTA / Lets Grow')
);


-- ============================================================
-- Default content for industries (pre-fills the form)
-- Same structure for all, only text differs per industry
-- ============================================================

-- Default template
UPDATE pitch_deck_industries SET
  default_service_features = JSON_ARRAY(
    JSON_OBJECT('name', 'Social Media Management', 'icon', '📱', 'features', JSON_ARRAY('Instagram & Facebook', 'Content Posting & Scheduling', 'Story Management', 'Engagement Handling')),
    JSON_OBJECT('name', 'Content Writing', 'icon', '✍️', 'features', JSON_ARRAY('12 Monthly Copies', 'Caption & CTA Writing', 'Hook Writing', 'Content Planning')),
    JSON_OBJECT('name', 'Ads Management', 'icon', '📊', 'features', JSON_ARRAY('Meta Lead Gen Ads', 'Audience Targeting', 'Retargeting Campaigns', 'Daily Optimization')),
    JSON_OBJECT('name', 'Video Editing', 'icon', '🎬', 'features', JSON_ARRAY('Reel Editing', 'Trend-Based Structure', 'Motion Graphics', 'Transitions'))
  ),
  default_why_us = JSON_ARRAY(
    JSON_OBJECT('title', 'Niche Focus', 'description', 'We specialize in your industry — we know your audience, language, and buying triggers.'),
    JSON_OBJECT('title', 'Full-Stack Execution', 'description', 'One team handles your content, ads, editing, and analytics. No coordination chaos.'),
    JSON_OBJECT('title', 'Performance First', 'description', 'Every rupee tracked. Weekly reports. Daily ad monitoring. No guesswork.'),
    JSON_OBJECT('title', 'Local Market Expertise', 'description', 'We understand your market dynamics and customer behaviour patterns.'),
    JSON_OBJECT('title', 'Dedicated Account Manager', 'description', 'You get a single point of contact, not a ticket queue.'),
    JSON_OBJECT('title', 'Transparent Pricing', 'description', 'No hidden costs. Clear deliverables. What you see is what you pay for.')
  ),
  default_opportunity_intro = 'Your market is growing — but most businesses are invisible online.',
  default_opportunity_stats = JSON_ARRAY(
    JSON_OBJECT('value', '70%', 'label', 'of customers discover businesses via social media'),
    JSON_OBJECT('value', '5x', 'label', 'more inquiries from businesses with active social presence'),
    JSON_OBJECT('value', '₹0', 'label', 'cost per organic reach with the right content strategy')
  )
WHERE slug = 'default';

-- D2C Clothing defaults
UPDATE pitch_deck_industries SET
  default_service_features = JSON_ARRAY(
    JSON_OBJECT('name', 'Social Media Management', 'icon', '📱', 'features', JSON_ARRAY('Instagram & Facebook', 'Content Posting & Scheduling', 'Story Management', 'Engagement Handling')),
    JSON_OBJECT('name', 'Content Writing', 'icon', '✍️', 'features', JSON_ARRAY('12 Monthly Copies', 'Caption & CTA Writing', 'Hook Writing', 'Content Planning')),
    JSON_OBJECT('name', 'Ads Management', 'icon', '📊', 'features', JSON_ARRAY('Meta Lead Gen Ads', 'Audience Targeting', 'Retargeting Campaigns', 'Daily Optimization')),
    JSON_OBJECT('name', 'Video Editing', 'icon', '🎬', 'features', JSON_ARRAY('Reel Editing', 'Trend-Based Structure', 'Motion Graphics', 'Transitions'))
  ),
  default_why_us = JSON_ARRAY(
    JSON_OBJECT('title', 'Niche Focus', 'description', 'We work with fashion & lifestyle brands — we know your audience, language, and buying triggers.'),
    JSON_OBJECT('title', 'Full-Stack Execution', 'description', 'One team handles your content, ads, editing, and analytics. No coordination chaos.'),
    JSON_OBJECT('title', 'Performance First', 'description', 'Every rupee tracked. Weekly reports. Daily ad monitoring. No guesswork.'),
    JSON_OBJECT('title', 'Local Market Expertise', 'description', 'We understand your market dynamics and customer behaviour patterns.'),
    JSON_OBJECT('title', 'Dedicated Account Manager', 'description', 'You get a single point of contact, not a ticket queue.'),
    JSON_OBJECT('title', 'Transparent Pricing', 'description', 'No hidden costs. Clear deliverables. What you see is what you pay for.')
  ),
  default_opportunity_intro = 'The D2C fashion market is booming — but most brands struggle to stand out online.',
  default_opportunity_stats = JSON_ARRAY(
    JSON_OBJECT('value', '80%', 'label', 'of fashion buyers discover brands via Instagram & reels'),
    JSON_OBJECT('value', '3x', 'label', 'more conversions from brands with consistent content strategy'),
    JSON_OBJECT('value', '₹0', 'label', 'cost per organic reach with the right content approach')
  )
WHERE slug = 'd2c-clothing';

-- Education defaults
UPDATE pitch_deck_industries SET
  default_service_features = JSON_ARRAY(
    JSON_OBJECT('name', 'Social Media Management', 'icon', '📱', 'features', JSON_ARRAY('Instagram & Facebook', 'Content Posting & Scheduling', 'Story Management', 'Engagement Handling')),
    JSON_OBJECT('name', 'Content Writing', 'icon', '✍️', 'features', JSON_ARRAY('12 Monthly Copies', 'Caption & CTA Writing', 'Hook Writing', 'Content Planning')),
    JSON_OBJECT('name', 'Ads Management', 'icon', '📊', 'features', JSON_ARRAY('Meta Lead Gen Ads', 'Audience Targeting', 'Retargeting Campaigns', 'Daily Optimization')),
    JSON_OBJECT('name', 'Video Editing', 'icon', '🎬', 'features', JSON_ARRAY('Reel Editing', 'Trend-Based Structure', 'Motion Graphics', 'Transitions'))
  ),
  default_why_us = JSON_ARRAY(
    JSON_OBJECT('title', 'Niche Focus', 'description', 'We work with education & coaching brands — we know your audience, language, and buying triggers.'),
    JSON_OBJECT('title', 'Full-Stack Execution', 'description', 'One team handles your content, ads, editing, and analytics. No coordination chaos.'),
    JSON_OBJECT('title', 'Performance First', 'description', 'Every rupee tracked. Weekly reports. Daily ad monitoring. No guesswork.'),
    JSON_OBJECT('title', 'Local Market Expertise', 'description', 'We understand your market dynamics and student behaviour patterns.'),
    JSON_OBJECT('title', 'Dedicated Account Manager', 'description', 'You get a single point of contact, not a ticket queue.'),
    JSON_OBJECT('title', 'Transparent Pricing', 'description', 'No hidden costs. Clear deliverables. What you see is what you pay for.')
  ),
  default_opportunity_intro = 'The education market is growing — but most institutes are invisible online.',
  default_opportunity_stats = JSON_ARRAY(
    JSON_OBJECT('value', '73%', 'label', 'of students discover courses via Instagram'),
    JSON_OBJECT('value', '5x', 'label', 'more inquiries from academies with active social presence'),
    JSON_OBJECT('value', '₹0', 'label', 'cost per organic reach with the right content strategy')
  )
WHERE slug = 'education';

-- Real Estate defaults
UPDATE pitch_deck_industries SET
  default_service_features = JSON_ARRAY(
    JSON_OBJECT('name', 'Social Media Management', 'icon', '📱', 'features', JSON_ARRAY('Instagram & Facebook', 'Content Posting & Scheduling', 'Story Management', 'Engagement Handling')),
    JSON_OBJECT('name', 'Content Writing', 'icon', '✍️', 'features', JSON_ARRAY('Property Descriptions', 'Caption & CTA Writing', 'Blog Content', 'Email Campaigns')),
    JSON_OBJECT('name', 'Ads Management', 'icon', '📊', 'features', JSON_ARRAY('Meta Lead Gen Ads', 'Google Ads', 'Retargeting Campaigns', 'Daily Optimization')),
    JSON_OBJECT('name', 'Video & Design', 'icon', '🎬', 'features', JSON_ARRAY('Property Walkthroughs', 'Drone Footage Editing', 'Brochure Design', 'Motion Graphics'))
  ),
  default_why_us = JSON_ARRAY(
    JSON_OBJECT('title', 'Real Estate Expertise', 'description', 'We specialize in property marketing — we know what buyers search for.'),
    JSON_OBJECT('title', 'Full-Stack Execution', 'description', 'One team handles your content, ads, editing, and analytics. No coordination chaos.'),
    JSON_OBJECT('title', 'Performance First', 'description', 'Every rupee tracked. Weekly reports. Daily ad monitoring. No guesswork.'),
    JSON_OBJECT('title', 'Local Market Knowledge', 'description', 'We understand your local property market and buyer demographics.'),
    JSON_OBJECT('title', 'Dedicated Account Manager', 'description', 'You get a single point of contact, not a ticket queue.'),
    JSON_OBJECT('title', 'Transparent Pricing', 'description', 'No hidden costs. Clear deliverables. What you see is what you pay for.')
  ),
  default_opportunity_intro = 'The real estate market is competitive — buyers start their search online.',
  default_opportunity_stats = JSON_ARRAY(
    JSON_OBJECT('value', '90%', 'label', 'of home buyers start their search online'),
    JSON_OBJECT('value', '4x', 'label', 'more site visits from properties with video walkthroughs'),
    JSON_OBJECT('value', '₹0', 'label', 'cost per organic reach with the right content strategy')
  )
WHERE slug = 'real-estate';

-- Restaurant defaults
UPDATE pitch_deck_industries SET
  default_service_features = JSON_ARRAY(
    JSON_OBJECT('name', 'Social Media Management', 'icon', '📱', 'features', JSON_ARRAY('Instagram & Facebook', 'Content Posting & Scheduling', 'Story Management', 'Engagement Handling')),
    JSON_OBJECT('name', 'Content Writing', 'icon', '✍️', 'features', JSON_ARRAY('Menu Descriptions', 'Caption & CTA Writing', 'Food Blog Content', 'Offer Campaigns')),
    JSON_OBJECT('name', 'Ads Management', 'icon', '📊', 'features', JSON_ARRAY('Meta Local Ads', 'Google Maps Ads', 'Retargeting Campaigns', 'Daily Optimization')),
    JSON_OBJECT('name', 'Food Photography & Video', 'icon', '🎬', 'features', JSON_ARRAY('Reel Editing', 'Food Styling Shoots', 'Motion Graphics', 'Menu Design'))
  ),
  default_why_us = JSON_ARRAY(
    JSON_OBJECT('title', 'F&B Expertise', 'description', 'We work with restaurants & cafes — we know what makes foodies click.'),
    JSON_OBJECT('title', 'Full-Stack Execution', 'description', 'One team handles your content, ads, editing, and analytics. No coordination chaos.'),
    JSON_OBJECT('title', 'Performance First', 'description', 'Every rupee tracked. Weekly reports. Daily ad monitoring. No guesswork.'),
    JSON_OBJECT('title', 'Local Market Expertise', 'description', 'We understand your local food scene and customer behaviour.'),
    JSON_OBJECT('title', 'Dedicated Account Manager', 'description', 'You get a single point of contact, not a ticket queue.'),
    JSON_OBJECT('title', 'Transparent Pricing', 'description', 'No hidden costs. Clear deliverables. What you see is what you pay for.')
  ),
  default_opportunity_intro = 'The food industry is booming — but most restaurants rely only on walk-ins.',
  default_opportunity_stats = JSON_ARRAY(
    JSON_OBJECT('value', '65%', 'label', 'of diners check Instagram before visiting a restaurant'),
    JSON_OBJECT('value', '3x', 'label', 'more orders from restaurants with active social media'),
    JSON_OBJECT('value', '₹0', 'label', 'cost per organic reach with the right content strategy')
  )
WHERE slug = 'restaurant';


-- ============================================================
-- Clear old Unsplash image URLs for ALL industries (use local images)
-- ============================================================
UPDATE pitch_deck_industries SET
  img_hero = NULL, img_team = NULL, img_services = NULL,
  img_goals = NULL, img_plans = NULL, img_thanks = NULL;
