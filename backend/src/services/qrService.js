// src/services/qrService.js
import { v4 as uuidv4 } from 'uuid';
import { insertQrToken, findQrToken, markQrTokenUsed } from '../models/qrTokenModel.js';
import { insertSession } from '../models/sessionModel.js';
import {
  upsertQrTableCode,
  findQrTableCodeByRestaurantAndTable,
  findActiveQrTableCode,
} from '../models/qrTableCodeModel.js';

function getPublicQrBaseUrl() {
  const raw =
    process.env.QR_PUBLIC_BASE_URL ||
    process.env.ASSISTANT_PUBLIC_URL ||
    process.env.FRONTEND_PUBLIC_URL ||
    '';

  if (raw && String(raw).trim()) return String(raw).trim();
  return 'https://mysite.com/assistant.html';
}

function buildQrUrl(paramName, paramValue) {
  const base = getPublicQrBaseUrl();
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}${encodeURIComponent(paramName)}=${encodeURIComponent(paramValue)}`;
}

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

  const qrUrl = buildQrUrl('qr_token', token);

  return {
    qr_token: qrRow.token,
    qr_url: qrUrl,
    restaurant_id: qrRow.restaurant_id,
    table_id: qrRow.table_id,
    expires_at: qrRow.expires_at.toISOString(),
  };
}

export async function createOrGetPersistentTableQr({
  restaurantId,
  tableId,
  rotate = false,
} = {}) {
  const existing = await findQrTableCodeByRestaurantAndTable({ restaurantId, tableId });
  const tableCode =
    !rotate && existing?.table_code ? String(existing.table_code) : uuidv4();

  const row = await upsertQrTableCode({
    restaurantId,
    tableId,
    tableCode,
  });

  return {
    table_code: row.table_code,
    qr_url: buildQrUrl('token', row.table_code),
    restaurant_id: row.restaurant_id,
    table_id: row.table_id,
    is_active: Boolean(row.is_active),
    created_at: row.created_at?.toISOString?.() || row.created_at || null,
    updated_at: row.updated_at?.toISOString?.() || row.updated_at || null,
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
  const now = new Date();
  const qr = await findQrToken(qrToken);

  if (!qr) {
    // Backward-compatible bridge for static printable table QR:
    // frontend still passes ?token=... into /qr/verify as qr_token.
    const mapped = await findActiveQrTableCode(qrToken);
    if (!mapped) return { status: 'NOT_FOUND' };

    const sessionId = uuidv4();
    const sessionExpiresAt = new Date(now.getTime() + sessionTtlHours * 60 * 60 * 1000);
    const sessionRow = await insertSession({
      id: sessionId,
      deviceId,
      restaurantId: mapped.restaurant_id,
      tableId: mapped.table_id,
      expiresAt: sessionExpiresAt,
    });

    return {
      status: 'OK',
      session: {
        session_token: sessionRow.id,
        device_id: sessionRow.device_id,
        restaurant_id: sessionRow.restaurant_id,
        table_id: sessionRow.table_id,
        expires_at: new Date(sessionRow.expires_at).toISOString(),
      },
      qr: null,
      table: {
        table_code: mapped.table_code,
        restaurant_id: mapped.restaurant_id,
        table_id: mapped.table_id,
      },
    };
  }

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

export async function issueSessionByTableCode({
  tableCode,
  deviceId,
  sessionTtlHours = 2,
}) {
  const row = await findActiveQrTableCode(tableCode);
  if (!row) return { status: 'NOT_FOUND' };

  const now = new Date();
  const sessionId = uuidv4();
  const expiresAt = new Date(now.getTime() + sessionTtlHours * 60 * 60 * 1000);

  const sessionRow = await insertSession({
    id: sessionId,
    deviceId,
    restaurantId: row.restaurant_id,
    tableId: row.table_id,
    expiresAt,
  });

  return {
    status: 'OK',
    session: {
      session_token: sessionRow.id,
      device_id: sessionRow.device_id,
      restaurant_id: sessionRow.restaurant_id,
      table_id: sessionRow.table_id,
      expires_at: new Date(sessionRow.expires_at).toISOString(),
    },
    table: {
      table_code: row.table_code,
      restaurant_id: row.restaurant_id,
      table_id: row.table_id,
    },
  };
}
