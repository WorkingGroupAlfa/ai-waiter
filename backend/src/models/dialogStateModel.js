// src/models/dialogStateModel.js
// src/models/dialogStateModel.js
import { query } from '../db.js';

/**
 * Upsert последнего апселла для сессии.
 */
export async function upsertLastUpsell(sessionId, patch) {
  const {
    itemCode,
    itemName,
    textEn,
    eventId,
    position,
    strategy,
    modelVersion,
    reasonCode,
    language,
    emotion,
  } = patch || {};

  await query(
    `
    INSERT INTO dialog_state (
      session_id,
      last_upsell_code,
      last_upsell_item_name,
      last_upsell_text_en,
      last_upsell_created_at,
      last_upsell_event_id,
      last_upsell_position,
      last_upsell_strategy,
      last_upsell_model_version,
      last_upsell_reason_code,
      last_upsell_language,
      last_upsell_emotion
    )
    VALUES (
      $1,  $2,  $3,  $4,
      NOW(),
      $5,  COALESCE($6, 1),
      $7,  $8,  $9,  $10, $11
    )
    ON CONFLICT (session_id)
    DO UPDATE SET
      last_upsell_code = EXCLUDED.last_upsell_code,
      last_upsell_item_name = EXCLUDED.last_upsell_item_name,
      last_upsell_text_en = EXCLUDED.last_upsell_text_en,
      last_upsell_created_at = NOW(),
      last_upsell_event_id = EXCLUDED.last_upsell_event_id,
      last_upsell_position = EXCLUDED.last_upsell_position,
      last_upsell_strategy = EXCLUDED.last_upsell_strategy,
      last_upsell_model_version = EXCLUDED.last_upsell_model_version,
      last_upsell_reason_code = EXCLUDED.last_upsell_reason_code,
      last_upsell_language = EXCLUDED.last_upsell_language,
      last_upsell_emotion = EXCLUDED.last_upsell_emotion
    `,
    [
      sessionId,
      itemCode || null,
      itemName || null,
      textEn || null,
      eventId || null,
      Number.isFinite(position) ? position : 1,
      strategy || null,
      modelVersion || null,
      reasonCode || null,
      language || null,
      emotion || null,
    ]
  );
}



/**
 * Получить строку с последним апселлом для сессии.
 */
export async function getLastUpsellRow(sessionId) {
  const res = await query(
    `
    SELECT
        session_id,
  last_upsell_code,
  last_upsell_item_name,
  last_upsell_created_at,
  last_upsell_event_id,
  last_upsell_position,
  last_upsell_strategy,
  last_upsell_model_version,
  last_upsell_reason_code,
  last_upsell_language,
  last_upsell_emotion,
  last_upsell_text_en
    FROM dialog_state
    WHERE session_id = $1
    `,
    [sessionId]
  );

  return res.rows[0] || null;
}

/**
 * Очистить последний апселл (после принятия или отказа).
 */
export async function clearLastUpsell(sessionId) {
  await query(
    `
    UPDATE dialog_state
    SET last_upsell_code = NULL,
    last_upsell_item_name = NULL,
    last_upsell_text_en = NULL,
    last_upsell_event_id = NULL,
    last_upsell_position = 0,
    last_upsell_strategy = NULL,
    last_upsell_model_version = NULL,
    last_upsell_reason_code = NULL,
    last_upsell_language = NULL,
    last_upsell_emotion = NULL,
    last_upsell_created_at = NOW()

    WHERE session_id = $1
    `,
    [sessionId]
  );
}

/**
 * Получить полный dialog_state для сессии.
 */
export async function getDialogState(sessionId) {
  const res = await query(
    `
    SELECT
      session_id,
      last_upsell_code,
      last_upsell_item_name,
      last_upsell_created_at,
      last_focused_order_item_id,
      last_focused_menu_item_id,
      last_focused_item_code,
      last_focused_item_name
    FROM dialog_state
    WHERE session_id = $1
    `,
    [sessionId]
  );

  return res.rows[0] || null;
}

/**
 * Upsert фокуса (last-focused item).
 */
export async function upsertDialogState(
  sessionId,
  {
    lastFocusedOrderItemId,
    lastFocusedMenuItemId,
    lastFocusedItemCode,
    lastFocusedItemName,
  }
) {
  await query(
    `
    INSERT INTO dialog_state (
      session_id,
      last_focused_order_item_id,
      last_focused_menu_item_id,
      last_focused_item_code,
      last_focused_item_name
    )
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (session_id)
    DO UPDATE SET
      last_focused_order_item_id = EXCLUDED.last_focused_order_item_id,
      last_focused_menu_item_id = EXCLUDED.last_focused_menu_item_id,
      last_focused_item_code = EXCLUDED.last_focused_item_code,
      last_focused_item_name = EXCLUDED.last_focused_item_name
    `,
    [
      sessionId,
      lastFocusedOrderItemId || null,
      lastFocusedMenuItemId || null,
      lastFocusedItemCode || null,
      lastFocusedItemName || null,
    ]
  );
}

/**
 * Сбросить фокус (не трогая данные апселла).
 */
export async function resetDialogState(sessionId) {
  await query(
    `
    UPDATE dialog_state
    SET last_focused_order_item_id = NULL,
        last_focused_menu_item_id = NULL,
        last_focused_item_code = NULL,
        last_focused_item_name = NULL
    WHERE session_id = $1
    `,
    [sessionId]
  );
}
