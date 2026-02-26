// src/models/qrTokenModel.js
import { query } from '../db.js';

/**
 * Создать QR-токен.
 */
export async function insertQrToken({ token, restaurantId, tableId, expiresAt }) {
  const res = await query(
    `
    INSERT INTO qr_tokens (
      token,
      restaurant_id,
      table_id,
      expires_at
    )
    VALUES ($1, $2, $3, $4)
    RETURNING
      token,
      restaurant_id,
      table_id,
      created_at,
      expires_at,
      used_at
    `,
    [token, restaurantId, tableId, expiresAt]
  );

  return res.rows[0];
}

/**
 * Найти QR-токен по его строке.
 */
export async function findQrToken(token) {
  const res = await query(
    `
    SELECT
      token,
      restaurant_id,
      table_id,
      created_at,
      expires_at,
      used_at
    FROM qr_tokens
    WHERE token = $1
    `,
    [token]
  );

  return res.rows[0] || null;
}

/**
 * Пометить QR-токен как использованный.
 */
export async function markQrTokenUsed(token) {
  await query(
    `
    UPDATE qr_tokens
    SET used_at = NOW()
    WHERE token = $1
    `,
    [token]
  );
}
