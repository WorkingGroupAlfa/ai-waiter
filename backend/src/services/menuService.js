// src/services/menuService.js
import {
  getMenuItems,
  getRestaurantAllergens,
  getMenuItemsWithDetails,
  getMenuItemWithDetailsById,
  getMenuItemsBasicByCodes,
} from '../models/menuModel.js';
import { suggestMenuByText } from '../ai/semanticMatcher.js';
import { query } from '../db.js';

// --- Preference keywords → tags (admin-managed standard tags) ---
const PREF_KEYWORDS = [
  { tags: ['spicy'], words: ['остро', 'остреньк', 'spicy', 'hot', 'пікант', 'пiкант', 'гостр'] },
  { tags: ['sweet', 'dessert'], words: ['слад', 'sweet', 'dessert', 'десерт'] },
  { tags: ['salty'], words: ['солен', 'солон', 'salty'] },
  { tags: ['sour'], words: ['кисл', 'sour'] },
  { tags: ['drink'], words: ['напит', 'пить', 'drink', 'beverage', 'cola', 'coke', 'лимонад', 'lemonade', 'чай', 'tea', 'кофе', 'coffee'] },
  { tags: ['snack'], words: ['закуск', 'snack', 'аппетайзер', 'appetizer'] },
  { tags: ['main'], words: ['основн', 'main', 'main dish', 'entree', 'entrée'] },
  { tags: ['light'], words: ['легк', 'light'] },
];

function detectPreferredTags(text) {
  const t = String(text || '').toLowerCase();
  const out = new Set();
  for (const rule of PREF_KEYWORDS) {
    if (rule.words.some((w) => t.includes(w))) {
      for (const tag of rule.tags) out.add(tag);
    }
  }
  return Array.from(out);
}

async function pickByTags(restaurantId, tags, limit = 6) {
  if (!tags?.length) return [];
  const { rows } = await query(
    `
    SELECT item_code, COALESCE(name_en, name_ua) AS name_any
    FROM menu_items
    WHERE restaurant_id = $1 AND is_active = TRUE
      AND (tags && $2::text[])
    LIMIT $3
    `,
    [restaurantId, tags, Number(limit) || 6]
  );
  return rows || [];
}

async function pickFallbackAny(restaurantId, limit = 6) {
  const { rows } = await query(
    `
    SELECT item_code, COALESCE(name_en, name_ua) AS name_any
    FROM menu_items
    WHERE restaurant_id = $1 AND is_active = TRUE
    ORDER BY COALESCE(category, ''), item_code
    LIMIT $2
    `,
    [restaurantId, Number(limit) || 6]
  );
  return rows || [];
}


/**
 * Сервис-обёртка для получения меню.
 * Здесь можно будет навесить кеш, трансформации и т.п.
 */
export async function fetchMenuItems(restaurantId, { onlyActive = true } = {}) {
  if (!restaurantId) {
    throw new Error('restaurantId is required');
  }

  return getMenuItems(restaurantId, { onlyActive });
}

/**
 * Сервис-обёртка для получения одного блюда по id (с деталями).
 */
export async function fetchMenuItemById(id) {
  if (!id) {
    throw new Error('id is required');
  }
  return getMenuItemWithDetailsById(id);
}

/**
 * Сервис-обёртка для получения меню с деталями (ингредиенты, аллергены, фото).
 * Используется для админки и генерации эмбеддингов.
 */
export async function fetchMenuItemsWithDetails(
  restaurantId,
  { onlyActive = true } = {}
) {
  if (!restaurantId) {
    throw new Error('restaurantId is required');
  }

  return getMenuItemsWithDetails(restaurantId, { onlyActive });
}

/**
 * Сервис-обёртка для получения списка аллергенов ресторана.
 */
export async function fetchRestaurantAllergens(restaurantId) {
  if (!restaurantId) {
    throw new Error('restaurantId is required');
  }

  return getRestaurantAllergens(restaurantId);
}

/**
 * suggestMenuItems
 *
 * @param {string} restaurantId
 * @param {string} query     — текст пользователя (любой язык)
 * @param {string} locale    — код языка (может быть null)
 * @param {number} limit
 *
 * Возвращает массив { item_code, name_en, base_price, image_url }.
 */
/**
 * Подсказки блюд по тексту пользователя.
 *
 * Возвращает [{ item_code, name, price, image_url }]
 */
export async function suggestMenuItems(restaurantId, { query, locale, limit = 6 }) {
  if (!restaurantId) throw new Error('restaurantId is required');

  const trimmed = String(query || '').trim();
  if (!trimmed) return [];

  // 0) Tags-first for preference requests (spicy/sweet/drink/snack/main/etc)
  const preferredTags = detectPreferredTags(trimmed);
  if (preferredTags.length) {
    const tagRows = await pickByTags(restaurantId, preferredTags, limit);
    if (tagRows.length) {
      const itemCodes = tagRows.map((r) => r.item_code).filter(Boolean);
      const basics = await getMenuItemsBasicByCodes(restaurantId, itemCodes);
      const basicsByCode = new Map(basics.map((row) => [row.item_code, row]));

      return tagRows.map((r) => {
        const base = basicsByCode.get(r.item_code);
        const photos = Array.isArray(base?.photos) ? base.photos : [];
        const imageUrl = photos.length ? photos[0] : null;
        return {
          item_code: r.item_code,
          name: r.name_any || r.item_code,
          price: base?.base_price ?? null,
          image_url: imageUrl,
        };
      });
    }
  }

  // 1) Embeddings-based suggestions
  const matches = await suggestMenuByText({
    text: trimmed,
    locale,
    restaurantId,
    limit,
  });

  if (!matches.length) {
    // Safe fallback list (avoid endless "уточните...")
    const fallbackRows = await pickFallbackAny(restaurantId, limit);
    if (!fallbackRows.length) return [];

    const itemCodes = fallbackRows.map((r) => r.item_code).filter(Boolean);
    const basics = await getMenuItemsBasicByCodes(restaurantId, itemCodes);
    const basicsByCode = new Map(basics.map((row) => [row.item_code, row]));

    return fallbackRows.map((r) => {
      const base = basicsByCode.get(r.item_code);
      const photos = Array.isArray(base?.photos) ? base.photos : [];
      const imageUrl = photos.length ? photos[0] : null;
      return {
        item_code: r.item_code,
        name: r.name_any || r.item_code,
        price: base?.base_price ?? null,
        image_url: imageUrl,
      };
    });
  }

  // Подтягиваем базовые поля по item_code → цена/фото
  const itemCodes = matches.map((m) => m.item_code).filter(Boolean);
  const basics = await getMenuItemsBasicByCodes(restaurantId, itemCodes);

  const basicsByCode = new Map(basics.map((row) => [row.item_code, row]));

  return matches.map((m) => {
    const base = basicsByCode.get(m.item_code);
    const photos = Array.isArray(base?.photos) ? base.photos : [];
    const imageUrl = photos.length ? photos[0] : null;

    return {
      item_code: m.item_code,
      name: m.name_en || m.item_code,
      price: base?.base_price ?? null,
      image_url: imageUrl,
    };
  });
}

