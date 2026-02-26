// src/services/eventService.js
import { v4 as uuidv4 } from 'uuid';
import { insertEvent } from '../models/eventsModel.js';

/**
 * Логирование событий в таблицу events.
 *
 * @param {string} eventType - тип события (chat_message_in, order_item_added, upsell_shown, ...)
 * @param {object} ctx       - контекст: { session?, sessionId?, deviceId? }
 * @param {object} payload   - произвольные данные (JSON)
 * @returns {object|undefined} { id, sessionId, deviceId, eventType, ts } либо undefined если некорректно
 */
export async function logEvent(eventType, ctx = {}, payload = {}) {
  if (!eventType || typeof eventType !== 'string') {
    return;
  }

  const session = ctx.session || null;

  const sessionId =
    ctx.sessionId ||
    (session && (session.id || session.session_id)) ||
    null;

  const deviceId =
    ctx.deviceId ||
    (session && session.device_id) ||
    null;

  // Базовый payload, который мы всегда хотим иметь
  const ts = new Date().toISOString();

  const basePayload = {
    ...payload,
    _meta: {
      ...(payload && payload._meta),
      ts,
    },
  };

  let finalPayload = basePayload;

  // На всякий случай не даём убить БД циклическими структурами
  try {
    JSON.stringify(basePayload);
  } catch (e) {
    finalPayload = {
      _meta: {
        ts,
        note: 'payload was not JSON-serializable; stored as stringified',
      },
      raw: String(payload),
    };
  }

    const id = uuidv4();

  try {
    await insertEvent({
      id,
      sessionId,
      deviceId,
      eventType,
      payload: finalPayload,
    });

    // ✅ ВАЖНО: вернуть id (чтобы потом связать accepted/rejected с shown)
    return { id };
  } catch (err) {
    console.error('[events] Failed to log event', eventType, err);
    return null;
  }

}

