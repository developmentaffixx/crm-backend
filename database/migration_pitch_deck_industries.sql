-- ============================================================
-- Pitch Deck Industries - MySQL Schema
-- ============================================================

USE crm_task_module;

-- ------------------------------------------------------------
-- Industries table (master data for pitch deck templates)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pitch_deck_industries (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(100) NOT NULL,
  slug            VARCHAR(100) NOT NULL UNIQUE,
  description     VARCHAR(500),
  icon            VARCHAR(50),

  -- Theme colors for the generated deck
  primary_color   VARCHAR(7) NOT NULL DEFAULT '#1a1f4e',
  secondary_color VARCHAR(7) NOT NULL DEFAULT '#2b3580',
  accent_color    VARCHAR(7) NOT NULL DEFAULT '#93c5fd',
  light_bg        VARCHAR(7) NOT NULL DEFAULT '#f7f9fc',
  light_accent    VARCHAR(7) NOT NULL DEFAULT '#4f46e5',

  is_default      TINYINT(1) NOT NULL DEFAULT 0,
  is_active       TINYINT(1) NOT NULL DEFAULT 1,
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ------------------------------------------------------------
-- Seed default industries
-- ------------------------------------------------------------
INSERT INTO pitch_deck_industries (name, slug, description, icon, primary_color, secondary_color, accent_color, light_bg, light_accent, is_default, sort_order) VALUES
('Default', 'default', 'Generic pitch deck template', '📊', '#1a1f4e', '#2b3580', '#93c5fd', '#f7f9fc', '#4f46e5', 1, 0),
('D2C Clothing', 'd2c-clothing', 'Direct-to-consumer fashion and apparel brands', '👗', '#1a1a2e', '#16213e', '#e94560', '#fef2f2', '#e11d48', 0, 1),
('Education', 'education', 'Schools, EdTech, coaching and training institutes', '🎓', '#0f3460', '#16213e', '#53d8fb', '#f0fdfa', '#0d9488', 0, 2),
('Real Estate', 'real-estate', 'Property developers, brokers and real estate firms', '🏢', '#1b2838', '#2d4059', '#f0a500', '#fffbeb', '#d97706', 0, 3),
('Restaurant', 'restaurant', 'Restaurants, cafes, cloud kitchens and food brands', '🍽️', '#2d132c', '#801336', '#ee4540', '#fff1f2', '#be123c', 0, 4);

-- ------------------------------------------------------------
-- Add industry_id column to pitch_decks table
-- ------------------------------------------------------------
ALTER TABLE pitch_decks
  ADD COLUMN industry_id INT UNSIGNED NULL AFTER lead_id,
  ADD CONSTRAINT fk_pitchdeck_industry FOREIGN KEY (industry_id) REFERENCES pitch_deck_industries(id);
