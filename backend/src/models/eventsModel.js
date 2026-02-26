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
