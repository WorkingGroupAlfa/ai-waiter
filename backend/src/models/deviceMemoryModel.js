// src/models/deviceMemoryModel.js
import { query } from '../db.js';

/**
 * Прочитать device_memory по device_id.
 */
export async function findDeviceMemory(deviceId) {
  const res = await query(
    `
    SELECT
      device_id,
      allergies,
      favorite_items,
      disliked_items,
      language_preferences,
      last_visit_at,
      created_at,
      updated_at
    FROM device_memory
    WHERE device_id = $1
    `,
    [deviceId]
  );

  return res.rows[0] || null;
}

/**
 * Upsert полной строки device_memory.
 * Ожидает уже собранные массивы/объекты.
 */
export async function upsertDeviceMemory(
  deviceId,
  {
    allergies,
    favoriteItems,
    dislikedItems,
    languagePreferences,
    lastVisitAt,
  }
) {
  // JSONB поля всегда отдаём как строковый JSON
  const allergiesJson =
    allergies === undefined || allergies === null
      ? '[]'
      : JSON.stringify(allergies);

  const languagePrefsJson =
    languagePreferences === undefined || languagePreferences === null
      ? '{}'
      : JSON.stringify(languagePreferences);

  const res = await query(
    `
    INSERT INTO device_memory (
      device_id,
      allergies,
      favorite_items,
      disliked_items,
      language_preferences,
      last_visit_at
    )
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (device_id)
    DO UPDATE SET
      allergies = EXCLUDED.allergies,
      favorite_items = EXCLUDED.favorite_items,
      disliked_items = EXCLUDED.disliked_items,
      language_preferences = EXCLUDED.language_preferences,
      last_visit_at = EXCLUDED.last_visit_at,
      updated_at = NOW()
    RETURNING
      device_id,
      allergies,
      favorite_items,
      disliked_items,
      language_preferences,
      last_visit_at,
      created_at,
      updated_at
    `,
    [
      deviceId,
      allergiesJson,                    // JSONB
      favoriteItems ?? [],              // UUID[]
      dislikedItems ?? [],              // UUID[]
      languagePrefsJson,                // JSONB
      lastVisitAt ?? new Date(),
    ]
  );

  return res.rows[0] || null;
}
