// src/models/sessionModel.js
import { query } from '../db.js';

/**
 * Создать новую сессию
 * (используется dev-start)
 */
export async function insertSession({ id, deviceId, restaurantId, tableId, expiresAt }) {
  const res = await query(
    `
    INSERT INTO sessions (
      id,
      device_id,
      restaurant_id,
      table_id,
      status,
      created_at,
      last_activity,
      expires_at
    )
    VALUES ($1, $2, $3, $4, 'active', NOW(), NOW(), $5)
    RETURNING
      id,
      device_id,
      restaurant_id,
      table_id,
      status,
      created_at,
      last_activity,
      expires_at
    `,
    [id, deviceId, restaurantId, tableId, expiresAt]
  );

  return res.rows[0];
}

/**
 * Найти сессию по её id (который ты используешь как session_token)
 * Используется:
 *  - /api/v1/session/me
 *  - sessionAuth middleware
 */
export async function findSessionById(sessionId) {
  const res = await query(
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
    WHERE id = $1
    `,
    [sessionId]
  );

  return res.rows[0] || null;
}

/**
 * Обновить last_activity у сессии
 * Используется в middleware/sessionAuth
 */
export async function updateSessionLastActivity(sessionId) {
  await query(
    `
    UPDATE sessions
    SET last_activity = NOW()
    WHERE id = $1
    `,
    [sessionId]
  );
}
