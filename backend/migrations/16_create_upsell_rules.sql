BEGIN;

CREATE TABLE IF NOT EXISTS upsell_rules (
  id BIGSERIAL PRIMARY KEY,
  restaurant_id VARCHAR(64) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  -- item_to_item | category_to_item | tag_to_item
  rule_type TEXT NOT NULL CHECK (rule_type IN ('item_to_item','category_to_item','tag_to_item')),

  trigger_item_code TEXT,
  trigger_category_id TEXT,
  trigger_tag TEXT,

  suggested_item_code TEXT NOT NULL,

  priority INT NOT NULL DEFAULT 0,
  weight NUMERIC(10,4) NOT NULL DEFAULT 0.6000,
  reason_code TEXT,

  -- constraints
  max_per_session INT,
  cooldown_minutes INT,
  min_order_total NUMERIC(10,2),
  time_windows JSONB,
  channels TEXT[],

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- sanity: ensure the matching trigger column is present
  CHECK (
    (rule_type = 'item_to_item' AND trigger_item_code IS NOT NULL)
    OR
    (rule_type = 'category_to_item' AND trigger_category_id IS NOT NULL)
    OR
    (rule_type = 'tag_to_item' AND trigger_tag IS NOT NULL)
  )
);

-- индексы (как в ТЗ)
CREATE INDEX IF NOT EXISTS idx_upsell_rules_restaurant_active
  ON upsell_rules (restaurant_id, is_active);

CREATE INDEX IF NOT EXISTS idx_upsell_rules_trigger_item
  ON upsell_rules (trigger_item_code);

CREATE INDEX IF NOT EXISTS idx_upsell_rules_trigger_category
  ON upsell_rules (trigger_category_id);

CREATE INDEX IF NOT EXISTS idx_upsell_rules_suggested_item
  ON upsell_rules (suggested_item_code);

-- (опционально полезно) быстрые фильтры по типу
CREATE INDEX IF NOT EXISTS idx_upsell_rules_rule_type
  ON upsell_rules (rule_type);

-- (опционально) seed: переносим shrimp_popcorn → lemonade в БД (не обязателен, но удобно)
INSERT INTO upsell_rules (
  restaurant_id, is_active, rule_type,
  trigger_item_code, suggested_item_code,
  priority, weight, reason_code,
  max_per_session, cooldown_minutes
) VALUES (
  'azuma_demo', TRUE, 'item_to_item',
  'SHRIMP_POPCORN', 'LEMONADE',
  50, 0.85, 'pairing_with_item',
  1, 20
)
ON CONFLICT DO NOTHING;

COMMIT;
