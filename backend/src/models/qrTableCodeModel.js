import { query } from '../db.js';

export async function upsertQrTableCode({ restaurantId, tableId, tableCode }) {
  const res = await query(
    `
    INSERT INTO qr_table_codes (
      restaurant_id,
      table_id,
      table_code,
      is_active
    )
    VALUES ($1, $2, $3, TRUE)
    ON CONFLICT (restaurant_id, table_id)
    DO UPDATE SET
      table_code = EXCLUDED.table_code,
      is_active = TRUE,
      updated_at = NOW()
    RETURNING
      id,
      restaurant_id,
      table_id,
      table_code,
      is_active,
      created_at,
      updated_at
    `,
    [restaurantId, tableId, tableCode]
  );

  return res.rows[0] || null;
}

export async function findQrTableCodeByRestaurantAndTable({ restaurantId, tableId }) {
  const res = await query(
    `
    SELECT
      id,
      restaurant_id,
      table_id,
      table_code,
      is_active,
      created_at,
      updated_at
    FROM qr_table_codes
    WHERE restaurant_id = $1
      AND table_id = $2
    LIMIT 1
    `,
    [restaurantId, tableId]
  );
  return res.rows[0] || null;
}

export async function findActiveQrTableCode(tableCode) {
  const res = await query(
    `
    SELECT
      id,
      restaurant_id,
      table_id,
      table_code,
      is_active
    FROM qr_table_codes
    WHERE table_code = $1
      AND is_active = TRUE
    LIMIT 1
    `,
    [tableCode]
  );
  return res.rows[0] || null;
}

