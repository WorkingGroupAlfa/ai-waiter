// src/ai/memoryService.js
// Multi-Tier Memory Engine:
// - short-term: session-level dialog_state + текущий активный заказ
// - medium-term: заказы устройства за последние N дней
// - long-term: device_memory (аллергии, избранное, язык и т.п.)

import {
  getDialogState as getDialogStateService,
  upsertDialogState as upsertDialogStateService,
  resetDialogState as resetDialogStateService,
} from '../services/dialogStateService.js';
import {
  findActiveOrderForSession,
  findOrderItems,
  findRecentOrdersForDevice,
} from '../models/orderModel.js';
import {
  findDeviceMemory,
  upsertDeviceMemory,
} from '../models/deviceMemoryModel.js';
import {
  getDeviceProfile,
  getDeviceAllergies,
  updateDeviceProfile,
} from '../services/deviceProfileService.js';

// ---------- helpers ----------

function normalizeAllergies(list) {
  if (!list) return [];
  if (Array.isArray(list)) {
    return Array.from(
      new Set(
        list
          .map((a) => (a == null ? '' : String(a).trim().toLowerCase()))
          .filter(Boolean)
      )
    );
  }

  if (typeof list === 'string') {
    try {
      const parsed = JSON.parse(list);
      if (Array.isArray(parsed)) {
        return normalizeAllergies(parsed);
      }
    } catch (e) {
      const v = list.trim().toLowerCase();
      return v ? [v] : [];
    }
  }

  if (typeof list === 'object') {
    if (Array.isArray(list.items)) {
      return normalizeAllergies(list.items);
    }
  }

  return [];
}

function ensureUuidArray(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.filter((v) => typeof v === 'string' && v.length > 0);
}

function ensureJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === 'object' && parsed !== null ? parsed : fallback;
  } catch (e) {
    return fallback;
  }
}

// ---------- 1) short-term memory (session) ----------

/**
 * Загрузить short-term память сессии:
 *  - dialog_state
 *  - currentOrder (активный заказ с позициями)
 */
export async function loadSessionMemory(sessionId) {
  if (!sessionId) {
    return {
      dialogState: null,
      currentOrder: null,
    };
  }

  const [dialogState, activeOrder] = await Promise.all([
    getDialogStateService(sessionId),
    findActiveOrderForSession(sessionId),
  ]);

  let currentOrder = null;
  if (activeOrder) {
    const items = await findOrderItems(activeOrder.id);
    currentOrder = { ...activeOrder, items };
  }

  return {
    dialogState: dialogState || null,
    currentOrder,
  };
}

// ---------- 2) long-term memory (device_memory + device_profiles fallback) ----------

/**
 * Загрузить long-term память устройства.
 * Если device_memory ещё не создана — используем device_profiles как источник правды.
 */
export async function loadDeviceMemory(deviceId) {
  if (!deviceId) {
    return {
      allergies: [],
      favoriteItems: [],
      dislikedItems: [],
      languagePreferences: {},
      lastVisitAt: null,
    };
  }

  const row = await findDeviceMemory(deviceId);

  if (row) {
    return {
      allergies: normalizeAllergies(row.allergies),
      favoriteItems: ensureUuidArray(row.favorite_items),
      dislikedItems: ensureUuidArray(row.disliked_items),
      languagePreferences: ensureJson(row.language_preferences, {}),
      lastVisitAt: row.last_visit_at || null,
    };
  }

  // fallback: device_profiles
  const [profile, allergiesFromProfile] = await Promise.all([
    getDeviceProfile(deviceId, { createIfMissing: false }),
    getDeviceAllergies(deviceId),
  ]);

  const languagePreferences = {};
  if (profile && profile.preferred_locale) {
    languagePreferences.primary = profile.preferred_locale;
  }

  return {
    allergies: normalizeAllergies(allergiesFromProfile),
    favoriteItems: [],
    dislikedItems: [],
    languagePreferences,
    lastVisitAt: profile?.last_seen || null,
  };
}

/**
 * Обновить long-term память устройства.
 *
 * delta:
 *  - allergies: array<string> — полный новый список аллергий (вызывающий код сам решает,
 *    мержить или перезаписывать).
 *  - addFavoriteItemIds: array<UUID>
 *  - removeFavoriteItemIds: array<UUID>
 *  - addDislikedItemIds: array<UUID>
 *  - removeDislikedItemIds: array<UUID>
 *  - language: 'en' | 'ua' | 'ru' | ...
 *  - touchLastVisit: boolean — обновить last_visit_at на NOW()
 */
export async function updateDeviceMemory(deviceId, delta = {}) {
  if (!deviceId) return null;

  const existing = await findDeviceMemory(deviceId);

  const baseAllergies = existing ? normalizeAllergies(existing.allergies) : [];
  const baseFavorites = existing ? ensureUuidArray(existing.favorite_items) : [];
  const baseDisliked = existing ? ensureUuidArray(existing.disliked_items) : [];
  const baseLangPrefs = existing
    ? ensureJson(existing.language_preferences, {})
    : {};
  const baseLastVisit = existing?.last_visit_at || null;

  let allergies = baseAllergies;
  if (Array.isArray(delta.allergies)) {
    allergies = normalizeAllergies(delta.allergies);
  }

  let favoriteItems = baseFavorites.slice();
  if (Array.isArray(delta.addFavoriteItemIds)) {
    const toAdd = ensureUuidArray(delta.addFavoriteItemIds);
    const set = new Set(favoriteItems);
    for (const id of toAdd) set.add(id);
    favoriteItems = Array.from(set);
  }
  if (Array.isArray(delta.removeFavoriteItemIds) && favoriteItems.length > 0) {
    const removeSet = new Set(ensureUuidArray(delta.removeFavoriteItemIds));
    favoriteItems = favoriteItems.filter((id) => !removeSet.has(id));
  }

  let dislikedItems = baseDisliked.slice();
  if (Array.isArray(delta.addDislikedItemIds)) {
    const toAdd = ensureUuidArray(delta.addDislikedItemIds);
    const set = new Set(dislikedItems);
    for (const id of toAdd) set.add(id);
    dislikedItems = Array.from(set);
  }
  if (Array.isArray(delta.removeDislikedItemIds) && dislikedItems.length > 0) {
    const removeSet = new Set(ensureUuidArray(delta.removeDislikedItemIds));
    dislikedItems = dislikedItems.filter((id) => !removeSet.has(id));
  }

  let languagePreferences = { ...baseLangPrefs };
  if (delta.language) {
    const lang = String(delta.language).split('-')[0]; // 'en-US' -> 'en'
    languagePreferences = {
      ...languagePreferences,
      primary: lang,
      lastDetected: lang,
    };
  }

  const lastVisitAt =
    delta.touchLastVisit || !baseLastVisit ? new Date() : baseLastVisit;

  const row = await upsertDeviceMemory(deviceId, {
    allergies,
    favoriteItems,
    dislikedItems,
    languagePreferences,
    lastVisitAt,
  });

  // Для совместимости: если мы обновили allergies или language,
  // дублируем это в device_profiles.
  const profilePatch = {};
  if (Array.isArray(delta.allergies)) {
    profilePatch.allergies = allergies;
  }
  if (delta.language) {
    const lang = String(delta.language).split('-')[0];
    profilePatch.preferredLocale = lang;
  }
  if (Object.keys(profilePatch).length > 0) {
    await updateDeviceProfile(deviceId, profilePatch);
  }

  return {
    allergies,
    favoriteItems,
    dislikedItems,
    languagePreferences,
    lastVisitAt: row.last_visit_at || lastVisitAt,
  };
}

// ---------- 3) medium-term memory (recent orders 1–3 days) ----------

/**
 * Вернуть последние заказы устройства за windowDays дней (по умолчанию 3)
 * для medium-term контекста (NLU, рекомендации и т.п.).
 */
export async function getMediumTermContext(
  deviceId,
  { windowDays = 3, limit = 10 } = {}
) {
  if (!deviceId) return { orders: [] };

  const orders = await findRecentOrdersForDevice(deviceId, {
    days: windowDays,
    limit,
  });

  return { orders };
}

// ---------- Legacy re-exports для старого кода ----------
// (чтобы существующие импорты memoryService продолжили работать как раньше)
export { getDialogStateService as getDialogState };
export { upsertDialogStateService as upsertDialogState };
export { resetDialogStateService as resetDialogState };
