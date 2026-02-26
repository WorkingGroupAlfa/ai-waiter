// src/services/fraudService.js

import { calcOrderTotal, getOrderItemsForFraudCheck } from '../models/orderModel.js';
import { updateOrderRisk, getOrderRisk } from '../models/fraudModel.js';

/**
 * Посчитать риск заказа по очень простым правилам:
 * - слишком большое количество в одной позиции
 * - слишком большой суммарный объём позиций
 * - слишком большая общая сумма
 *
 * Никакого SQL здесь нет — только бизнес-логика.
 */
export async function calculateAndStoreOrderRisk(orderId) {
  // 1) Берём позиции заказа
  const items = await getOrderItemsForFraudCheck(orderId);

  let riskScore = 0;
  const reasons = [];

  if (!items || items.length === 0) {
    // пустой заказ сам по себе подозрителен, но не критично
    riskScore += 0.1;
    reasons.push('EMPTY_ORDER');
  }

  // 2) Проверяем количества
  let totalQuantity = 0;

  for (const row of items) {
    const q = Number(row.quantity) || 0;
    const price = Number(row.unit_price) || 0;

    totalQuantity += q;

    // Очень большое количество одной позиции
    if (q > 50) {
      riskScore += 0.8;
      reasons.push('SINGLE_ITEM_LARGE_QUANTITY');
    }

    // Очень дорогая позиция в большом количестве
    if (q > 10 && price > 1000) {
      riskScore += 0.5;
      reasons.push('HIGH_VALUE_ITEM_LARGE_QUANTITY');
    }
  }

  if (totalQuantity > 200) {
    riskScore += 0.7;
    reasons.push('TOTAL_QUANTITY_TOO_LARGE');
  }

  // 3) Проверяем общую сумму
  const totalAmount = await calcOrderTotal(orderId);

  if (Number(totalAmount) > 50000) {
    riskScore += 0.9;
    reasons.push('TOTAL_AMOUNT_VERY_HIGH');
  } else if (Number(totalAmount) > 20000) {
    riskScore += 0.5;
    reasons.push('TOTAL_AMOUNT_HIGH');
  }

  // 4) Нормализуем риск (просто ограничим 0..1)
  if (riskScore < 0) riskScore = 0;
  if (riskScore > 1) riskScore = 1;

  const riskFlag = riskScore >= 0.5;

  // 5) Сохраняем в orders через fraudModel
  await updateOrderRisk(orderId, riskScore, riskFlag);

  return {
    orderId,
    riskScore,
    riskFlag,
    reasons,
    totalAmount: Number(totalAmount) || 0,
    totalQuantity,
  };
}

/**
 * Получить сохранённый риск заказа (без пересчёта).
 */
export async function getStoredOrderRisk(orderId) {
  return getOrderRisk(orderId);
}


