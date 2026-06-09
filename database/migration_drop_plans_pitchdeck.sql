-- ============================================================
-- Drop Plans & Pitch Deck tables (replaced by Proposals module)
-- Run this AFTER confirming Proposals is working correctly.
-- ============================================================

USE crm_task_module;

-- ------------------------------------------------------------
-- Drop Pitch Deck tables (in dependency order)
-- ------------------------------------------------------------

-- Drop pitch_deck_service_features (depends on pitch_decks, services)
DROP TABLE IF EXISTS pitch_deck_service_features;

-- Drop pitch_deck_plans (depends on pitch_decks, plans)
DROP TABLE IF EXISTS pitch_deck_plans;

-- Drop pitch_deck_goals (depends on pitch_decks)
DROP TABLE IF EXISTS pitch_deck_goals;

-- Drop pitch_deck_services (depends on pitch_decks, services)
DROP TABLE IF EXISTS pitch_deck_services;

-- Drop pitch_deck_problems (depends on pitch_decks)
DROP TABLE IF EXISTS pitch_deck_problems;

-- Drop pitch_decks (depends on leads, users, pitch_deck_industries)
DROP TABLE IF EXISTS pitch_decks;

-- Drop pitch_deck_industries
DROP TABLE IF EXISTS pitch_deck_industries;

-- ------------------------------------------------------------
-- Drop Plans & Services tables (in dependency order)
-- ------------------------------------------------------------

-- Drop plan_feature_values (depends on plans, service_features)
DROP TABLE IF EXISTS plan_feature_values;

-- Drop service_features (depends on services)
DROP TABLE IF EXISTS service_features;

-- Drop plan_features (depends on plans)
DROP TABLE IF EXISTS plan_features;

-- Drop plans (depends on services)
DROP TABLE IF EXISTS plans;

-- Drop services
DROP TABLE IF EXISTS services;
