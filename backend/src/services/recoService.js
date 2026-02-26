// src/services/recoService.js
import { getActiveMenuItemsByCodes } from '../models/menuModel.js';

// Простые rule-based правила рекомендаций
// На этом этапе — минималка: с попкорном предлагаем лимонад.
const SIMPLE_RELATED_RULES = {
  SHRIMP_POPCORN: ['LEMONADE'],
  // сюда позже добавим стейк → вино, десерти → кава и т.д.
};

/**
 * Найти связанные блюда по коду(ам) для конкретного ресторана.
 *
 * @param {string} restaurantId
 * @param {string[]} itemCodes - коды исходных блюд
 * @param {number} limit - максимальное количество рекомендаций
 */
export async function getRelatedMenuItems(restaurantId, itemCodes, limit = 3) {
  if (!itemCodes || itemCodes.length === 0) {
    return [];
  }

  const relatedSet = new Set();

  for (const code of itemCodes) {
    const upper = String(code || '').toUpperCase().trim();
    const related = SIMPLE_RELATED_RULES[upper];
    if (Array.isArray(related)) {
      for (const r of related) {
        const rc = String(r || '').toUpperCase().trim();
        if (rc) {
          relatedSet.add(rc);
        }
      }
    }
  }

  const relatedCodes = Array.from(relatedSet);
  if (relatedCodes.length === 0) {
    return [];
  }

  const limitedCodes = relatedCodes.slice(0, limit);

  // Забираем сами блюда через модель
  const items = await getActiveMenuItemsByCodes(restaurantId, limitedCodes);

  return items;
}
