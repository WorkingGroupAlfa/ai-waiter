// src/models/fraudModel.js
import { query } from '../db.js';

/**
 * Обновить риск-заказа:
 *  - risk_score (число от 0 до 1, например)
 *  - risk_flag (boolean, подозрительный или нет)
 */
export async function updateOrderRisk(orderId, riskScore, riskFlag) {
  await query(
    `
    UPDATE orders
    SET
      risk_score = $2,
      risk_flag  = $3,
      updated_at = NOW()
    WHERE id = $1
    `,
    [orderId, riskScore, riskFlag]
  );
}

/**
 * Получить текущие значения риска для заказа.
 */
export async function getOrderRisk(orderId) {
  const res = await query(
    `
    SELECT risk_score, risk_flag
    FROM orders
    WHERE id = $1
    `,
    [orderId]
  );

  if (res.rowCount === 0) return null;
  return res.rows[0];
}
