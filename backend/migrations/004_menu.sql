BEGIN;

-- На всякий случай подключим pgcrypto для gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id TEXT NOT NULL,
  item_code TEXT NOT NULL,
  name_ua TEXT NOT NULL,
  name_en TEXT,
  description_ua TEXT,
  description_en TEXT,
  base_price NUMERIC(10,2) NOT NULL,
  category TEXT,
  tags TEXT[],
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_menu_items_rest_code
  ON menu_items (restaurant_id, item_code);

-- Демо-меню для azuma_demo
INSERT INTO menu_items (
  restaurant_id,
  item_code,
  name_ua,
  name_en,
  description_ua,
  description_en,
  base_price,
  category,
  tags
)
VALUES
(
  'azuma_demo',
  'SHRIMP_POPCORN',
  'Попкорн з креветок',
  'Shrimp popcorn',
  'Фірмовий попкорн з хрусткими креветками.',
  'Signature shrimp popcorn snack.',
  520,
  'snack',
  ARRAY['shrimp','seafood','snack']
),
(
  'azuma_demo',
  'LEMONADE',
  'Лимонад',
  'Lemonade',
  'Домашній лимонад з цитрусовими.',
  'House lemonade with citrus.',
  120,
  'drink',
  ARRAY['drink','cold','refreshing']
)
ON CONFLICT (restaurant_id, item_code) DO NOTHING;

COMMIT;
