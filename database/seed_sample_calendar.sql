USE crm_task_module;

-- ============================================================
-- SAMPLE CONTENT CALENDAR DATA - Affixx Media (August 2026)
-- Client: AFXCL007 / Ramachandirane / Affixx Media
-- Project ID: 1 (ACC-260601-001)
-- Client ID (leads): 106
-- Created by: 1 (admin)
--
-- RUN THIS TO SEED → then run cleanup_sample_calendar.sql to remove
-- ============================================================

-- ─── 1. Create the Monthly Plan ──────────────────────────────────────────────

INSERT INTO content_calendar_plans 
  (client_id, project_id, plan_month, primary_goal, target_audience, budget_allocation, hero_offer, status, shared_with_client, shared_at, shared_by, created_by)
VALUES
  (106, 1, '2026-08-01', 
   'Increase brand awareness & generate leads through consistent social media presence',
   'Small business owners, startup founders, entrepreneurs aged 25-45 in Tamil Nadu',
   'Organic: 60% | Paid Ads: 40%',
   'Free Social Media Audit + 1 Month Strategy Session',
   'active', 1, NOW(), 1, 1);

SET @plan_id = LAST_INSERT_ID();

-- ─── 2. Content Posts (mix of platforms & formats) ────────────────────────────

INSERT INTO content_calendar_posts 
  (plan_id, post_no, platform, format, topic, ad_target, posting_date, cta, status, slot_status)
VALUES
  -- Week 1 (Aug 1-7)
  (@plan_id, 'P-001', 'Instagram', 'reel', 'Why Your Business Needs a Social Media Strategy in 2026', 'organic', '2026-08-01', 'DM us "STRATEGY" for a free consultation', 'planned', 'open'),
  (@plan_id, 'P-002', 'Instagram', 'carousel', '5 Common Branding Mistakes Small Businesses Make', 'organic', '2026-08-02', 'Save this for later! Follow @affixxmedia', 'planned', 'open'),
  (@plan_id, 'P-003', 'Facebook', 'static_post', 'Client Testimonial - Success Story Spotlight', 'organic', '2026-08-03', 'Want similar results? Link in bio', 'planned', 'open'),
  (@plan_id, 'P-004', 'LinkedIn', 'blog_article', 'The ROI of Consistent Content Marketing for SMBs', 'organic', '2026-08-04', 'Read full article → link in comments', 'in_progress', 'assigned'),
  (@plan_id, 'P-005', 'Instagram', 'story', 'Behind the Scenes - Team Working on Client Projects', 'organic', '2026-08-05', 'Tap to see more', 'planned', 'open'),

  -- Week 2 (Aug 8-14)
  (@plan_id, 'P-006', 'Instagram', 'reel', 'Before vs After - Brand Transformation Case Study', 'paid', '2026-08-08', 'Book your free brand audit today', 'planned', 'open'),
  (@plan_id, 'P-007', 'Instagram', 'carousel', '7 Instagram Trends You Must Follow This Quarter', 'organic', '2026-08-09', 'Which trend are you trying? Comment below!', 'planned', 'open'),
  (@plan_id, 'P-008', 'Facebook', 'static_post', 'Motivational Monday - Entrepreneur Quote Series', 'organic', '2026-08-10', 'Tag someone who needs this!', 'done', 'approved'),
  (@plan_id, 'P-009', 'Instagram', 'reel', 'How We Plan a 30-Day Content Calendar (BTS Process)', 'organic', '2026-08-11', 'Follow for more marketing tips', 'planned', 'open'),
  (@plan_id, 'P-010', 'LinkedIn', 'static_post', 'Digital Marketing Stats 2026 - Infographic', 'organic', '2026-08-12', 'Share with your network', 'planned', 'open'),

  -- Week 3 (Aug 15-21)
  (@plan_id, 'P-011', 'Instagram', 'carousel', 'Affixx Media Services Breakdown - What We Offer', 'paid', '2026-08-15', 'DM "INFO" to learn more', 'planned', 'open'),
  (@plan_id, 'P-012', 'Instagram', 'reel', 'Independence Day Special - Proud Indian Brands We Admire', 'organic', '2026-08-15', 'Happy Independence Day! 🇮🇳', 'planned', 'open'),
  (@plan_id, 'P-013', 'Facebook', 'static_post', 'Poll: What Content Do You Enjoy Most from Us?', 'organic', '2026-08-17', 'Vote in the comments!', 'planned', 'open'),
  (@plan_id, 'P-014', 'Instagram', 'story', 'Quick Tips: 3 Canva Hacks for Better Visuals', 'organic', '2026-08-18', 'Swipe up for tutorial', 'planned', 'open'),
  (@plan_id, 'P-015', 'Instagram', 'reel', 'Client Onboarding Process - What to Expect', 'organic', '2026-08-20', 'Ready to grow? DM us today', 'in_progress', 'assigned'),

  -- Week 4 (Aug 22-28)
  (@plan_id, 'P-016', 'Instagram', 'carousel', 'Monthly Results Recap - July Performance Highlights', 'organic', '2026-08-22', 'Want these results? Let us talk', 'planned', 'open'),
  (@plan_id, 'P-017', 'LinkedIn', 'blog_article', 'How to Choose the Right Digital Marketing Agency', 'organic', '2026-08-23', 'Full guide in the article', 'planned', 'open'),
  (@plan_id, 'P-018', 'Instagram', 'reel', 'Day in the Life at Affixx Media Office', 'organic', '2026-08-25', 'Follow for more BTS content', 'planned', 'open'),
  (@plan_id, 'P-019', 'Facebook', 'static_post', 'Weekend Wisdom - Content Planning Tips', 'organic', '2026-08-26', 'Save this post!', 'planned', 'open'),
  (@plan_id, 'P-020', 'Instagram', 'carousel', 'August Wrap-up + September Sneak Peek', 'organic', '2026-08-28', 'Stay tuned for exciting updates!', 'planned', 'open');

-- ─── 3. Shoots (2 planned shoots for the month) ──────────────────────────────

INSERT INTO content_calendar_shoots
  (plan_id, shoot_date, location, description, num_videos, num_photos, talent, production_notes, status, slot_status)
VALUES
  (@plan_id, '2026-08-06', 'Affixx Media Office, Chennai', 'Team BTS shoot + founder interview for brand storytelling reels', 5, 20, 'Ramachandirane (Founder)', 'Need ring light, lapel mic, tripod. Plan 3 outfit changes. Shoot both vertical (reels) and horizontal (YouTube).', 'planned', 'open'),
  (@plan_id, '2026-08-19', 'Client Location - TBD', 'Client testimonial video + product photography for case study carousel', 3, 15, 'Client representative', 'Coordinate with client 2 days before. Bring portable backdrop. Script testimonial questions in advance.', 'planned', 'open');

-- ─── 4. Ads (3 campaigns planned) ────────────────────────────────────────────

INSERT INTO content_calendar_ads
  (plan_id, ad_no, creative_name, campaign_objective, platform, ad_status, target_audience, budget, start_date, end_date, expected_outcomes, slot_status)
VALUES
  (@plan_id, 'AD-901', 'Brand Awareness - Affixx Intro Reel', 'brand_awareness', 'Instagram', 'planned', 'Business owners in Chennai, Madurai, Coimbatore | Age 25-45 | Interests: Entrepreneurship, Marketing', '₹5,000', '2026-08-01', '2026-08-10', 'Reach: 50,000+ | Profile visits: 2,000+ | New followers: 200+', 'open'),
  (@plan_id, 'AD-902', 'Lead Gen - Free Audit Offer', 'lead_generation', 'Facebook', 'planned', 'SMB owners in Tamil Nadu | Age 28-50 | Interests: Business growth, Digital marketing', '₹8,000', '2026-08-11', '2026-08-25', 'Leads: 50+ | Cost per lead: ₹160 | Booked calls: 15+', 'open'),
  (@plan_id, 'AD-903', 'Traffic - Blog Article Boost', 'traffic', 'LinkedIn', 'planned', 'Startup founders, Marketing managers | Age 25-40 | India', '₹3,000', '2026-08-15', '2026-08-22', 'Link clicks: 500+ | CPC: ₹6 | Article reads: 300+', 'open');

-- ─── Done! ────────────────────────────────────────────────────────────────────
-- Plan ID stored in @plan_id variable
-- To verify: SELECT * FROM content_calendar_plans WHERE id = @plan_id;
-- Posts:  SELECT * FROM content_calendar_posts WHERE plan_id = @plan_id;
-- Shoots: SELECT * FROM content_calendar_shoots WHERE plan_id = @plan_id;
-- Ads:    SELECT * FROM content_calendar_ads WHERE plan_id = @plan_id;
