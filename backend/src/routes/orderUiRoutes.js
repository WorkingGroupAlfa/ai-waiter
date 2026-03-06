// src/routes/orderUiRoutes.js
import express from 'express';
import { sessionAuth } from '../middleware/sessionAuth.js';
import { applyUiUpdateForSession } from '../services/orderUiService.js';
import { submitOrderForSession, getOrderForSession } from '../services/orderService.js';
import { sendOrderToTelegram } from '../services/telegramService.js';
import { logEvent } from '../services/eventService.js';
import { getChatUpsellSuggestion } from '../ai/recommendationService.js';
import { respondInLanguage } from '../ai/nlgService.js';
import { build as buildUpsellTextEn } from '../ai/trustTextBuilder.js';

import { getRestaurantSettings } from '../models/restaurantSettingsModel.js';
import { computeTimeContext, DEFAULT_DAYPARTS } from '../services/restaurantSettingsService.js';
import { getWeatherForRestaurant } from '../services/weatherService.js';
import { loadPersona } from '../services/aiPersonaService.js';
import {
  getLastUpsellForSession,
  setLastUpsellForSession,
  clearLastUpsellForSession,
} from '../services/dialogStateService.js';

import { loadDeviceMemory } from '../ai/memoryService.js'; // если путь такой же как в dialogManager


import { localizeUiPayloadBatch } from '../i18n/runtimeUiLocalization.js';

export const orderUiRouter = express.Router();

// Все эндпоинты требуют x-session-token
orderUiRouter.use(sessionAuth);

function normalizeMlMeta(raw) {
  const src =
    (raw && typeof raw === 'object'
      ? raw.ml || raw.strategy || raw
      : null) || {};

  const strategy =
    src.strategy || src.name || src.strategy_name || 'ml_bandit';
  const model_version = src.model_version || src.modelVersion || 'heuristic_v1';
  const epsilon = Number.isFinite(Number(src.epsilon))
    ? Number(src.epsilon)
    : null;
  const picked_by = src.picked_by || src.pickedBy || null;

  return { strategy, model_version, epsilon, picked_by };
}

async function resolveUiLanguage({ payload, session }) {
  const payloadLang = String(
    payload?.language || payload?.client_language || ''
  )
    .trim()
    .toLowerCase();
  if (payloadLang) return payloadLang;

  try {
    const memory = await loadDeviceMemory(session?.device_id || null);
    const memoryLang = String(memory?.languagePreferences?.primary || '')
      .trim()
      .toLowerCase();
    if (memoryLang) return memoryLang;
  } catch (err) {
    console.error('[order/ui-update] resolveUiLanguage failed:', err);
  }

  return 'en';
}

/**
 * POST /api/v1/order/ui-update
 * body:
 *   либо одна операция:
 *     { type, order_item_id?, item_code?, menu_item_id?, quantity? }
 *   либо:
 *     { operations: [ { ... }, { ... } ] }
 */
orderUiRouter.post('/ui-update', async (req, res) => {
  try {
    const session = req.session;
    const payload = req.body || {};

    const orderDraft = await applyUiUpdateForSession(session, payload);

// --- Upsell for UI updates (cart-first flow) ---
let upsell = null;

const ops = Array.isArray(payload.operations)
  ? payload.operations
  : (payload && payload.type ? [payload] : []);

const isAddLikeOp = (op) => {
  const t = String(op?.type || '').toLowerCase();
  // подстрой под свои реальные названия операций в applyUiUpdateForSession()
  return (
    t === 'add_item' ||
    t === 'set' ||
    t === 'add' ||
    t === 'inc' ||
    t === 'increase' ||
    t === 'set_qty' // но только если quantity выросло — см. ниже
  );
};

// Пытаемся апселлить только если это добавление (или увеличение)
// Track accept when user adds the last shown upsell via UI (+ button).
try {
  const lastUpsell = await getLastUpsellForSession(session.id);
  const lastCode = String(lastUpsell?.last_upsell_code || '').trim().toUpperCase();
  if (lastCode && orderDraft?.id) {
    const acceptedViaUi = ops.some((op) => {
      if (!isAddLikeOp(op)) return false;
      const q = Number(op?.quantity);
      if (Number.isFinite(q) && q <= 0) return false;
      const code = String(op?.item_code || op?.code || '').trim().toUpperCase();
      return Boolean(code) && code === lastCode;
    });

    if (acceptedViaUi) {
      const mlAccepted = normalizeMlMeta({
        strategy: lastUpsell?.last_upsell_strategy,
        model_version: lastUpsell?.last_upsell_model_version,
        epsilon: lastUpsell?.last_upsell_epsilon,
        picked_by: lastUpsell?.last_upsell_picked_by,
      });

      await logEvent(
        'upsell_accepted',
        { session, deviceId: session.device_id },
        {
          restaurant_id: session.restaurant_id,
          device_id: session.device_id,
          session_id: session.id || null,
          order_id: orderDraft.id,
          upsell_event_id: lastUpsell?.last_upsell_event_id || null,
          position_in_flow: lastUpsell?.last_upsell_position || null,
          suggested_item_code: lastUpsell?.last_upsell_code || null,
          suggested_item_name: lastUpsell?.last_upsell_item_name || lastUpsell?.last_upsell_code || null,
          reason_code: lastUpsell?.last_upsell_reason_code || null,
          language: lastUpsell?.last_upsell_language || payload?.language || 'en',
          emotion: lastUpsell?.last_upsell_emotion || payload?.emotion || 'neutral',
          ml: mlAccepted,
          strategy: mlAccepted.strategy,
          model_version: mlAccepted.model_version,
          epsilon: mlAccepted.epsilon,
          picked_by: mlAccepted.picked_by,
          source: 'ui_update_add',
        }
      );

      await clearLastUpsellForSession(session.id);
    }
  }
} catch (e) {
  console.error('[order/ui-update] upsell accept tracking failed:', e);
}

const shouldTryUpsell = ops.some(isAddLikeOp);

if (shouldTryUpsell && orderDraft && orderDraft.status === 'draft') {
  try {
    // deviceMemory (allergies/favorites) — чтобы не предлагать запрещённое
    const deviceId = session.device_id;
    const deviceMemory = await loadDeviceMemory(deviceId);

    let settings = null;
    try {
      settings = await getRestaurantSettings(session.restaurant_id);
    } catch (_) {
      settings = null;
    }

    const timeCtx = computeTimeContext(
      new Date(),
      settings?.timezone || null,
      settings?.dayparts || DEFAULT_DAYPARTS
    );

    let weather = null;
    const weatherEnabled = Boolean(settings?.weather_enabled);
    const hasCoords =
      settings &&
      Number.isFinite(Number(settings.lat)) &&
      Number.isFinite(Number(settings.lon));

    if (weatherEnabled && hasCoords) {
      try {
        weather = await getWeatherForRestaurant({
          lat: Number(settings.lat),
          lon: Number(settings.lon),
          ttlSeconds:
            Number.isFinite(Number(settings?.weather_cache_ttl_seconds))
              ? Number(settings.weather_cache_ttl_seconds)
              : 600,
        });
      } catch (_) {
        weather = null;
      }
    }

    let persona = null;
    try {
      persona = await loadPersona(session.restaurant_id);
    } catch (_) {
      persona = null;
    }

    const language = payload?.language || 'en'; // или передавай client_language с фронта сюда
    const emotionVal = payload?.emotion || 'neutral';

    const upsellPack = await getChatUpsellSuggestion({
      order: orderDraft,
      session,
      deviceId,
      deviceMemory,
      allergies: deviceMemory?.allergies || [],
      limitTopN: 3,
      context: {
        time_ctx: timeCtx,
        weather,
        emotion: emotionVal,
        language,
        epsilon: settings?.upsell_default_epsilon,
        channel: 'ui', // важно, чтобы правила могли отличать канал
      },
    });

const picked = upsellPack?.picked || null;

// 1) Собираем up to 3 items из upsellPack.top (он уже отсортирован)
const orderedSet = new Set(
  (orderDraft?.items || [])
    .map((it) => String(it?.code || '').toUpperCase())
    .filter(Boolean)
);

const top = Array.isArray(upsellPack?.top) ? upsellPack.top : [];
const maxItems = 3;

const items = [];
const seen = new Set();

for (const c of top) {
  const code = c?.item_code || c?.itemCode || null;
  if (!code) continue;

  const up = String(code).toUpperCase();
  if (orderedSet.has(up)) continue;     // не предлагать то, что уже в корзине
  if (seen.has(up)) continue;           // без дублей

  seen.add(up);

  const name =
    c?.item_name ||
    c?.itemName ||
    code;

  items.push({ code, name });

  if (items.length >= maxItems) break;
}

// 2) Фолбэк: если top пустой, но picked есть — добавим picked
const pickedCode = picked?.item_code || null;
const pickedUp = pickedCode ? String(pickedCode).toUpperCase() : null;

if (items.length === 0 && pickedCode && !orderedSet.has(pickedUp)) {
  items.push({ code: pickedCode, name: picked?.item_name || pickedCode });
}

// 3) Если после фильтров всё пусто — апсел не показываем
if (items.length) {
  // "главный" item для текста (чтобы текст соответствовал первой карточке)
  const primary = items[0];

  const intent =
    typeof picked?.message_intent === 'string' && picked.message_intent.trim()
      ? picked.message_intent
      : 'pairing_suggestion';

  const slots = {
    ...(picked?.message_slots || {}),
    upsell_item_name: primary?.name || primary?.code,
    time_ctx: timeCtx,
    weather,
  };

  const upsellTextEn =
    upsellPack?.text_en ||
    upsellPack?.text ||
    buildUpsellTextEn({
      intent,
      slots,
      persona,
      emotion: emotionVal,
      language,
    });

  const upsellText = await respondInLanguage({
    baseTextEn: upsellTextEn,
    targetLanguage: language,
  });

  upsell = {
    text: upsellText,
    items, // ✅ теперь 2–3 карточки
  };

  // Track shown in UI flow and persist it for future accept/reject linking.
  const ml = normalizeMlMeta(upsellPack?.ml ?? upsellPack?.strategy ?? upsellPack);
  const primaryCode = primary?.code || null;
  const primaryName = primary?.name || primaryCode;
  const primaryTop = top.find((c) => {
    const cCode = String(c?.item_code || c?.itemCode || '').trim().toUpperCase();
    return primaryCode && cCode === String(primaryCode).trim().toUpperCase();
  }) || picked || null;
  const reasonCode = primaryTop?.reason_code || null;

  const orderSnapshot = {
    item_codes: (orderDraft?.items || [])
      .map((it) => it?.code || it?.item_code)
      .filter(Boolean),
    total_price:
      typeof orderDraft?.totalAmount === 'number'
        ? orderDraft.totalAmount
        : parseFloat(orderDraft?.totalAmount || '0') || 0,
  };

  const shownEvent = await logEvent(
    'upsell_shown',
    { session, deviceId: deviceId ?? session.device_id },
    {
      restaurant_id: session.restaurant_id,
      device_id: deviceId ?? session.device_id,
      session_id: session.id || null,
      order_id: orderDraft?.id || null,
      suggested_item_code: primaryCode,
      suggested_item_name: primaryName,
      reason_code: reasonCode,
      language,
      emotion: emotionVal,
      strategy: ml.strategy,
      model_version: ml.model_version,
      epsilon: ml.epsilon,
      picked_by: ml.picked_by,
      ml,
      source: 'ui_update',
      channel: 'ui',
      top_candidates: top,
      picked: picked || null,
      order_snapshot: orderSnapshot,
      upsell_text_localized: upsellText,
    }
  );

  const prevLast = await getLastUpsellForSession(session.id);
  const nextPosition = (Number(prevLast?.last_upsell_position) || 0) + 1;

  await setLastUpsellForSession(session.id, {
    itemCode: primaryCode,
    itemName: primaryName,
    textEn: upsellTextEn || null,
    eventId: shownEvent?.id || null,
    position: nextPosition,
    strategy: ml.strategy,
    modelVersion: ml.model_version,
    reasonCode: reasonCode,
    language,
    emotion: emotionVal,
  });
}

  } catch (e) {
    console.error('[order/ui-update] upsell compute failed:', e);
    upsell = null;
  }
}

const targetLanguage = await resolveUiLanguage({ payload, session });
const localizedPayload = await localizeUiPayloadBatch({
  targetLanguage,
  replyText: '',
  orderDraft,
  upsell,
  recommendations: null,
  customCategories: [],
});

return res.json({
  orderDraft: localizedPayload.orderDraft,
  upsell: localizedPayload.upsell,
});

  } catch (err) {
    console.error('Error in POST /order/ui-update', err);
    const code = err.code || 'INTERNAL_ERROR';
    const status = code === 'VALIDATION_ERROR' ? 400 : 500;

    return res.status(status).json({
      error: code,
      message: err.message || 'Internal server error',
    });
  }
});

/**
 * POST /api/v1/order/submit
 * body: { order_id: "..." }
 *
 * Переводит заказ из draft в submitted и отправляет в Telegram.
 * Использует уже существующий submitOrderForSession + sendOrderToTelegram.
 */
orderUiRouter.post('/submit', async (req, res) => {
  try {
    const session = req.session;
    const { order_id } = req.body || {};

    if (!order_id) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'order_id is required',
      });
    }

    let order = null;
    let alreadySubmitted = false;

    try {
      order = await submitOrderForSession(session, order_id);
    } catch (submitErr) {
      if (submitErr?.code !== 'ORDER_NOT_DRAFT') {
        throw submitErr;
      }

      const existingOrder = await getOrderForSession(session, order_id);
      if (existingOrder?.status !== 'submitted') {
        throw submitErr;
      }

      order = existingOrder;
      alreadySubmitted = true;
    }

    if (!alreadySubmitted) {
      await sendOrderToTelegram(order);
    }

    await logEvent('order_submitted_ui', {
      session,
      deviceId: session.device_id,
      orderId: order.id,
      source: 'chat_ui',
      already_submitted: alreadySubmitted,
    });

    return res.json({
      ok: true,
      orderId: order.id,
      status: order.status,
      alreadySubmitted,
    });
  } catch (err) {
    console.error('Error in POST /order/submit', err);
    const code = err.code || 'INTERNAL_ERROR';
    let status = 500;

    if (code === 'VALIDATION_ERROR') status = 400;
    if (code === 'ORDER_NOT_FOUND' || code === 'ORDER_STATUS_INVALID') {
      status = 400;
    }
    if (code === 'ORDER_NOT_DRAFT') status = 409;

    return res.status(status).json({
      error: code,
      message: err.message || 'Internal server error',
    });
  }
});

