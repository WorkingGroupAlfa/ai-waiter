// src/services/sessionService.js
import { v4 as uuidv4 } from 'uuid';
import {
  insertSession,
  findSessionById,
  updateSessionLastActivity,
} from '../models/sessionModel.js';

/**
 * Старт dev-сессии (POST /api/v1/session/dev-start)
 *
 * ВАЖНО: формат ответа ДОЛЖЕН совпадать с тем, что у тебя был раньше:
 * {
 *   session_token,
 *   device_id,
 *   restaurant_id,
 *   table_id,
 *   expires_at
 * }
 */
export async function startDevSession({ restaurantId, tableId, deviceId }) {
  const sessionId = uuidv4();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 1000 * 60 * 60 * 2); // 2 часа

  const sessionRow = await insertSession({
    id: sessionId,
    deviceId,
    restaurantId,
    tableId,
    expiresAt,
  });

  return {
    session_token: sessionRow.id, // у тебя id == session_token
    device_id: sessionRow.device_id,
    restaurant_id: sessionRow.restaurant_id,
    table_id: sessionRow.table_id,
    // pg отдаёт Date — нормализуем к ISO-строке
    expires_at: new Date(sessionRow.expires_at).toISOString(),
  };
}

/**
 * Получить сессию по токену (используется /session/me и sessionAuth)
 */
export async function getSessionByToken(sessionToken) {
  return findSessionById(sessionToken);
}

/**
 * Обновить last_activity (используется в sessionAuth)
 */
export async function touchSession(sessionId) {
  await updateSessionLastActivity(sessionId);
}
