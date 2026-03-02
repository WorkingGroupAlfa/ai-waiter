// src/services/menuService.js
import {
  getMenuItems,
  getRestaurantAllergens,
  getMenuItemsWithDetails,
  getMenuItemWithDetailsById,
  getMenuItemsBasicByCodes,
} from '../models/menuModel.js';
import {
  findCustomCategoryByMention,
  getMenuItemsByCustomCategory,
} from '../models/customCategoryModel.js';
import { suggestMenuByText } from '../ai/semanticMatcher.js';
import { translateToEnglish } from '../ai/translationService.js';
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

function normalizeLookupText(v) {
  return String(v || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const QUERY_STOPWORDS = new Set([
  'хочу',
  'пожалуйста',
  'посоветуй',
  'посоветуйте',
  'покажи',
  'что',
  'есть',
  'какие',
  'какой',
  'мне',
  'из',
  'для',
  'блюдо',
  'блюда',
  'можно',
  'menu',
  'recommend',
  'suggest',
  'show',
  'want',
  'please',
  'with',
  'item',
  'dish',
]);

const INGREDIENT_HINTS = [
  ['shrimp', ['кревет', 'shrimp', 'prawn']],
  ['salmon', ['лосос', 'salmon']],
  ['tuna', ['тунец', 'тунц', 'tuna']],
  ['eel', ['угор', 'вугор', 'eel', 'unagi']],
  ['crab', ['краб', 'crab']],
  ['scallop', ['гребін', 'гребінец', 'гребінець', 'scallop']],
  ['squid', ['кальмар', 'squid', 'calamari']],
  ['miso', ['місо', 'мисо', 'miso']],
];

function extractSearchTerms(text) {
  const n = normalizeLookupText(text);
  if (!n) return [];

  const out = new Set();
  for (const [, variants] of INGREDIENT_HINTS) {
    if (variants.some((v) => n.includes(v))) {
      variants.forEach((v) => out.add(v));
    }
  }

  n.split(' ')
    .filter((t) => t.length >= 4 && !QUERY_STOPWORDS.has(t))
    .forEach((t) => out.add(t));

  return Array.from(out);
}

async function pickByIngredientsOrName(restaurantId, queryText, limit = 6) {
  const terms = extractSearchTerms(queryText);
  if (!terms.length) return [];
  const patterns = terms.map((t) => `%${t}%`);

  const { rows } = await query(
    `
    SELECT
      m.item_code,
      COALESCE(m.name_en, m.name_ua) AS name_any,
      m.base_price,
      (
        SELECT p.url
        FROM menu_item_photos p
        WHERE p.menu_item_id = m.id
        ORDER BY p.sort_order ASC, p.created_at ASC
        LIMIT 1
      ) AS image_url
    FROM menu_items m
    WHERE m.restaurant_id = $1
      AND m.is_active = TRUE
      AND (
        lower(COALESCE(m.name_ua, '')) LIKE ANY($2::text[])
        OR lower(COALESCE(m.name_en, '')) LIKE ANY($2::text[])
        OR lower(COALESCE(m.description_ua, '')) LIKE ANY($2::text[])
        OR lower(COALESCE(m.description_en, '')) LIKE ANY($2::text[])
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(COALESCE(m.ingredients, '[]'::jsonb)) AS ing(value)
          WHERE lower(ing.value) LIKE ANY($2::text[])
        )
      )
    ORDER BY m.name_ua ASC, m.item_code ASC
    LIMIT $3
    `,
    [restaurantId, patterns, Number(limit) || 6]
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
  const safeLimit = Number(limit) || 6;

  let translatedQuery = '';
  try {
    translatedQuery = String(await translateToEnglish(trimmed, locale) || '').trim();
  } catch (_) {
    translatedQuery = '';
  }

  // 0) Tags-first for preference requests (spicy/sweet/drink/snack/main/etc)
  const preferredTags = detectPreferredTags(trimmed);
  if (preferredTags.length) {
    const tagRows = await pickByTags(restaurantId, preferredTags, safeLimit);
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

  // 0.5) Category mention fallback (rolly/soups/gunkan/temaki/etc)
  const mentionedCategory = await findCustomCategoryByMention(restaurantId, trimmed);
  if (mentionedCategory?.id) {
    const categoryRows = await getMenuItemsByCustomCategory({
      restaurantId,
      categoryId: mentionedCategory.id,
      limit: safeLimit,
    });
    if (Array.isArray(categoryRows) && categoryRows.length) {
      return categoryRows.map((r) => ({
        item_code: r.item_code,
        name: r.name || r.item_code,
        price: r.price ?? null,
        image_url: r.image_url || null,
      }));
    }
  }

  // 0.75) Ingredient/name lexical search (for "блюдо с креветкой" and similar)
  const lexicalRows = await pickByIngredientsOrName(
    restaurantId,
    trimmed,
    safeLimit
  );
  if (lexicalRows.length) {
    return lexicalRows.map((r) => ({
      item_code: r.item_code,
      name: r.name_any || r.item_code,
      price: r.base_price ?? null,
      image_url: r.image_url || null,
    }));
  }

  // 0.9) Multilingual fallback:
  // If original query was in another language, rerun deterministic category/lexical paths on translated EN.
  if (translatedQuery && translatedQuery.toLowerCase() !== trimmed.toLowerCase()) {
    const preferredTagsTranslated = detectPreferredTags(translatedQuery);
    if (preferredTagsTranslated.length) {
      const tagRowsTranslated = await pickByTags(restaurantId, preferredTagsTranslated, safeLimit);
      if (tagRowsTranslated.length) {
        const itemCodes = tagRowsTranslated.map((r) => r.item_code).filter(Boolean);
        const basics = await getMenuItemsBasicByCodes(restaurantId, itemCodes);
        const basicsByCode = new Map(basics.map((row) => [row.item_code, row]));

        return tagRowsTranslated.map((r) => {
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

    const mentionedCategoryTranslated = await findCustomCategoryByMention(
      restaurantId,
      translatedQuery
    );
    if (mentionedCategoryTranslated?.id) {
      const categoryRowsTranslated = await getMenuItemsByCustomCategory({
        restaurantId,
        categoryId: mentionedCategoryTranslated.id,
        limit: safeLimit,
      });
      if (Array.isArray(categoryRowsTranslated) && categoryRowsTranslated.length) {
        return categoryRowsTranslated.map((r) => ({
          item_code: r.item_code,
          name: r.name || r.item_code,
          price: r.price ?? null,
          image_url: r.image_url || null,
        }));
      }
    }

    const lexicalRowsTranslated = await pickByIngredientsOrName(
      restaurantId,
      translatedQuery,
      safeLimit
    );
    if (lexicalRowsTranslated.length) {
      return lexicalRowsTranslated.map((r) => ({
        item_code: r.item_code,
        name: r.name_any || r.item_code,
        price: r.base_price ?? null,
        image_url: r.image_url || null,
      }));
    }
  }

  // 1) Embeddings-based suggestions
  const matches = await suggestMenuByText({
    text: trimmed,
    locale,
    restaurantId,
    limit: safeLimit,
  });

  if (!matches.length) return [];

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
