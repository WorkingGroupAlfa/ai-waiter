// src/services/restaurantSettingsService.js
import { getSettings as getSettingsRow, updateSettings as updateSettingsRow } from '../models/restaurantSettingsModel.js';

export const DEFAULT_DAYPARTS = {
  breakfast: { start: '06:00', end: '11:00' },
  lunch: { start: '11:00', end: '16:00' },
  dinner: { start: '16:00', end: '22:00' },
  late: { start: '22:00', end: '06:00' }, // wraps to next day
};

export function mergeDayparts(dayparts) {
  if (!dayparts || typeof dayparts !== 'object') return DEFAULT_DAYPARTS;
  return {
    ...DEFAULT_DAYPARTS,
    ...dayparts,
  };
}

function parseHHMM(str) {
  if (typeof str !== 'string') return null;
  const m = str.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Compute time context in restaurant timezone.
 * Returns: { timezone, hour, day_of_week, daypart, local_iso }
 */
export function computeTimeContext(now = new Date(), timezone, dayparts = DEFAULT_DAYPARTS) {
  const tz = (timezone ?? '').toString().trim();
  if (!tz) return null;

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour12: false,
    }).formatToParts(now);

    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    const hour = Number(map.hour);
    const minute = Number(map.minute);
    const local_iso = `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}`;
    const minutes = (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0);
    const dow = map.weekday || null;

    const merged = mergeDayparts(dayparts);
    let daypart = null;
    for (const [name, win] of Object.entries(merged)) {
      const start = parseHHMM(win?.start);
      const end = parseHHMM(win?.end);
      if (start === null || end === null) continue;

      if (start < end) {
        if (minutes >= start && minutes < end) daypart = name;
      } else {
        // wraps midnight
        if (minutes >= start || minutes < end) daypart = name;
      }
      if (daypart) break;
    }

    return {
      timezone: tz,
      hour: Number.isFinite(hour) ? hour : null,
      day_of_week: dow,
      daypart,
      local_iso,
    };
  } catch {
    return null;
  }
}

export async function getSettings(restaurantId) {
  const row = await getSettingsRow(restaurantId);
  if (!row) return null;

  return {
    ...row,
    dayparts: mergeDayparts(row.dayparts),
  };
}

export async function updateSettings(restaurantId, patch) {
  const normalizedPatch = { ...(patch || {}) };
  if (normalizedPatch.dayparts) {
    normalizedPatch.dayparts = mergeDayparts(normalizedPatch.dayparts);
  }
  const row = await updateSettingsRow(restaurantId, normalizedPatch);
  return row ? { ...row, dayparts: mergeDayparts(row.dayparts) } : null;
}
