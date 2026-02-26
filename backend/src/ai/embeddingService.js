// src/ai/embeddingService.js
// Сервис генерации эмбеддингов для блюд меню.

import { openai, hasOpenAI } from '../services/openaiClient.js';
import { query } from '../db.js';
import { getMenuItemsWithDetails } from '../models/menuModel.js';

const DEFAULT_EMBEDDINGS_MODEL =
  process.env.OPENAI_EMBEDDINGS_MODEL || 'text-embedding-3-small';

// ВАЖНО: эмбеддинги теперь храним только для EN.
// Остальные локали можем оставить в БД как fallback для чтения.
const EMBEDDING_LOCALE = 'en';
const SUPPORTED_LOCALES = [EMBEDDING_LOCALE];


/**
 * Собрать текстовое представление блюда для конкретной локали.
 */
function buildMenuItemText(menuItem, locale) {
  const {
    name_ua,
    name_en,
    description_ua,
    description_en,
    ingredients,
    ingredients_json,
    allergens,
  } = menuItem;

  let name = name_en || name_ua;
  let description = description_en || description_ua;

  if (locale === 'uk') {
    name = name_ua || name_en || name;
    description = description_ua || description_en || description;
  } else if (locale === 'ru') {
    // Пока нет отдельного ru — используем uk/en.
    name = name_ua || name_en || name;
    description = description_ua || description_en || description;
  } else {
    // en
    name = name_en || name_ua || name;
    description = description_en || description_ua || description;
  }

  const ingredientList =
    Array.isArray(ingredients) && ingredients.length > 0
      ? ingredients
      : Array.isArray(ingredients_json)
      ? ingredients_json
      : [];

  const allergenNames = Array.isArray(allergens)
    ? allergens
        .map((a) => {
          if (!a) return null;
          if (typeof a === 'string') return a;
          return a.name || a.code || null;
        })
        .filter(Boolean)
    : [];

  const parts = [
    `name: ${name || ''}`,
    `description: ${description || ''}`,
    ingredientList.length ? `ingredients: ${ingredientList.join(', ')}` : '',
    allergenNames.length ? `allergens: ${allergenNames.join(', ')}` : '',
  ].filter(Boolean);

  return parts.join('\n');
}

/**
 * Внутренний helper: получить эмбеддинг для текста.
 * Сейчас — обёртка над OpenAI embeddings с заглушкой,
 * если OPENAI_API_KEY не задан.
 */
async function getEmbeddingForText(text) {
  if (!hasOpenAI) {
    // Заглушка: возвращаем короткий "псевдо-вектор"
    const hash = [...text].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    return [hash % 1000, (hash * 7) % 1000, (hash * 13) % 1000];
  }

  const response = await openai.embeddings.create({
    model: DEFAULT_EMBEDDINGS_MODEL,
    input: text,
  });

  return response.data[0].embedding;
}

/**
 * Сгенерировать и сохранить эмбеддинги для одного блюда
 * по всем поддерживаемым локалям.
 *
 * @param {object} menuItem - объект блюда (как из getMenuItemsWithDetails)
 */
export async function generateMenuItemEmbeddings(menuItem) {
  if (!menuItem || !menuItem.id) {
    throw new Error('generateMenuItemEmbeddings: menuItem with id is required');
  }

  for (const locale of SUPPORTED_LOCALES) {
    const text = buildMenuItemText(menuItem, locale);
    const vector = await getEmbeddingForText(text);

    await query(
      `
      INSERT INTO menu_item_embeddings (menu_item_id, locale, embedding, created_at, updated_at)
      VALUES ($1, $2, $3::jsonb, NOW(), NOW())
      ON CONFLICT (menu_item_id, locale)
      DO UPDATE SET
        embedding  = EXCLUDED.embedding,
        updated_at = NOW();
    `,
      [menuItem.id, locale, JSON.stringify(vector)]
    );
  }
}

/**
 * Перегенерировать эмбеддинги для всех блюд ресторана.
 *
 * Возвращает { restaurant_id, total, updated }.
 */
export async function rebuildEmbeddingsForRestaurant(
  restaurantId,
  { onlyActive = true } = {}
) {
  const items = await getMenuItemsWithDetails(restaurantId, { onlyActive });
  let updated = 0;

  for (const item of items) {
    await generateMenuItemEmbeddings(item);
    updated += 1;
  }

  return {
    restaurant_id: restaurantId,
    total: items.length,
    updated,
  };
}
