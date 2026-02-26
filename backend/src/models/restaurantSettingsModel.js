// src/models/restaurantSettingsModel.js
import { query } from '../db.js';

/**
 * Returns restaurant_settings row or null.
 */
export async function getSettings(restaurantId) {
  const res = await query(
    `SELECT
        restaurant_id,
        timezone,
        lat,
        lon,
        weather_enabled,
        weather_provider,
        weather_cache_ttl_seconds,
        dayparts,
        upsell_max_per_session,
        upsell_min_gap_minutes,
        upsell_default_epsilon,
        created_at,
        updated_at
     FROM restaurant_settings
     WHERE restaurant_id = $1`,
    [restaurantId]
  );
  return res.rows[0] || null;
}

/**
 * Patch-update restaurant settings.
 * - Only keys present in patch are updated (including explicit null).
 * - Creates row if it doesn't exist yet.
 */
export async function updateSettings(restaurantId, patch = {}) {
  if (!restaurantId) throw new Error('restaurantId is required');

  const allowed = new Set([
    'timezone',
    'lat',
    'lon',
    'weather_enabled',
    'weather_provider',
    'weather_cache_ttl_seconds',
    'dayparts',
    'upsell_max_per_session',
    'upsell_min_gap_minutes',
    'upsell_default_epsilon',
  ]);

  const keys = Object.keys(patch || {}).filter(k => allowed.has(k));
  // Ensure row exists even if patch is empty
  if (keys.length === 0) {
    await query(
      `INSERT INTO restaurant_settings (restaurant_id)
       VALUES ($1)
       ON CONFLICT (restaurant_id) DO NOTHING`,
      [restaurantId]
    );
    return getSettings(restaurantId);
  }

  // Build INSERT ... ON CONFLICT ... DO UPDATE
  const cols = ['restaurant_id', ...keys];
  const placeholders = cols.map((_, i) => `$${i + 1}`);
  const values = [restaurantId, ...keys.map(k => patch[k])];

  // Sanitize numbers a bit (avoid NaN)
  const norm = (k, v) => {
    if (k === 'lat' || k === 'lon') {
      if (v === null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    if (k === 'weather_cache_ttl_seconds') {
      if (v === null) return null;
      const n = Math.floor(Number(v));
      return Number.isFinite(n) ? Math.max(30, Math.min(3600, n)) : null;
    }
    if (k === 'upsell_max_per_session') {
      if (v === null) return null;
      const n = Math.floor(Number(v));
      return Number.isFinite(n) ? Math.max(0, Math.min(20, n)) : null;
    }
    if (k === 'upsell_min_gap_minutes') {
      if (v === null) return null;
      const n = Math.floor(Number(v));
      return Number.isFinite(n) ? Math.max(0, Math.min(180, n)) : null;
    }
    if (k === 'upsell_default_epsilon') {
      if (v === null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : null;
    }
    if (k === 'weather_enabled') {
      return Boolean(v);
    }
    if (k === 'dayparts') {
      // allow object -> jsonb
      if (v === null) return null;
      if (typeof v === 'string') return v; // assume already JSON
      return v;
    }
    return v;
  };

  for (let i = 0; i < keys.length; i++) {
    values[i + 1] = norm(keys[i], values[i + 1]);
  }

  const updateSet = keys
    .map((k) => {
      if (k === 'dayparts') return `${k} = COALESCE(EXCLUDED.${k}, restaurant_settings.${k})`;
      return `${k} = EXCLUDED.${k}`;
    })
    .join(', ');

  await query(
    `INSERT INTO restaurant_settings (${cols.join(', ')})
     VALUES (${placeholders.join(', ')})
     ON CONFLICT (restaurant_id) DO UPDATE SET
       ${updateSet},
       updated_at = NOW()`,
    values
  );

  return getSettings(restaurantId);
}

// --- Backward-compatible exports (do not break existing code) ---
export async function getRestaurantSettings(restaurantId) {
  return getSettings(restaurantId);
}

// Legacy name: upsertRestaurantSettings({restaurantId, ...})
export async function upsertRestaurantSettings(args = {}) {
  const { restaurantId, restaurant_id, ...rest } = args || {};
  const id = restaurantId || restaurant_id;
  return updateSettings(id, rest);
}
