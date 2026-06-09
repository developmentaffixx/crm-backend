-- ============================================================
-- Drop Plans & Pitch Deck tables (replaced by Proposals module)
-- Keeps: pitch_deck_industries (still needed)
-- ============================================================

USE crm_task_module;

-- Disable foreign key checks to avoid constraint errors during drop
SET FOREIGN_KEY_CHECKS = 0;

-- Pitch Deck tables (keeping pitch_deck_industries)
DROP TABLE IF EXISTS pitch_deck_service_features;
DROP TABLE IF EXISTS pitch_deck_plans;
DROP TABLE IF EXISTS pitch_deck_goals;
DROP TABLE IF EXISTS pitch_deck_services;
DROP TABLE IF EXISTS pitch_deck_problems;
DROP TABLE IF EXISTS pitch_decks;

-- Plans & Services tables
DROP TABLE IF EXISTS plan_feature_values;
DROP TABLE IF EXISTS service_features;
DROP TABLE IF EXISTS plan_features;
DROP TABLE IF EXISTS plans;
DROP TABLE IF EXISTS services;

-- Re-enable foreign key checks
SET FOREIGN_KEY_CHECKS = 1;
