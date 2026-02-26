-- 004_menu_allergens.sql

-- Добавляем поля для состава и аллергенов в меню
ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS ingredients JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS allergens  JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Пример наполнения для демо-меню azuma_demo

-- Лимонад — без аллергенов
UPDATE menu_items
SET
  ingredients = '["water", "lemon", "sugar", "ice"]'::jsonb,
  allergens   = '[]'::jsonb
WHERE restaurant_id = 'azuma_demo' AND item_code = 'LEMONADE';

-- Попкорн з креветок — содержит морепродукты и глютен
UPDATE menu_items
SET
  ingredients = '["shrimp", "flour", "oil", "spices"]'::jsonb,
  allergens   = '["seafood", "gluten"]'::jsonb
WHERE restaurant_id = 'azuma_demo' AND item_code = 'SHRIMP_POPCORN';
