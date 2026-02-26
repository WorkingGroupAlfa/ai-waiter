BEGIN;

-- 005_menu_knowledge_engine.sql
-- Структура Menu Knowledge Engine:
--   - ingredients
--   - allergens
--   - связующие таблицы к menu_items
--   - фото блюд
--   - эмбеддинги блюд

-- На всякий случай
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS allergens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS menu_item_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS menu_item_ingredients (
  menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  PRIMARY KEY (menu_item_id, ingredient_id)
);

CREATE TABLE IF NOT EXISTS menu_item_allergens (
  menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  allergen_id UUID NOT NULL REFERENCES allergens(id) ON DELETE CASCADE,
  PRIMARY KEY (menu_item_id, allergen_id)
);

CREATE TABLE IF NOT EXISTS menu_item_embeddings (
  menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  locale TEXT NOT NULL,
  embedding JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (menu_item_id, locale)
);

-- Простая инициализация справочников из существующих JSON-полей,
-- если они уже заполнены (для демо-меню).
INSERT INTO ingredients (name)
SELECT DISTINCT trim(value::text, '\"') AS name
FROM menu_items m
CROSS JOIN LATERAL jsonb_array_elements_text(m.ingredients) AS value
WHERE jsonb_typeof(m.ingredients) = 'array'
ON CONFLICT (name) DO NOTHING;

INSERT INTO allergens (code, name)
SELECT DISTINCT val AS code,
       val AS name
FROM menu_items m
CROSS JOIN LATERAL jsonb_array_elements_text(m.allergens) AS val
WHERE jsonb_typeof(m.allergens) = 'array'
ON CONFLICT (code) DO NOTHING;

INSERT INTO menu_item_ingredients (menu_item_id, ingredient_id)
SELECT DISTINCT
  m.id AS menu_item_id,
  i.id AS ingredient_id
FROM menu_items m
CROSS JOIN LATERAL jsonb_array_elements_text(m.ingredients) AS ing_name
JOIN ingredients i ON i.name = ing_name
WHERE jsonb_typeof(m.ingredients) = 'array'
ON CONFLICT DO NOTHING;

INSERT INTO menu_item_allergens (menu_item_id, allergen_id)
SELECT DISTINCT
  m.id AS menu_item_id,
  a.id AS allergen_id
FROM menu_items m
CROSS JOIN LATERAL jsonb_array_elements_text(m.allergens) AS al_code
JOIN allergens a ON a.code = al_code
WHERE jsonb_typeof(m.allergens) = 'array'
ON CONFLICT DO NOTHING;

COMMIT;
