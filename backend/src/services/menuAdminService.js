// src/services/menuAdminService.js
// Бизнес-логика для админ-операций с меню.

import {
  upsertMenuItem,
  replaceMenuItemIngredients,
  replaceMenuItemAllergens,
  replaceMenuItemPhotos,
  getMenuItemWithDetailsById,
  deactivateMenuItemById,
} from '../models/menuModel.js';

import { generateMenuItemEmbeddings } from '../ai/embeddingService.js';

/**
 * Создать или обновить блюдо вместе с ингредиентами, аллергенами и фото.
 *
 * payload ожидается в формате:
 * {
 *   id?: string,
 *   restaurant_id: string,
 *   item_code: string,
 *   name_ua: string,
 *   name_en?: string,
 *   description_ua?: string,
 *   description_en?: string,
 *   base_price: number,
 *   category?: string,
 *   tags?: string[],
 *   is_active?: boolean,
 *   ingredients?: string[],
 *   allergens?: (string | { code: string, name?: string })[],
 *   photos?: string[],
 * }
 */
export async function createOrUpdateMenuItemWithDetails(payload) {
  const {
    id,
    restaurant_id,
    item_code,
    name_ua,
    name_en,
    description_ua,
    description_en,
    base_price,
    category,
    tags = [],
    is_active = true,
    ingredients = [],
    allergens = [],
    photos = [],
  } = payload;

  // 1. Upsert самого блюда (+ JSON-поля состав/аллергены).
  const menuItem = await upsertMenuItem({
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
    is_active,
    ingredients,
    allergens,
  });

  // 2. Нормализованные таблицы ингредиентов / аллергенов / фото.
  await replaceMenuItemIngredients(menuItem.id, ingredients);
  await replaceMenuItemAllergens(menuItem.id, allergens);
  await replaceMenuItemPhotos(menuItem.id, photos);

  // 3. Возвращаем блюдо с полными деталями.
  const full = await getMenuItemWithDetailsById(menuItem.id);

  // Обновляем эмбеддинги для этого блюда, чтобы новые/изменённые позиции
  // сразу корректно матчились в semantic/recommendations.
  // Если OpenAI не настроен — не ломаем админку.
  try {
    await generateMenuItemEmbeddings(full);
  } catch (e) {
    console.warn('[menuAdminService] generateMenuItemEmbeddings skipped:', e?.message || e);
  }

  return full;
}

/**
 * Soft-delete блюда (is_active=false)
 */
export async function deleteMenuItemSoft({ restaurant_id, id }) {
  if (!restaurant_id) throw new Error('restaurant_id is required');
  if (!id) throw new Error('id is required');
  return deactivateMenuItemById(restaurant_id, id);
}
