// src/models/eventsModel.js
import { query } from '../db.js';

/**
 * Вставка события в таблицу events.
 *
 * @param {object} params
 * @param {string} params.id         - UUID события
 * @param {string|null} params.sessionId
 * @param {string|null} params.deviceId
 * @param {string} params.eventType
 * @param {object} params.payload    - уже подготовленный JSON
 */
export async function insertEvent({ id, sessionId, deviceId, eventType, payload }) {
  await query(
    `
    INSERT INTO events (id, session_id, device_id, event_type, payload)
    VALUES ($1, $2, $3, $4, $5)
    `,
    [id, sessionId, deviceId, eventType, payload]
  );
}

/**
 * Count events for device within rolling time window.
 *
 * @param {object} params
 * @param {string} params.deviceId
 * @param {string} params.eventType
 * @param {number} params.windowSeconds
 * @returns {Promise<number>}
 */
export async function countDeviceEventsInWindow({
  deviceId,
  eventType,
  windowSeconds = 3600,
}) {
  if (!deviceId || !eventType) return 0;

  const seconds = Math.max(1, Number(windowSeconds) || 3600);
  const { rows } = await query(
    `
    SELECT COUNT(*)::int AS cnt
    FROM events
    WHERE device_id = $1
      AND event_type = $2
      AND created_at >= NOW() - ($3::int * INTERVAL '1 second')
    `,
    [deviceId, eventType, seconds]
  );

  return Number(rows?.[0]?.cnt || 0);
}
