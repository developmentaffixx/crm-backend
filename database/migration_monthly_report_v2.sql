-- Migration: New Monthly Report system (v2)
-- Matches actual slide-based report structure with multi-platform support

CREATE TABLE IF NOT EXISTS smm_monthly_reports (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  project_id      INT UNSIGNED NOT NULL,
  reporting_month VARCHAR(7) NOT NULL COMMENT 'YYYY-MM format',
  report_date     DATE DEFAULT NULL,
  platform        ENUM('instagram', 'facebook', 'linkedin', 'youtube', 'twitter') NOT NULL DEFAULT 'instagram',
  status          ENUM('draft', 'submitted', 'approved') NOT NULL DEFAULT 'draft',

  -- Step 2: Executive Summary
  executive_summary   TEXT DEFAULT NULL COMMENT 'Paragraph text overview of the month',

  -- Step 3: Content Overview (JSON array: [{type, planned, published}])
  content_overview    JSON DEFAULT NULL COMMENT '[{type:"Reels",planned:8,published:9},{type:"Poster",planned:4,published:5},{type:"Stories",planned:12,published:12},{type:"Carousels",planned:0,published:0}]',

  -- Step 4: Most Viewed Posts (JSON array of post objects)
  most_viewed_posts   JSON DEFAULT NULL COMMENT '[{image_url, views, reach, likes, comments, shares, reposts, saves, profile_activities, follower_pct, non_follower_pct, gender_male_pct, gender_female_pct, analysis}]',

  -- Step 5: Account Performance (JSON object)
  account_performance JSON DEFAULT NULL COMMENT '{views, accounts_reached, content_shared, profile_visits, interactions, new_followers, external_link_taps, prev_views, prev_accounts_reached, prev_content_shared, prev_profile_visits, prev_interactions, prev_new_followers, prev_external_link_taps}',

  -- Step 6: Meta Ads Campaigns (JSON array of campaign objects)
  ads_campaigns       JSON DEFAULT NULL COMMENT '[{name, total_spent, gst_amount, total_with_gst, messages, calls, enquiries, ad_breakdown:[{creative_name, result_count}]}]',

  -- Step 7: Most Performed Posts (JSON array: [{image_url, view_count}])
  most_performed_posts JSON DEFAULT NULL COMMENT '[{image_url, view_count}]',

  -- Step 8: Audience Demographics (JSON object)
  audience_demographics JSON DEFAULT NULL COMMENT '{cities:[{name,pct}], age_ranges:[{range,pct}], gender:{male_pct, female_pct}}',

  -- Step 9: Recommendations (JSON array of strings)
  recommendations     JSON DEFAULT NULL COMMENT '["recommendation 1","recommendation 2"]',

  -- Step 10: Conclusion
  conclusion          TEXT DEFAULT NULL COMMENT 'Summary paragraph',

  -- Meta
  created_by      INT UNSIGNED DEFAULT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_project_month_platform (project_id, reporting_month, platform),
  KEY idx_mpr_status (status),
  KEY idx_mpr_month (reporting_month),
  CONSTRAINT fk_mpr_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_mpr_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
