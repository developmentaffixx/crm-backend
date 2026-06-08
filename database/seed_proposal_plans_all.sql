-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: ALL Proposal Plans (SEO, Social Media, Personal Branding, Performance, Influencer)
-- Run AFTER migration_proposal_plans.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════════
-- SERVICE 1: SEO
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO proposal_services (id, name, icon, created_by) VALUES (1, 'SEO', '🌐', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO proposal_service_plans (id, service_id, name, subtitle, sort_order) VALUES
(1, 1, 'Starter SEO', NULL, 0),
(2, 1, 'Growth SEO', NULL, 1),
(3, 1, 'Scale SEO', NULL, 2)
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO proposal_service_features (id, service_id, name, sort_order) VALUES
(1,  1, 'Best For', 0),
(2,  1, 'Primary Goal', 1),
(3,  1, 'Keyword Research & Intent Mapping', 2),
(4,  1, 'Competitor Analysis', 3),
(5,  1, 'SEO Roadmap & Priority Pages', 4),
(6,  1, 'Technical SEO (Audit & Fixes)', 5),
(7,  1, 'Indexing & Crawl Optimization', 6),
(8,  1, 'Page Speed & Mobile SEO', 7),
(9,  1, 'On-Page SEO (Pages Optimized / Month)', 8),
(10, 1, 'Internal Linking', 9),
(11, 1, 'Content Optimization (Existing Pages)', 10),
(12, 1, 'New SEO Content Creation', 11),
(13, 1, 'FAQ / AEO Optimization', 12),
(14, 1, 'Schema / Rich Results', 13),
(15, 1, 'Backlink / Authority Building', 14),
(16, 1, 'Brand Mentions & Citations', 15),
(17, 1, 'Local SEO (if applicable)', 16),
(18, 1, 'Keyword & Traffic Tracking', 17),
(19, 1, 'SEO Reporting', 18),
(20, 1, 'Monthly Strategy Refinement', 19),
(21, 1, 'Expected Results Timeline', 20)
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO proposal_plan_values (feature_id, plan_id, value) VALUES
(1,1,'New / small websites'),(2,1,'Visibility & foundation'),(3,1,'Basic keywords'),(4,1,'Basic'),(5,1,'Limited'),(6,1,'Core issues'),(7,1,'✅'),(8,1,'Basic'),(9,1,'3–4 pages'),(10,1,'Basic structure'),(11,1,'Limited'),(12,1,'1–2 / month'),(13,1,'❌'),(14,1,'❌'),(15,1,'❌'),(16,1,'❌'),(17,1,'Basic setup'),(18,1,'Monthly'),(19,1,'Basic report'),(20,1,'❌'),(21,1,'4–6 months'),
(1,2,'Growing businesses'),(2,2,'Rankings & leads'),(3,2,'Advanced + long-tail'),(4,2,'Detailed'),(5,2,'Full roadmap'),(6,2,'Deep optimization'),(7,2,'✅'),(8,2,'Advanced'),(9,2,'6–8 pages'),(10,2,'Strategic linking'),(11,2,'Regular'),(12,2,'3–4 / month'),(13,2,'✅'),(14,2,'Basic'),(15,2,'Limited quality links'),(16,2,'Limited'),(17,2,'Optimization'),(18,2,'Monthly + insights'),(19,2,'Detailed report'),(20,2,'✅'),(21,2,'3–5 months'),
(1,3,'Competitive industries'),(2,3,'Authority & dominance'),(3,3,'Full keyword universe'),(4,3,'Aggressive & ongoing'),(5,3,'Advanced + expansion'),(6,3,'Continuous improvement'),(7,3,'✅'),(8,3,'Ongoing tuning'),(9,3,'10–15 pages'),(10,3,'Authority sculpting'),(11,3,'Aggressive'),(12,3,'5–8 / month'),(13,3,'Advanced'),(14,3,'Advanced'),(15,3,'Strong & consistent'),(16,3,'Ongoing'),(17,3,'Multi-location / strong'),(18,3,'Advanced tracking'),(19,3,'Strategy-level report'),(20,3,'Advanced'),(21,3,'2–4 months')
ON DUPLICATE KEY UPDATE value = VALUES(value);


-- ═══════════════════════════════════════════════════════════════════════════════
-- SERVICE 2: SOCIAL MEDIA MARKETING
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO proposal_services (id, name, icon, created_by) VALUES (2, 'Social Media Marketing', '🌐', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO proposal_service_plans (id, service_id, name, subtitle, sort_order) VALUES
(4, 2, 'Basic', NULL, 0),
(5, 2, 'Growth', NULL, 1),
(6, 2, 'Premium', NULL, 2)
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO proposal_service_features (id, service_id, name, sort_order) VALUES
(22, 2, 'Platforms', 0),
(23, 2, 'Social Media Setup', 1),
(24, 2, 'Content Creation', 2),
(25, 2, 'Monthly Content Calendar', 3),
(26, 2, 'Total Creatives / Month', 4),
(27, 2, 'Reels', 5),
(28, 2, 'Posters (Static / Carousel)', 6),
(29, 2, 'Community Management', 7),
(30, 2, 'Monthly Insight Report', 8),
(31, 2, 'Funnel Strategy', 9),
(32, 2, 'Meta Ads Management', 10),
(33, 2, 'Ad Budget Included', 11),
(34, 2, 'Ad-Ready Creatives', 12),
(35, 2, 'Video & Photo Shoot', 13),
(36, 2, 'Marketing Advice & Guidance', 14),
(37, 2, 'Monthly Strategy Call', 15),
(38, 2, 'Creative Testing & Scaling', 16),
(39, 2, 'Growth Dashboard', 17),
(40, 2, 'Quarterly Growth Planning Session', 18),
(41, 2, 'Senior Strategy Access', 19),
(42, 2, 'Priority Support', 20)
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO proposal_plan_values (feature_id, plan_id, value) VALUES
-- Basic (plan_id = 4)
(22,4,'Facebook / Instagram / GMB'),(23,4,'Yes'),(24,4,'Yes'),(25,4,'Yes'),(26,4,'10'),(27,4,'Basic'),(28,4,'Yes'),(29,4,'Basic'),(30,4,'Basic'),(31,4,'No'),(32,4,'Yes'),(33,4,'No'),(34,4,'No'),(35,4,'No'),(36,4,'No'),(37,4,'No'),(38,4,'No'),(39,4,'No'),(40,4,'No'),(41,4,'No'),(42,4,'No'),
-- Growth (plan_id = 5)
(22,5,'Facebook / Instagram / GMB'),(23,5,'Yes'),(24,5,'Yes'),(25,5,'Yes'),(26,5,'15'),(27,5,'Storytelling'),(28,5,'Yes'),(29,5,'Standard'),(30,5,'Detailed'),(31,5,'Yes'),(32,5,'Yes'),(33,5,'Yes'),(34,5,'No'),(35,5,'1 Session / Month'),(36,5,'No'),(37,5,'No'),(38,5,'Limited'),(39,5,'No'),(40,5,'No'),(41,5,'No'),(42,5,'No'),
-- Premium (plan_id = 6)
(22,6,'Facebook / Instagram / GMB / YouTube'),(23,6,'Yes'),(24,6,'Yes'),(25,6,'Yes'),(26,6,'25'),(27,6,'Advanced & Trends'),(28,6,'Yes'),(29,6,'Priority'),(30,6,'Advanced'),(31,6,'Yes'),(32,6,'Yes'),(33,6,'Yes'),(34,6,'Yes'),(35,6,'Included'),(36,6,'Yes'),(37,6,'Yes'),(38,6,'Aggressive'),(39,6,'Yes'),(40,6,'Yes'),(41,6,'Yes'),(42,6,'Dedicated')
ON DUPLICATE KEY UPDATE value = VALUES(value);


-- ═══════════════════════════════════════════════════════════════════════════════
-- SERVICE 3: PERSONAL BRANDING
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO proposal_services (id, name, icon, created_by) VALUES (3, 'Personal Branding', '🌐', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO proposal_service_plans (id, service_id, name, subtitle, sort_order) VALUES
(7, 3, 'Plan A', NULL, 0),
(8, 3, 'Plan B', NULL, 1)
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO proposal_service_features (id, service_id, name, sort_order) VALUES
(43, 3, 'Platform Coverage', 0),
(44, 3, 'Personal Brand - Signature style', 1),
(45, 3, 'Content Themes', 2),
(46, 3, 'Profile Optimisation (Bio, Highlights, About)', 3),
(47, 3, 'Monthly Content Calendar', 4),
(48, 3, 'Total Creatives per Month', 5),
(49, 3, 'Instagram Reels Creation', 6),
(50, 3, 'Caption Writing & Hook Strategy', 7),
(51, 3, 'YouTube Shorts Creation', 8),
(52, 3, 'Community Management (Comments & DMs - A)', 9),
(53, 3, 'Audience Interaction Strategy', 10),
(54, 3, 'Video Shoot (Planned Sessions)', 11),
(55, 3, 'Content Repurposing', 12),
(56, 3, 'Creative Testing & Optimisation', 13),
(57, 3, 'Monthly Insight Report', 14),
(58, 3, 'Growth Dashboard', 15),
(59, 3, 'Monthly Strategy Call', 16),
(60, 3, 'Senior Strategy / Founder Access', 17),
(61, 3, 'Priority Support', 18)
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO proposal_plan_values (feature_id, plan_id, value) VALUES
-- Plan A (plan_id = 7)
(43,7,'Instagram'),(44,7,'Yes'),(45,7,'Yes'),(46,7,'Yes'),(47,7,'Yes'),(48,7,'15'),(49,7,'Yes'),(50,7,'Yes'),(51,7,'No'),(52,7,'Yes'),(53,7,'Yes'),(54,7,'Yes'),(55,7,'Yes'),(56,7,'Yes'),(57,7,'Yes'),(58,7,'No'),(59,7,'Yes'),(60,7,'No'),(61,7,'Yes'),
-- Plan B (plan_id = 8)
(43,8,'Instagram / YouTube'),(44,8,'Yes'),(45,8,'Yes'),(46,8,'Yes'),(47,8,'Yes'),(48,8,'20'),(49,8,'Yes'),(50,8,'Yes'),(51,8,'Yes'),(52,8,'Yes'),(53,8,'Yes'),(54,8,'Yes'),(55,8,'Yes'),(56,8,'Yes'),(57,8,'Yes'),(58,8,'Yes'),(59,8,'Yes'),(60,8,'Yes'),(61,8,'Yes')
ON DUPLICATE KEY UPDATE value = VALUES(value);


-- ═══════════════════════════════════════════════════════════════════════════════
-- SERVICE 4: PERFORMANCE MARKETING
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO proposal_services (id, name, icon, created_by) VALUES (4, 'Performance Marketing', '🌐', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO proposal_service_plans (id, service_id, name, subtitle, sort_order) VALUES
(9, 4, 'Performance Growth Plan', NULL, 0)
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO proposal_service_features (id, service_id, name, sort_order) VALUES
(62, 4, 'Business Goal & KPI', 0),
(63, 4, 'Ideal Ad Spend Requirement', 1),
(64, 4, 'Platforms Selection', 2),
(65, 4, 'Campaign Types', 3),
(66, 4, 'Funnel Strategy', 4),
(67, 4, 'Tracking & Measurement Setup', 5),
(68, 4, 'Creative Strategy & Planning', 6),
(69, 4, 'Creative Management', 7),
(70, 4, 'Campaign Execution', 8),
(71, 4, 'Optimization Frequency', 9),
(72, 4, 'Reporting & Insights', 10),
(73, 4, 'Growth Dashboard', 11),
(74, 4, 'Follow-up System', 12)
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO proposal_plan_values (feature_id, plan_id, value) VALUES
(62,9,'Cost per Lead / ROAS'),
(63,9,'Above ₹1,00,000 per month'),
(64,9,'Based on niche requirement'),
(65,9,'Search, Lead Gen, Conversion, Remarketing'),
(66,9,'Full Funnel (Cold → Warm → Hot)'),
(67,9,'Pixel, Conversion Tracking, Events'),
(68,9,'Ad copies, variations, messaging'),
(69,9,'8–12 Ads (Copies + Variations)'),
(70,9,'Ads launched across selected platforms'),
(71,9,'Daily performance optimization'),
(72,9,'Detailed'),
(73,9,'Account Provided'),
(74,9,'Dashboard Provided')
ON DUPLICATE KEY UPDATE value = VALUES(value);


-- ═══════════════════════════════════════════════════════════════════════════════
-- SERVICE 5: INFLUENCER MARKETING
-- ═══════════════════════════════════════════════════════════════════════════════

INSERT INTO proposal_services (id, name, icon, created_by) VALUES (5, 'Influencer Marketing', '🌐', 1)
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO proposal_service_plans (id, service_id, name, subtitle, sort_order) VALUES
(10, 5, 'Breakdown', NULL, 0)
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO proposal_service_features (id, service_id, name, sort_order) VALUES
(75, 5, 'Campaign Strategy', 0),
(76, 5, 'Influencer Selection', 1),
(77, 5, 'Authenticity Check', 2),
(78, 5, 'Negotiation & Coordination', 3),
(79, 5, 'Content Execution', 4),
(80, 5, 'Performance Tracking', 5),
(81, 5, 'Campaign Report', 6)
ON DUPLICATE KEY UPDATE name = VALUES(name);

INSERT INTO proposal_plan_values (feature_id, plan_id, value) VALUES
(75,10,'Decide goal: awareness / trust / sales'),
(76,10,'Choose relevant micro & mid influencers'),
(77,10,'Avoid fake followers & bots'),
(78,10,'Finalise cost, deliverables & timelines'),
(79,10,'Reels / posts go live as planned'),
(80,10,'Track reach, engagement, response'),
(81,10,'What worked & what didn''t')
ON DUPLICATE KEY UPDATE value = VALUES(value);
