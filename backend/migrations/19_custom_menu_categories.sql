BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS menu_custom_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  name_ua TEXT NOT NULL,
  name_en TEXT,
  aliases TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (restaurant_id, slug)
);

CREATE TABLE IF NOT EXISTS menu_item_custom_categories (
  menu_item_id UUID NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  custom_category_id UUID NOT NULL REFERENCES menu_custom_categories(id) ON DELETE CASCADE,
  PRIMARY KEY (menu_item_id, custom_category_id)
);

CREATE INDEX IF NOT EXISTS idx_menu_custom_categories_restaurant_active
  ON menu_custom_categories(restaurant_id, is_active, sort_order);

CREATE INDEX IF NOT EXISTS idx_menu_item_custom_categories_category
  ON menu_item_custom_categories(custom_category_id);

COMMIT;
