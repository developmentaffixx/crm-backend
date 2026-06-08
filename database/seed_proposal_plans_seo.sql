-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: SEO Plans for Proposal Module
-- Run AFTER migration_proposal_plans.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Create the SEO service
INSERT INTO proposal_services (id, name, icon, created_by) VALUES (1, 'SEO', '🌐', 1)
ON DUPLICATE KEY UPDATE name = 'SEO';

-- 2. Create plan columns
INSERT INTO proposal_service_plans (id, service_id, name, subtitle, sort_order) VALUES
(1, 1, 'Starter SEO', NULL, 0),
(2, 1, 'Growth SEO', NULL, 1),
(3, 1, 'Scale SEO', NULL, 2)
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- 3. Create feature rows
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

-- 4. Insert feature × plan values
INSERT INTO proposal_plan_values (feature_id, plan_id, value) VALUES
-- Starter SEO (plan_id = 1)
(1,  1, 'New / small websites'),
(2,  1, 'Visibility & foundation'),
(3,  1, 'Basic keywords'),
(4,  1, 'Basic'),
(5,  1, 'Limited'),
(6,  1, 'Core issues'),
(7,  1, '✅'),
(8,  1, 'Basic'),
(9,  1, '3–4 pages'),
(10, 1, 'Basic structure'),
(11, 1, 'Limited'),
(12, 1, '1–2 / month'),
(13, 1, '❌'),
(14, 1, '❌'),
(15, 1, '❌'),
(16, 1, '❌'),
(17, 1, 'Basic setup'),
(18, 1, 'Monthly'),
(19, 1, 'Basic report'),
(20, 1, '❌'),
(21, 1, '4–6 months'),

-- Growth SEO (plan_id = 2)
(1,  2, 'Growing businesses'),
(2,  2, 'Rankings & leads'),
(3,  2, 'Advanced + long-tail'),
(4,  2, 'Detailed'),
(5,  2, 'Full roadmap'),
(6,  2, 'Deep optimization'),
(7,  2, '✅'),
(8,  2, 'Advanced'),
(9,  2, '6–8 pages'),
(10, 2, 'Strategic linking'),
(11, 2, 'Regular'),
(12, 2, '3–4 / month'),
(13, 2, '✅'),
(14, 2, 'Basic'),
(15, 2, 'Limited quality links'),
(16, 2, 'Limited'),
(17, 2, 'Optimization'),
(18, 2, 'Monthly + insights'),
(19, 2, 'Detailed report'),
(20, 2, '✅'),
(21, 2, '3–5 months'),

-- Scale SEO (plan_id = 3)
(1,  3, 'Competitive industries'),
(2,  3, 'Authority & dominance'),
(3,  3, 'Full keyword universe'),
(4,  3, 'Aggressive & ongoing'),
(5,  3, 'Advanced + expansion'),
(6,  3, 'Continuous improvement'),
(7,  3, '✅'),
(8,  3, 'Ongoing tuning'),
(9,  3, '10–15 pages'),
(10, 3, 'Authority sculpting'),
(11, 3, 'Aggressive'),
(12, 3, '5–8 / month'),
(13, 3, 'Advanced'),
(14, 3, 'Advanced'),
(15, 3, 'Strong & consistent'),
(16, 3, 'Ongoing'),
(17, 3, 'Multi-location / strong'),
(18, 3, 'Advanced tracking'),
(19, 3, 'Strategy-level report'),
(20, 3, 'Advanced'),
(21, 3, '2–4 months')
ON DUPLICATE KEY UPDATE value = VALUES(value);
