// src/models/menuModel.js
import { query } from '../db.js';

/**
 * Базовая выборка меню для ресторана.
 * Используется фронтом и существующей логикой.
 */
export async function getMenuItems(restaurantId, { onlyActive = true } = {}) {
  const params = [restaurantId];
  let where = 'WHERE restaurant_id = $1';

  if (onlyActive) {
    where += ' AND is_active = TRUE';
  }

  const sql = `
    SELECT
      id,
      restaurant_id,
      item_code,
      name_ua,
      name_en,
      description_ua,
      description_en,
      base_price,
      category,
      tags,
      COALESCE(
        (
          SELECT array_agg(micc.custom_category_id::text)
          FROM menu_item_custom_categories micc
          WHERE micc.menu_item_id = menu_items.id
        ),
        ARRAY[]::text[]
      ) AS custom_category_ids,
      is_active,
      ingredients,
      allergens
    FROM menu_items
    ${where}
    ORDER BY category, name_ua
  `;

  const result = await query(sql, params);
  return result.rows;
}

/**
 * Получить блюдо по id (с базовыми полями).
 */
export async function getMenuItemById(id) {
  const sql = `
    SELECT
      id,
      restaurant_id,
      item_code,
      name_ua,
      name_en,
      description_ua,
      description_en,
      base_price,
      category,
      tags,
      COALESCE(
        (
          SELECT array_agg(micc.custom_category_id::text)
          FROM menu_item_custom_categories micc
          WHERE micc.menu_item_id = menu_items.id
        ),
        ARRAY[]::text[]
      ) AS custom_category_ids,
      is_active,
      ingredients,
      allergens
    FROM menu_items
    WHERE id = $1
  `;
  const result = await query(sql, [id]);
  return result.rows[0] || null;
}

/**
 * Получить список аллергенов ресторана (множественное объединение по меню).
 */
export async function getRestaurantAllergens(restaurantId) {
  const sql = `
    SELECT DISTINCT
      jsonb_array_elements_text(allergens) AS allergen
    FROM menu_items
    WHERE restaurant_id = $1
      AND jsonb_typeof(allergens) = 'array'
  `;
  const result = await query(sql, [restaurantId]);
  return result.rows.map((row) => row.allergen);
}

/**
 * Получить блюда по item_code с их аллергенами (используется allergyService).
 */
export async function getMenuItemsWithAllergensByCodes(
  restaurantId,
  itemCodes = []
) {
  if (!itemCodes || itemCodes.length === 0) return [];

  const sql = `
    SELECT
      id,
      restaurant_id,
      item_code,
      name_ua,
      name_en,
      COALESCE(allergens, '[]'::jsonb) AS allergens
    FROM menu_items
    WHERE restaurant_id = $1
      AND item_code = ANY($2::text[])
  `;
  const result = await query(sql, [restaurantId, itemCodes]);
  return result.rows;
}

// Получить базовые данные по блюдам (цена + фото) по их item_code.
export async function getMenuItemsBasicByCodes(restaurantId, itemCodes = []) {
  if (!restaurantId) throw new Error('restaurantId is required');
  if (!itemCodes || itemCodes.length === 0) return [];

  const sql = `
    SELECT
      m.item_code,
      m.base_price,
      COALESCE(
        json_agg(p.url ORDER BY p.sort_order)
          FILTER (WHERE p.id IS NOT NULL),
        '[]'
      ) AS photos
    FROM menu_items m
    LEFT JOIN menu_item_photos p ON p.menu_item_id = m.id
    WHERE m.restaurant_id = $1
      AND m.item_code = ANY($2::text[])
    GROUP BY m.item_code, m.base_price
  `;

  const result = await query(sql, [restaurantId, itemCodes]);
  return result.rows;
}


/**
 * Upsert блюда в таблицу menu_items.
 * Если передан id — обновляем по id.
 * Если id нет — upsert по (restaurant_id, item_code).
 */
export async function upsertMenuItem({
  id,
  restaurant_id,
  item_code,
  name_ua,
  name_en = null,
  description_ua = null,
  description_en = null,
  base_price,
  category = null,
  tags = [],
  is_active = true,
  ingredients = [],
  allergens = [],
}) {
  if (!restaurant_id) throw new Error('restaurant_id is required');
  if (!item_code) throw new Error('item_code is required');
  if (!name_ua) throw new Error('name_ua is required');
  if (base_price == null) throw new Error('base_price is required');

  const ingredientsJson = JSON.stringify(ingredients || []);
  const allergensJson = JSON.stringify(
    (allergens || []).map((a) => (typeof a === 'string' ? a : a.code))
  );

  if (id) {
    const sql = `
      UPDATE menu_items
      SET
        restaurant_id   = $1,
        item_code       = $2,
        name_ua         = $3,
        name_en         = $4,
        description_ua  = $5,
        description_en  = $6,
        base_price      = $7,
        category        = $8,
        tags            = $9,
        is_active       = $10,
        ingredients     = $11::jsonb,
        allergens       = $12::jsonb,
        updated_at      = NOW()
      WHERE id = $13
      RETURNING *;
    `;
    const result = await query(sql, [
      restaurant_id,
      item_code,
      name_ua,
      name_en,
      description_ua,
      description_en,
      base_price,
      category,
      tags,
      is_active,
      ingredientsJson,
      allergensJson,
      id,
    ]);
    return result.rows[0];
  }

  const sql = `
    INSERT INTO menu_items (
      restaurant_id,
      item_code,
      name_ua,
      name_en,
      description_ua,
      description_en,
      base_price,
      category,
      tags,
      is_active,
      ingredients,
      allergens
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb)
    ON CONFLICT (restaurant_id, item_code)
    DO UPDATE SET
      name_ua        = EXCLUDED.name_ua,
      name_en        = EXCLUDED.name_en,
      description_ua = EXCLUDED.description_ua,
      description_en = EXCLUDED.description_en,
      base_price     = EXCLUDED.base_price,
      category       = EXCLUDED.category,
      tags           = EXCLUDED.tags,
      is_active      = EXCLUDED.is_active,
      ingredients    = EXCLUDED.ingredients,
      allergens      = EXCLUDED.allergens,
      updated_at     = NOW()
    RETURNING *;
  `;
  const result = await query(sql, [
    restaurant_id,
    item_code,
    name_ua,
    name_en,
    description_ua,
    description_en,
    base_price,
    category,
    tags,
    is_active,
    ingredientsJson,
    allergensJson,
  ]);
  return result.rows[0];
}

/**
 * Найти или создать ингредиенты по списку имён.
 * Возвращает [{ id, name }, ...]
 */
export async function findOrCreateIngredients(names = []) {
  const uniqueNames = Array.from(
    new Set((names || []).map((n) => (n || '').trim()).filter(Boolean))
  );
  if (uniqueNames.length === 0) return [];

  const results = [];
  for (const name of uniqueNames) {
    const sql = `
      INSERT INTO ingredients (name)
      VALUES ($1)
      ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
      RETURNING id, name;
    `;
    const res = await query(sql, [name]);
    results.push(res.rows[0]);
  }
  return results;
}

/**
 * Найти или создать аллергены по списку кодов/объектов.
 * allergensInput: ['gluten', { code: 'nuts', name: 'Nuts' }, ...]
 * Возвращает [{ id, code, name }, ...]
 */
export async function findOrCreateAllergens(allergensInput = []) {
  const normalized = (allergensInput || []).map((a) =>
    typeof a === 'string'
      ? { code: a, name: a }
      : { code: a.code, name: a.name || a.code }
  );
  const byCode = new Map();
  for (const a of normalized) {
    if (!a.code) continue;
    if (!byCode.has(a.code)) {
      byCode.set(a.code, a);
    }
  }
  if (byCode.size === 0) return [];

  const results = [];
  for (const { code, name } of byCode.values()) {
    const sql = `
      INSERT INTO allergens (code, name)
      VALUES ($1, $2)
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
      RETURNING id, code, name;
    `;
    const res = await query(sql, [code, name]);
    results.push(res.rows[0]);
  }
  return results;
}

/**
 * Полностью заменить список ингредиентов для блюда.
 */
export async function replaceMenuItemIngredients(
  menuItemId,
  ingredientNames = []
) {
  await query('DELETE FROM menu_item_ingredients WHERE menu_item_id = $1', [
    menuItemId,
  ]);

  const ingredients = await findOrCreateIngredients(ingredientNames);
  for (const ing of ingredients) {
    await query(
      `
      INSERT INTO menu_item_ingredients (menu_item_id, ingredient_id)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING;
    `,
      [menuItemId, ing.id]
    );
  }
}

/**
 * Полностью заменить список аллергенов для блюда.
 */
export async function replaceMenuItemAllergens(
  menuItemId,
  allergensInput = []
) {
  await query('DELETE FROM menu_item_allergens WHERE menu_item_id = $1', [
    menuItemId,
  ]);

  const allergens = await findOrCreateAllergens(allergensInput);
  for (const al of allergens) {
    await query(
      `
      INSERT INTO menu_item_allergens (menu_item_id, allergen_id)
      VALUES ($1, $2)
      ON CONFLICT DO NOTHING;
    `,
      [menuItemId, al.id]
    );
  }
}

/**
 * Полностью заменить список фотографий для блюда.
 */
export async function replaceMenuItemPhotos(menuItemId, photoUrls = []) {
  await query('DELETE FROM menu_item_photos WHERE menu_item_id = $1', [
    menuItemId,
  ]);

  const normalizePhotoUrl = (u) => {
    if (typeof u === 'string') return u.trim();
    if (u && typeof u === 'object') {
      if (typeof u.url === 'string') return u.url.trim();
      if (typeof u.src === 'string') return u.src.trim();
    }
    return '';
  };

  const urls = Array.from(
    new Set((photoUrls || []).map(normalizePhotoUrl).filter(Boolean))
  );
  for (const url of urls) {
    await query(
      `
      INSERT INTO menu_item_photos (menu_item_id, url)
      VALUES ($1, $2)
    `,
      [menuItemId, url]
    );
  }
}

/**
 * Получить блюдо с деталями (ингредиенты, аллергены, фото).
 */
export async function getMenuItemWithDetailsById(id) {
  const sql = `
    SELECT
      m.id,
      m.restaurant_id,
      m.item_code,
      m.name_ua,
      m.name_en,
      m.description_ua,
      m.description_en,
      m.base_price,
      m.category,
      m.tags,
      COALESCE(
        (
          SELECT array_agg(micc.custom_category_id::text)
          FROM menu_item_custom_categories micc
          WHERE micc.menu_item_id = m.id
        ),
        ARRAY[]::text[]
      ) AS custom_category_ids,
      m.is_active,
      m.ingredients AS ingredients_json,
      m.allergens  AS allergens_json,
      COALESCE(
        json_agg(DISTINCT i.name) FILTER (WHERE i.id IS NOT NULL),
        '[]'
      ) AS ingredients,
      COALESCE(
        json_agg(DISTINCT jsonb_build_object('code', a.code, 'name', a.name))
        FILTER (WHERE a.id IS NOT NULL),
        '[]'
      ) AS allergens,
      COALESCE(
        json_agg(DISTINCT p.url) FILTER (WHERE p.id IS NOT NULL),
        '[]'
      ) AS photos
    FROM menu_items m
    LEFT JOIN menu_item_ingredients mi ON mi.menu_item_id = m.id
    LEFT JOIN ingredients i ON i.id = mi.ingredient_id
    LEFT JOIN menu_item_allergens ma ON ma.menu_item_id = m.id
    LEFT JOIN allergens a ON a.id = ma.allergen_id
    LEFT JOIN menu_item_photos p ON p.menu_item_id = m.id
    WHERE m.id = $1
    GROUP BY m.id
  `;
  const result = await query(sql, [id]);
  return result.rows[0] || null;
}

/**
 * Получить список блюд ресторана с деталями (для эмбеддингов и админки).
 */
export async function getMenuItemsWithDetails(
  restaurantId,
  { onlyActive = true } = {}
) {
  const params = [restaurantId];
  let where = 'WHERE m.restaurant_id = $1';

  if (onlyActive) {
    where += ' AND m.is_active = TRUE';
  }

  const sql = `
    SELECT
      m.id,
      m.restaurant_id,
      m.item_code,
      m.name_ua,
      m.name_en,
      m.description_ua,
      m.description_en,
      m.base_price,
      m.category,
      m.tags,
      COALESCE(
        (
          SELECT array_agg(micc.custom_category_id::text)
          FROM menu_item_custom_categories micc
          WHERE micc.menu_item_id = m.id
        ),
        ARRAY[]::text[]
      ) AS custom_category_ids,
      m.is_active,
      m.ingredients AS ingredients_json,
      m.allergens  AS allergens_json,
      COALESCE(
        json_agg(DISTINCT i.name) FILTER (WHERE i.id IS NOT NULL),
        '[]'
      ) AS ingredients,
      COALESCE(
        json_agg(DISTINCT jsonb_build_object('code', a.code, 'name', a.name))
        FILTER (WHERE a.id IS NOT NULL),
        '[]'
      ) AS allergens,
      COALESCE(
        json_agg(DISTINCT p.url) FILTER (WHERE p.id IS NOT NULL),
        '[]'
      ) AS photos
    FROM menu_items m
    LEFT JOIN menu_item_ingredients mi ON mi.menu_item_id = m.id
    LEFT JOIN ingredients i ON i.id = mi.ingredient_id
    LEFT JOIN menu_item_allergens ma ON ma.menu_item_id = m.id
    LEFT JOIN allergens a ON a.id = ma.allergen_id
    LEFT JOIN menu_item_photos p ON p.menu_item_id = m.id
    ${where}
    GROUP BY m.id
    ORDER BY m.category, m.name_ua
  `;
  const result = await query(sql, params);
  return result.rows;
}

/**
 * Получить активные блюда по кодам.
 * Используется в recoService.
 * (ВЕРНУЛИ этот экспорт, чтобы ничего не сломать.)
 */
export async function getActiveMenuItemsByCodes(restaurantId, itemCodes = []) {
  if (!itemCodes || itemCodes.length === 0) return [];

  const result = await query(
    `
    SELECT
      id,
      restaurant_id,
      item_code,
      name_ua,
      name_en,
      description_ua,
      description_en,
      base_price,
      category,
      tags,
      is_active
    FROM menu_items
    WHERE restaurant_id = $1
      AND item_code = ANY($2::text[])
      AND is_active = TRUE
    `,
    [restaurantId, itemCodes]
  );

  return result.rows;
}

/**
 * Soft-delete блюда (без физического удаления).
 * Ставим is_active = false, чтобы не ломать историю заказов.
 */
export async function deactivateMenuItemById(restaurantId, id) {
  if (!restaurantId) throw new Error('restaurantId is required');
  if (!id) throw new Error('id is required');

  const { rows } = await query(
    `
    UPDATE menu_items
    SET is_active = FALSE
    WHERE restaurant_id = $1 AND id = $2
    RETURNING *
    `,
    [restaurantId, id]
  );

  return rows[0] || null;
}
