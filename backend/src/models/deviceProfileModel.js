// src/models/deviceProfileModel.js
import { query } from '../db.js';

/**
 * Найти профиль устройства по device_id
 */
export async function findDeviceProfile(deviceId) {
  const res = await query(
    `
    SELECT
      device_id,
      first_seen,
      last_seen,
      allergies,
      behavior_tags,
      preferred_locale,
      preferred_voices
    FROM device_profiles
    WHERE device_id = $1
    `,
    [deviceId]
  );

  return res.rows[0] || null;
}

/**
 * Создать профиль устройства при первом визите
 */
export async function insertDeviceProfile(deviceId) {
  const res = await query(
    `
    INSERT INTO device_profiles (
      device_id,
      first_seen,
      last_seen,
      allergies,
      behavior_tags,
      preferred_locale,
      preferred_voices
    )
    VALUES (
      $1,
      NOW(),
      NOW(),
      '[]'::jsonb,
      '{}'::text[],
      'auto',
      '[]'::jsonb
    )
    ON CONFLICT (device_id)
    DO UPDATE SET
      last_seen = NOW()
    RETURNING
      device_id,
      first_seen,
      last_seen,
      allergies,
      behavior_tags,
      preferred_locale,
      preferred_voices
    `,
    [deviceId]
  );

  return res.rows[0];
}


/**
 * Обновить last_seen для устройства (если нужно отдельно)
 */
export async function updateDeviceLastSeen(deviceId) {
  await query(
    `
    UPDATE device_profiles
    SET last_seen = NOW()
    WHERE device_id = $1
    `,
    [deviceId]
  );
}

/**
 * Обновить сам профиль (например, аллергии и т.п.)
 * (на будущее, если уже есть/будут эндпоинты обновления)
 */
export async function updateDeviceProfile(
  deviceId,
  { allergies, behaviorTags, preferredLocale, preferredVoices }
) {
  // jsonb-поля должны всегда получать строковый JSON

  // allergies (jsonb)
  const allergiesValue =
    allergies === undefined
      ? null // значит "не трогать" (COALESCE оставит старое значение)
      : allergies === null
      ? '[]' // явно очищаем — пустой массив
      : typeof allergies === 'string'
      ? allergies // считаем, что это уже готовый JSON
      : JSON.stringify(allergies); // Array / Object -> JSON

  // preferred_voices (jsonb)
  const preferredVoicesValue =
    preferredVoices === undefined
      ? null
      : preferredVoices === null
      ? '[]'
      : typeof preferredVoices === 'string'
      ? preferredVoices
      : JSON.stringify(preferredVoices);

  const res = await query(
    `
    UPDATE device_profiles
    SET
      allergies = COALESCE($2, allergies),
      behavior_tags = COALESCE($3, behavior_tags),
      preferred_locale = COALESCE($4, preferred_locale),
      preferred_voices = COALESCE($5, preferred_voices),
      last_seen = NOW()
    WHERE device_id = $1
    RETURNING
      device_id,
      first_seen,
      last_seen,
      allergies,
      behavior_tags,
      preferred_locale,
      preferred_voices
    `,
    [
      deviceId,
      allergiesValue,
      behaviorTags ?? null,
      preferredLocale ?? null,
      preferredVoicesValue,
    ]
  );

  return res.rows[0] || null;
}
