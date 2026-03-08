BEGIN;

-- Fill missing bar drinks from frontend/bar.html for azuma_demo.
-- Adds hot drinks (bar-23), non-alcoholic drinks (bar-24), and fresh juices (bar-25).
-- Safe upsert by (restaurant_id, item_code).

INSERT INTO menu_items (
  restaurant_id, item_code, name_ua, name_en,
  description_ua, description_en, base_price,
  category, tags, is_active
)
VALUES
  ('azuma_demo', 'BAR_23_ESPRESSO-OR-DECAF', 'Еспресо / Еспресо без кофеїну', 'Espresso / Decaf Espresso', NULL, NULL, 90.00, 'drink', ARRAY['drink','hot']::text[], TRUE),
  ('azuma_demo', 'BAR_23_AMERICANO-OR-DECAF', 'Американо / Американо без кофеїну', 'Americano / Decaf Americano', NULL, NULL, 105.00, 'drink', ARRAY['drink','hot']::text[], TRUE),
  ('azuma_demo', 'BAR_23_CAPPUCCINO-OR-DECAF', 'Капучіно / Капучіно без кофеїну', 'Cappuccino / Decaf Cappuccino', NULL, NULL, 120.00, 'drink', ARRAY['drink','hot']::text[], TRUE),
  ('azuma_demo', 'BAR_23_LATTE-MACCHIATO', 'Лате Макіато', 'Latte Macchiato', NULL, NULL, 150.00, 'drink', ARRAY['drink','hot']::text[], TRUE),
  ('azuma_demo', 'BAR_23_MATCHA-LATTE-PLANT-MILK', 'Матча Лате (на рослинному молоці)', 'Matcha Latte (plant milk)', NULL, NULL, 230.00, 'drink', ARRAY['drink','hot']::text[], TRUE),
  ('azuma_demo', 'BAR_23_DOPPIO-PLANT-MILK', 'Допіо (на рослинному молоці)', 'Doppio (plant milk)', NULL, NULL, 140.00, 'drink', ARRAY['drink','hot']::text[], TRUE),
  ('azuma_demo', 'BAR_23_TURKISH-COFFEE', 'Кава по-турецьки', 'Turkish Coffee', NULL, NULL, 100.00, 'drink', ARRAY['drink','hot']::text[], TRUE),
  ('azuma_demo', 'BAR_23_COCOA-MARSHMALLOW', 'Какао з маршмелоу', 'Cocoa with Marshmallow', NULL, NULL, 160.00, 'drink', ARRAY['drink','hot']::text[], TRUE),
  ('azuma_demo', 'BAR_23_RAF-COFFEE', 'Раф кава', 'Raf Coffee', 'Кава збита з вершками та сиропом крем-брюле', 'Whipped coffee with cream and creme brulee syrup', 160.00, 'drink', ARRAY['drink','hot']::text[], TRUE),
  ('azuma_demo', 'BAR_23_FLAT-WHITE', 'Флет Уайт', 'Flat White', 'Подвійний еспресо, молоко', 'Double espresso, milk', 140.00, 'drink', ARRAY['drink','hot']::text[], TRUE),
  ('azuma_demo', 'BAR_23_ESPRESSO-TONIC', 'Еспресо-Тонік', 'Espresso Tonic', 'Еспресо, тонік, сироп маракуя', 'Espresso, tonic, passion fruit syrup', 190.00, 'drink', ARRAY['drink','hot']::text[], TRUE),
  ('azuma_demo', 'BAR_23_MULLED-WINE-RED-WHITE', 'Глінтвейн червоний/білий', 'Mulled Wine Red/White', 'Вино, мед, спеції', 'Wine, honey, spices', 195.00, 'drink', ARRAY['drink','hot']::text[], TRUE),

  ('azuma_demo', 'BAR_24_AQUA-PANNA', 'Вода мінеральна Aqua Panna', 'Mineral Water Aqua Panna', '250 мл, негазована', '250 ml, still', 195.00, 'drink', ARRAY['drink','soft']::text[], TRUE),
  ('azuma_demo', 'BAR_24_ROCCHETTA', 'Вода мінеральна Rocchetta', 'Mineral Water Rocchetta', '500 мл, негазована, газована', '500 ml, still/sparkling', 210.00, 'drink', ARRAY['drink','soft']::text[], TRUE),
  ('azuma_demo', 'BAR_24_EVIAN', 'Вода мінеральна Evian', 'Mineral Water Evian', '750 мл', '750 ml', 395.00, 'drink', ARRAY['drink','soft']::text[], TRUE),
  ('azuma_demo', 'BAR_24_PERRIER', 'Вода мінеральна Perrier', 'Mineral Water Perrier', '330 мл', '330 ml', 240.00, 'drink', ARRAY['drink','soft']::text[], TRUE),
  ('azuma_demo', 'BAR_24_BORJOMI', 'Вода мінеральна Borjomi', 'Mineral Water Borjomi', '500 мл', '500 ml', 195.00, 'drink', ARRAY['drink','soft']::text[], TRUE),
  ('azuma_demo', 'BAR_24_ORGANIC-FRITZ-COLA-SUGAR-FREE', 'Organic Fritz Cola Sugar Free', 'Organic Fritz Cola Sugar Free', '330 мл', '330 ml', 270.00, 'drink', ARRAY['drink','soft']::text[], TRUE),
  ('azuma_demo', 'BAR_24_COCA-COLA-SPRITE', 'Coca-Cola, Sprite', 'Coca-Cola, Sprite', '250 мл', '250 ml', 120.00, 'drink', ARRAY['drink','soft']::text[], TRUE),
  ('azuma_demo', 'BAR_24_TONIC-FRANKLIN-FENTIMANS', 'Тонік Franklin/ Fentimans', 'Tonic Franklin/Fentimans', '300 мл', '300 ml', 250.00, 'drink', ARRAY['drink','soft']::text[], TRUE),

  ('azuma_demo', 'BAR_25_FRESH-APPLE-JUICE', 'Яблучний', 'Fresh Apple Juice', '300 мл', '300 ml', 220.00, 'drink', ARRAY['drink','fresh_juice','soft']::text[], TRUE),
  ('azuma_demo', 'BAR_25_FRESH-CARROT-JUICE', 'Моркв''яний', 'Fresh Carrot Juice', '300 мл', '300 ml', 220.00, 'drink', ARRAY['drink','fresh_juice','soft']::text[], TRUE),
  ('azuma_demo', 'BAR_25_FRESH-GRAPEFRUIT-JUICE', 'Грейпфрутовий', 'Fresh Grapefruit Juice', '300 мл', '300 ml', 300.00, 'drink', ARRAY['drink','fresh_juice','soft']::text[], TRUE),
  ('azuma_demo', 'BAR_25_FRESH-ORANGE-JUICE', 'Апельсиновий', 'Fresh Orange Juice', '300 мл', '300 ml', 270.00, 'drink', ARRAY['drink','fresh_juice','soft']::text[], TRUE),
  ('azuma_demo', 'BAR_25_FRESH-PINEAPPLE-JUICE', 'Ананасовий', 'Fresh Pineapple Juice', '300 мл', '300 ml', 490.00, 'drink', ARRAY['drink','fresh_juice','soft']::text[], TRUE)
ON CONFLICT (restaurant_id, item_code) DO UPDATE SET
  name_ua = EXCLUDED.name_ua,
  name_en = EXCLUDED.name_en,
  description_ua = EXCLUDED.description_ua,
  description_en = EXCLUDED.description_en,
  base_price = EXCLUDED.base_price,
  category = EXCLUDED.category,
  tags = EXCLUDED.tags,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

-- Attach newly added items to their custom bar categories.
INSERT INTO menu_item_custom_categories (menu_item_id, custom_category_id)
SELECT mi.id, mcc.id
FROM menu_items mi
JOIN menu_custom_categories mcc
  ON mcc.restaurant_id = mi.restaurant_id
 AND mcc.slug = ('bar-' || split_part(mi.item_code, '_', 2))
WHERE mi.restaurant_id = 'azuma_demo'
  AND mi.item_code IN (
    'BAR_23_ESPRESSO-OR-DECAF',
    'BAR_23_AMERICANO-OR-DECAF',
    'BAR_23_CAPPUCCINO-OR-DECAF',
    'BAR_23_LATTE-MACCHIATO',
    'BAR_23_MATCHA-LATTE-PLANT-MILK',
    'BAR_23_DOPPIO-PLANT-MILK',
    'BAR_23_TURKISH-COFFEE',
    'BAR_23_COCOA-MARSHMALLOW',
    'BAR_23_RAF-COFFEE',
    'BAR_23_FLAT-WHITE',
    'BAR_23_ESPRESSO-TONIC',
    'BAR_23_MULLED-WINE-RED-WHITE',
    'BAR_24_AQUA-PANNA',
    'BAR_24_ROCCHETTA',
    'BAR_24_EVIAN',
    'BAR_24_PERRIER',
    'BAR_24_BORJOMI',
    'BAR_24_ORGANIC-FRITZ-COLA-SUGAR-FREE',
    'BAR_24_COCA-COLA-SPRITE',
    'BAR_24_TONIC-FRANKLIN-FENTIMANS',
    'BAR_25_FRESH-APPLE-JUICE',
    'BAR_25_FRESH-CARROT-JUICE',
    'BAR_25_FRESH-GRAPEFRUIT-JUICE',
    'BAR_25_FRESH-ORANGE-JUICE',
    'BAR_25_FRESH-PINEAPPLE-JUICE'
  )
ON CONFLICT DO NOTHING;

COMMIT;
