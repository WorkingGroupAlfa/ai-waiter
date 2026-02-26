// src/services/qrService.js
import { v4 as uuidv4 } from 'uuid';
import { insertQrToken, findQrToken, markQrTokenUsed } from '../models/qrTokenModel.js';
import { insertSession } from '../models/sessionModel.js';

/**
 * Создать одноразовый QR-токен для ресторана/стола.
 */
export async function createAdminQrToken({ restaurantId, tableId, ttlMinutes = 15 }) {
  const ttl = Number(ttlMinutes || 15);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttl * 60 * 1000);

  const token = uuidv4(); // как у тебя было — для dev ок

  const qrRow = await insertQrToken({
    token,
    restaurantId,
    tableId,
    expiresAt,
  });

  // В реале сюда можно вынести базовый URL в конфиг
  const qrUrl = `https://mysite.com/qr/${token}`;
  // Для dev: http://localhost:5501/assistant.html?qr=${token}

  return {
    qr_token: qrRow.token,
    qr_url: qrUrl,
    restaurant_id: qrRow.restaurant_id,
    table_id: qrRow.table_id,
    expires_at: qrRow.expires_at.toISOString(),
  };
}

/**
 * Проверить QR-токен и создать сессию для устройства.
 *
 * Возвращает объект:
 *  - { status: 'NOT_FOUND' }
 *  - { status: 'ALREADY_USED' }
 *  - { status: 'EXPIRED' }
 *  - { status: 'OK', session, qr }
 */
export async function verifyQrAndCreateSession({
  qrToken,
  deviceId,
  sessionTtlHours = 2,
}) {
  const qr = await findQrToken(qrToken);

  if (!qr) {
    return { status: 'NOT_FOUND' };
  }

  const now = new Date();

  if (qr.used_at) {
    return { status: 'ALREADY_USED' };
  }

  if (new Date(qr.expires_at) < now) {
    return { status: 'EXPIRED' };
  }

  // Помечаем токен как использованный
  await markQrTokenUsed(qrToken);

  // Создаём сессию так же, как в dev-start, но с TTL 2 часа
  const sessionId = uuidv4();
  const sessionExpiresAt = new Date(now.getTime() + sessionTtlHours * 60 * 60 * 1000);

  const sessionRow = await insertSession({
    id: sessionId,
    deviceId,
    restaurantId: qr.restaurant_id,
    tableId: qr.table_id,
    expiresAt: sessionExpiresAt,
  });

  const session = {
    session_token: sessionRow.id,
    device_id: sessionRow.device_id,
    restaurant_id: sessionRow.restaurant_id,
    table_id: sessionRow.table_id,
    expires_at: new Date(sessionRow.expires_at).toISOString(),
  };

  return {
    status: 'OK',
    session,
    qr,
  };
}
