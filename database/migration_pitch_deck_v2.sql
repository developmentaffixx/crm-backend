USE crm_task_module;

-- ============================================================
-- Pitch Decks v2 - Add pitch_deck_id column (PCH-CLIENT-###)
-- ============================================================

-- Add pitch_deck_id column
ALTER TABLE pitch_decks ADD COLUMN IF NOT EXISTS pitch_deck_id VARCHAR(30) DEFAULT NULL AFTER id;

-- Add unique index on pitch_deck_id
ALTER TABLE pitch_decks ADD UNIQUE INDEX uk_pitch_deck_id (pitch_deck_id);
