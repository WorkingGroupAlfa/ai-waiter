// src/models/adminModel.js
import { query } from '../db.js';

/**
 * Заказы с высоким risk_flag.
 */
export async function fetchFraudOrders(limit = 50) {
  const { rows } = await query(
    `
    SELECT
      id,
      session_id,
      device_id,
      restaurant_id,
      table_id,
      status,
      total_amount,
      risk_score,
      risk_flag,
      created_at,
      submitted_at
    FROM orders
    WHERE risk_flag = TRUE
    ORDER BY created_at DESC
    LIMIT $1
    `,
    [limit]
  );

  return rows;
}

/**
 * Агрегаты по заказам (только submitted).
 */
export async function fetchOrdersAggregate() {
  const { rows } = await query(
    `
    SELECT
      COUNT(*)::int                         AS orders_count,
      COALESCE(AVG(total_amount), 0)::float AS avg_check,
      COALESCE(SUM(total_amount), 0)::float AS total_revenue
    FROM orders
    WHERE status = 'submitted'
    `
  );

  return rows[0] || {
    orders_count: 0,
    avg_check: 0,
    total_revenue: 0,
  };
}

/**
 * Количество показанных апселлов.
 */
export async function fetchUpsellShownCount() {
  const { rows } = await query(
    `
    SELECT COUNT(*)::int AS cnt
    FROM events
    WHERE event_type = 'upsell_shown'
    `
  );

  return rows[0]?.cnt ?? 0;
}

/**
 * Количество принятых апселлов.
 */
export async function fetchUpsellAcceptedCount() {
  const { rows } = await query(
    `
    SELECT COUNT(*)::int AS cnt
    FROM events
    WHERE event_type = 'upsell_accepted'
    `
  );

  return rows[0]?.cnt ?? 0;
}

/**
 * Аналитика эмоций по дням.
 */
export async function fetchEmotionAnalyticsRows() {
  const { rows } = await query(
    `
    SELECT
      DATE_TRUNC('day', created_at)::date AS day,
      payload->>'emotion'                 AS emotion,
      COUNT(*)::int                       AS count
    FROM events
    WHERE event_type = 'emotion_detected'
    GROUP BY day, emotion
    ORDER BY day DESC, count DESC
    `
  );

  return rows;
}

export async function fetchUpsellStatsByItem(restaurantId) {
  const { rows } = await query(
    `
    SELECT
      -- код блюда берём из suggested_item_code
      e_shown.payload->>'suggested_item_code' AS item_code,
      -- имя блюда из suggested_item_name (берём любое, например MAX)
      MAX(e_shown.payload->>'suggested_item_name') AS item_name,
      COUNT(e_shown.id)::int AS upsell_shown,
      COUNT(e_accepted.id)::int AS upsell_accepted,
      CASE
        WHEN COUNT(e_shown.id) = 0 THEN 0
        ELSE COUNT(e_accepted.id)::float / COUNT(e_shown.id)::float
      END AS conversion
    FROM events e_shown
    -- привязываем показ апсела к заказу
    LEFT JOIN orders o
      ON o.id::text = e_shown.payload->>'order_id'
    -- ищем события принятия апсела по тому же заказу и коду блюда
    LEFT JOIN events e_accepted
      ON e_accepted.event_type = 'upsell_accepted'
      AND e_accepted.payload->>'order_id' = e_shown.payload->>'order_id'
      AND e_accepted.payload->>'suggested_item_code' =
          e_shown.payload->>'suggested_item_code'
    WHERE e_shown.event_type = 'upsell_shown'
      AND o.restaurant_id = $1
    GROUP BY e_shown.payload->>'suggested_item_code'
    ORDER BY upsell_shown DESC
    `,
    [restaurantId]
  );

  return rows;
}



// ---- Sessions / Orders / AI Training (admin) ----

/**
 * Список сессий по ресторану.
 * Если onlyActive = true — фильтруем по status = 'active'.
 */
export async function fetchSessionsForRestaurant(restaurantId, { onlyActive = true } = {}) {
  const params = [restaurantId];
  let where = `restaurant_id = $1`;

  if (onlyActive) {
    params.push('active');
    where += ` AND status = $2`;
  }

  const { rows } = await query(
    `
    SELECT
      id,
      device_id,
      restaurant_id,
      table_id,
      status,
      created_at,
      last_activity,
      expires_at
    FROM sessions
    WHERE ${where}
    ORDER BY last_activity DESC
    LIMIT 200
    `,
    params
  );

  return rows;
}

/**
 * История заказов по ресторану.
 * Можно фильтровать по status (draft/submitted/...).
 */
export async function fetchOrdersForRestaurant(
  restaurantId,
  { status = null, limit = 100 } = {}
) {
  const params = [restaurantId];
  let where = `restaurant_id = $1`;

  if (status) {
    params.push(status);
    where += ` AND status = $${params.length}`;
  }

  const { rows } = await query(
    `
    SELECT
      id,
      session_id,
      device_id,
      restaurant_id,
      table_id,
      status,
      total_amount,
      created_at,
      submitted_at
    FROM orders
    WHERE ${where}
    ORDER BY created_at DESC
    LIMIT $${params.length + 1}
    `,
    [...params, limit]
  );

  return rows;
}

/**
 * Последние диалоги для AI Training.
 * Берём последние chat_message_out и просто показываем:
 * - текст бота (bot_reply)
 * - опциональный текст пользователя (если хранится в payload->>'user_text')
 */
export async function fetchRecentDialogs(limit = 50) {
  const { rows } = await query(
    `
    SELECT
      id AS out_event_id,
      session_id,
      device_id,
      -- если в payload нет user_text, будет NULL, это ок
      payload->>'user_text' AS user_text,
      payload->>'reply' AS bot_reply,
      created_at AS bot_time
    FROM events
    WHERE event_type = 'chat_message_out'
    ORDER BY created_at DESC
    LIMIT $1
    `,
    [limit]
  );

  return rows;
}


/**
 * Сохранить "плохой ответ" для последующего обучения.
 */
export async function insertBadAnswer({
  id,
  restaurantId,
  sessionId,
  deviceId,
  inEventId,
  outEventId,
  userText,
  botReply,
  comment,
}) {
  await query(
    `
    INSERT INTO ai_bad_answers (
      id,
      restaurant_id,
      session_id,
      device_id,
      in_event_id,
      out_event_id,
      user_text,
      bot_reply,
      comment
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `,
    [id, restaurantId, sessionId, deviceId, inEventId, outEventId, userText, botReply, comment]
  );
}

/**
 * Добавить синоним для дальнейшего использования в NLU/semanticMatcher (пока только храним).
 */
export async function insertSynonym({ id, restaurantId, locale, phrase, canonical }) {
  await query(
    `
    INSERT INTO ai_synonyms (
      id,
      restaurant_id,
      locale,
      phrase,
      canonical
    )
    VALUES ($1,$2,$3,$4,$5)
    `,
    [id, restaurantId, locale, phrase, canonical]
  );
}

/**
 * Получить список синонимов по ресторану.
 */
export async function fetchSynonymsForRestaurant(restaurantId) {
  const { rows } = await query(
    `
    SELECT
      id,
      restaurant_id,
      locale,
      phrase,
      canonical,
      created_at
    FROM ai_synonyms
    WHERE restaurant_id = $1
    ORDER BY created_at DESC
    `,
    [restaurantId]
  );

  return rows;
}


