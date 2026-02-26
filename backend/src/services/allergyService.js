// src/services/allergyService.js
import { getMenuItemsWithAllergensByCodes } from '../models/menuModel.js';

/**
 * Проверяет, какие блюда пересекаются с аллергиями.
 *
 * @param {string} restaurantId
 * @param {string[]} itemCodes - массив кодов блюд (например ['SHRIMP_POPCORN'])
 * @param {string[]} allergies - массив аллергенов пользователя (например ['seafood', 'nuts'])
 *
 * Возвращает массив:
 * [
 *   {
 *     item_code,
 *     name_ua,
 *     name_en,
 *     allergens: [...],
 *     matched_allergens: [...],
 *     is_safe: boolean
 *   },
 *   ...
 * ]
 */
export async function checkAllergensForItems(restaurantId, itemCodes, allergies) {
  if (!restaurantId || !Array.isArray(itemCodes) || itemCodes.length === 0) {
    return [];
  }

  if (!Array.isArray(allergies) || allergies.length === 0) {
    // Аллергий нет – всё условно безопасно
    return [];
  }

  const lowerAllergies = allergies
    .map((a) => String(a || '').trim().toLowerCase())
    .filter((a) => a.length > 0);

  if (lowerAllergies.length === 0) return [];

  const rows = await getMenuItemsWithAllergensByCodes(restaurantId, itemCodes);

  const items = rows.map((row) => {
    const itemAllergens = Array.isArray(row.allergens) ? row.allergens : [];
    const normalizedItemAllergens = itemAllergens
      .map((a) => String(a || '').trim().toLowerCase())
      .filter((a) => a.length > 0);

    const matched = normalizedItemAllergens.filter((a) =>
      lowerAllergies.includes(a)
    );

    return {
      item_code: row.item_code,
      name_ua: row.name_ua,
      name_en: row.name_en,
      allergens: itemAllergens,
      matched_allergens: matched,
      is_safe: matched.length === 0,
    };
  });

  return items;
}

