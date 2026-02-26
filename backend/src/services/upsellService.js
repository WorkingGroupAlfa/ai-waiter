// src/services/upsellService.js
import { getDeviceAllergies } from './deviceProfileService.js';
import { checkAllergensForItems } from './allergyService.js';

/**
 * Получить список блюд, которые находятся в заказе.
 */
function getOrderedItemCodes(order) {
  if (!order || !order.items) return [];
  return order.items
    .map((it) => it.item_code)
    .filter((c) => typeof c === 'string' && c.length > 0);
}

/**
 * Базовая логика апселла — то, что у тебя уже есть.
 */
async function getRawUpsell(order) {
  const codes = getOrderedItemCodes(order);

  if (codes.includes('SHRIMP_POPCORN') && !codes.includes('LEMONADE')) {
    return {
      itemCode: 'LEMONADE',
      itemName: 'Lemonade',
      text:
        'Guests often order *Lemonade* together with *shrimp popcorn*. ' +
        'Would you like me to add it?',
    };
  }

  return null;
}

/**
 * Фильтруем апселл по аллергиям.
 */
export async function getUpsellSuggestionForOrder(order, deviceId, restaurantId) {
  const raw = await getRawUpsell(order);
  if (!raw) return null;

  // Если нет аллергий — возвращаем как есть
  const allergies = await getDeviceAllergies(deviceId);
  if (!allergies || allergies.length === 0) {
    return raw;
  }

  // Проверяем, безопасно ли рекомендовать raw.itemCode
  const check = await checkAllergensForItems(restaurantId, [raw.itemCode], allergies);
  const item = check[0];

  if (!item) return raw;

  if (item.is_safe === false) {
    // блюдо конфликтует с аллергиями — НЕ предлагаем
    return null;
  }

  return raw;
}
