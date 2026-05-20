-- ============================================================
-- Pitch Deck Industries V2 - Add layout variant & images
-- ============================================================

USE crm_task_module;

-- Add layout_variant and image columns
ALTER TABLE pitch_deck_industries
  ADD COLUMN layout_variant ENUM('default','lifestyle','academic','property','culinary') NOT NULL DEFAULT 'default' AFTER light_accent,
  ADD COLUMN img_hero VARCHAR(500) NULL AFTER layout_variant,
  ADD COLUMN img_team VARCHAR(500) NULL AFTER img_hero,
  ADD COLUMN img_services VARCHAR(500) NULL AFTER img_team,
  ADD COLUMN img_goals VARCHAR(500) NULL AFTER img_services,
  ADD COLUMN img_plans VARCHAR(500) NULL AFTER img_goals,
  ADD COLUMN img_thanks VARCHAR(500) NULL AFTER img_plans;

-- Update existing industries with layout variants and default Unsplash images
UPDATE pitch_deck_industries SET
  layout_variant = 'default',
  img_hero = 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=600&h=400&fit=crop&q=80',
  img_team = 'https://images.unsplash.com/photo-1552664730-d307ca884978?w=600&h=400&fit=crop&q=80',
  img_services = 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=600&h=400&fit=crop&q=80',
  img_goals = 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=600&h=400&fit=crop&q=80',
  img_plans = 'https://images.unsplash.com/photo-1552664730-d307ca884978?w=600&h=400&fit=crop&q=80',
  img_thanks = 'https://images.unsplash.com/photo-1521791136064-7986c2920216?w=600&h=400&fit=crop&q=80'
WHERE slug = 'default';

UPDATE pitch_deck_industries SET
  layout_variant = 'lifestyle',
  img_hero = 'https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=600&h=400&fit=crop&q=80',
  img_team = 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=600&h=400&fit=crop&q=80',
  img_services = 'https://images.unsplash.com/photo-1556905055-8f358a7a47b2?w=600&h=400&fit=crop&q=80',
  img_goals = 'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=600&h=400&fit=crop&q=80',
  img_plans = 'https://images.unsplash.com/photo-1445205170230-053b83016050?w=600&h=400&fit=crop&q=80',
  img_thanks = 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=600&h=400&fit=crop&q=80'
WHERE slug = 'd2c-clothing';

UPDATE pitch_deck_industries SET
  layout_variant = 'academic',
  img_hero = 'https://images.unsplash.com/photo-1523050854058-8df90110c9f1?w=600&h=400&fit=crop&q=80',
  img_team = 'https://images.unsplash.com/photo-1524178232363-1fb2b075b655?w=600&h=400&fit=crop&q=80',
  img_services = 'https://images.unsplash.com/photo-1501504905252-473c47e087f8?w=600&h=400&fit=crop&q=80',
  img_goals = 'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=600&h=400&fit=crop&q=80',
  img_plans = 'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=600&h=400&fit=crop&q=80',
  img_thanks = 'https://images.unsplash.com/photo-1427504494785-3a9ca7044f45?w=600&h=400&fit=crop&q=80'
WHERE slug = 'education';

UPDATE pitch_deck_industries SET
  layout_variant = 'property',
  img_hero = 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=600&h=400&fit=crop&q=80',
  img_team = 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=600&h=400&fit=crop&q=80',
  img_services = 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=600&h=400&fit=crop&q=80',
  img_goals = 'https://images.unsplash.com/photo-1582407947304-fd86f028f716?w=600&h=400&fit=crop&q=80',
  img_plans = 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=600&h=400&fit=crop&q=80',
  img_thanks = 'https://images.unsplash.com/photo-1560185127-6ed189bf02f4?w=600&h=400&fit=crop&q=80'
WHERE slug = 'real-estate';

UPDATE pitch_deck_industries SET
  layout_variant = 'culinary',
  img_hero = 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600&h=400&fit=crop&q=80',
  img_team = 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=600&h=400&fit=crop&q=80',
  img_services = 'https://images.unsplash.com/photo-1556910103-1c02745aae4d?w=600&h=400&fit=crop&q=80',
  img_goals = 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=600&h=400&fit=crop&q=80',
  img_plans = 'https://images.unsplash.com/photo-1466978913421-dad2ebd01d17?w=600&h=400&fit=crop&q=80',
  img_thanks = 'https://images.unsplash.com/photo-1528605248644-14dd04022da1?w=600&h=400&fit=crop&q=80'
WHERE slug = 'restaurant';
