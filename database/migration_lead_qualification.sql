-- Lead Qualification Checklist table
CREATE TABLE IF NOT EXISTS lead_qualifications (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  lead_id INT UNSIGNED NOT NULL,

  -- Digital Presence Audit - Website
  website_status ENUM('no_website', 'available') DEFAULT NULL,
  website_condition JSON DEFAULT NULL, -- ["outdated","modern","mobile_friendly","lead_gen_friendly"]
  website_remarks TEXT DEFAULT NULL,

  -- Social Media Presence
  instagram_followers VARCHAR(50) DEFAULT NULL,
  facebook_available ENUM('yes', 'no') DEFAULT NULL,
  posting_consistency ENUM('active', 'moderate', 'poor', 'no_activity') DEFAULT NULL,
  content_quality ENUM('good', 'average', 'poor') DEFAULT NULL,
  social_media_remarks TEXT DEFAULT NULL,

  -- Google Business Profile
  google_profile_status ENUM('not_available', 'available', 'verified') DEFAULT NULL,
  google_reviews VARCHAR(50) DEFAULT NULL,
  google_average_rating DECIMAL(2,1) DEFAULT NULL,
  google_profile_remarks TEXT DEFAULT NULL,

  -- Decision Maker Qualification
  decision_maker_identified ENUM('yes', 'no') DEFAULT NULL,
  decision_maker_name VARCHAR(255) DEFAULT NULL,
  decision_maker_designation VARCHAR(255) DEFAULT NULL,
  authority_level ENUM('owner', 'founder', 'director', 'marketing_manager', 'manager', 'other') DEFAULT NULL,

  -- Budget Qualification
  budget_potential ENUM('low', 'medium', 'high') DEFAULT NULL,
  investment_readiness ENUM('ready_now', '1_3_months', '3_6_months', 'just_exploring') DEFAULT NULL,
  budget_remarks TEXT DEFAULT NULL,

  -- Interest Level
  lead_response ENUM('not_interested', 'slightly_interested', 'interested', 'very_interested', 'requested_meeting') DEFAULT NULL,
  interest_remarks TEXT DEFAULT NULL,

  -- Lead Temperature (synced back to leads table)
  lead_temperature ENUM('cold', 'warm', 'hot') DEFAULT NULL,
  temperature_reason TEXT DEFAULT NULL,

  -- Next Action
  next_action_type SET('follow_up_call','whatsapp_follow_up','send_company_profile','send_portfolio','book_meeting','proposal_required','no_action') DEFAULT NULL,
  follow_up_date DATE DEFAULT NULL,
  assigned_to INT UNSIGNED DEFAULT NULL,
  next_action_remarks TEXT DEFAULT NULL,

  -- BDE Final Assessment
  recommend_pursuing ENUM('yes', 'no') DEFAULT NULL,
  assessment_reason TEXT DEFAULT NULL,

  -- Meta
  filled_by INT UNSIGNED DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY unique_lead (lead_id),
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  FOREIGN KEY (filled_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
