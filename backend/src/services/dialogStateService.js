// src/services/dialogStateService.js
import {
  upsertLastUpsell,
  getLastUpsellRow,
  clearLastUpsell,
  getDialogState as getDialogStateRow,
  upsertDialogState as upsertDialogStateRow,
  resetDialogState as resetDialogStateRow,
} from '../models/dialogStateModel.js';

/**
 * Сохранить последний апселл для сессии.
 */
export async function setLastUpsellForSession(sessionId, a, b, c) {
  // Новый формат: (sessionId, patchObject)
  if (a && typeof a === 'object') {
    await upsertLastUpsell(sessionId, a);
    return;
  }

  // Legacy формат: (sessionId, itemCode, itemName, textEn)
  // Поддержим временно, чтобы ничего не ломалось.
  const patch = {
    itemCode: a || null,
    itemName: b || null,
    textEn: c || null, // ⚠️ см. пункт ниже про textEn
  };

  await upsertLastUpsell(sessionId, patch);
}


/**
 * Получить последний апселл для сессии.
 */
export async function getLastUpsellForSession(sessionId) {
  return getLastUpsellRow(sessionId);
}

/**
 * Очистить последний апселл (после принятия или отказа).
 */
export async function clearLastUpsellForSession(sessionId) {
  await clearLastUpsell(sessionId);
}

/**
 * Получить dialog_state (включая last-focused item).
 */
export async function getDialogState(sessionId) {
  return getDialogStateRow(sessionId);
}

/**
 * Upsert dialog_state (патч по фокусу).
 */
export async function upsertDialogState(sessionId, patch) {
  await upsertDialogStateRow(sessionId, patch || {});
}

/**
 * Сбросить dialog_state (фокус).
 */
export async function resetDialogState(sessionId) {
  await resetDialogStateRow(sessionId);
}


