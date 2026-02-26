// src/services/adminService.js
import {
  fetchFraudOrders,
  fetchOrdersAggregate,
  fetchUpsellShownCount,
  fetchUpsellAcceptedCount,
  fetchEmotionAnalyticsRows,
  fetchUpsellStatsByItem,
  fetchSessionsForRestaurant,
  fetchOrdersForRestaurant,
  fetchRecentDialogs,
  insertBadAnswer,
  insertSynonym,
  fetchSynonymsForRestaurant,
} from '../models/adminModel.js';



/**
 * Заказы с высоким risk_flag.
 */
export async function getFraudOrders(limit = 50) {
  // просто прокидываем к модели
  return fetchFraudOrders(limit);
}

/**
 * Сводная аналитика: заказы + upsell.
 */
export async function getSummaryAnalytics() {
  // 1) Общая статистика по заказам
  const ordersAgg = await fetchOrdersAggregate();

  // 2) Апселлы — параллельно
  const [upsellShown, upsellAccepted] = await Promise.all([
    fetchUpsellShownCount(),
    fetchUpsellAcceptedCount(),
  ]);

  const upsellConversion =
    upsellShown > 0 ? upsellAccepted / upsellShown : 0;

  return {
    orders: {
      count: ordersAgg.orders_count,
      avg_check: ordersAgg.avg_check,
      total_revenue: ordersAgg.total_revenue,
    },
    upsell: {
      shown: upsellShown,
      accepted: upsellAccepted,
      conversion: upsellConversion,
    },
  };
}

/**
 * Аналитика эмоций по дням.
 */
export async function getEmotionAnalytics() {
  return fetchEmotionAnalyticsRows();
}

export async function getUpsellStatsByItem(restaurantId) {
  return fetchUpsellStatsByItem(restaurantId);
}

/**
 * Список сессий для ресторана (админ-панель).
 */
export async function getSessionsForRestaurant(restaurantId, { onlyActive = true } = {}) {
  return fetchSessionsForRestaurant(restaurantId, { onlyActive });
}

/**
 * История заказов по ресторану (админ-панель).
 */
export async function getOrdersForRestaurant(
  restaurantId,
  { status = null, limit = 100 } = {}
) {
  return fetchOrdersForRestaurant(restaurantId, { status, limit });
}

/**
 * Последние диалоги для AI Training.
 */
export async function getRecentDialogs(limit = 50) {
  return fetchRecentDialogs(limit);
}

/**
 * Отметить "плохой ответ" (для последующего обучения AI).
 */
export async function markBadAnswer(payload) {
  await insertBadAnswer(payload);
}

/**
 * Добавить синоним.
 */
export async function addSynonym(payload) {
  await insertSynonym(payload);
}

/**
 * Получить синонимы по ресторану.
 */
export async function getSynonymsForRestaurant(restaurantId) {
  return fetchSynonymsForRestaurant(restaurantId);
}


