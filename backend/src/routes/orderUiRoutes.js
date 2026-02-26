// src/routes/orderUiRoutes.js
import express from 'express';
import { sessionAuth } from '../middleware/sessionAuth.js';
import { applyUiUpdateForSession } from '../services/orderUiService.js';
import { submitOrderForSession } from '../services/orderService.js';
import { sendOrderToTelegram } from '../services/telegramService.js';
import { logEvent } from '../services/eventService.js';
import { getChatUpsellSuggestion } from '../ai/recommendationService.js';
import { respondInLanguage } from '../ai/nlgService.js';
import { build as buildUpsellTextEn } from '../ai/trustTextBuilder.js';

import { getRestaurantSettings } from '../models/restaurantSettingsModel.js';
import { computeTimeContext, DEFAULT_DAYPARTS } from '../services/restaurantSettingsService.js';
import { getWeatherForRestaurant } from '../services/weatherService.js';
import { loadPersona } from '../services/aiPersonaService.js';

import { loadDeviceMemory } from '../ai/memoryService.js'; // если путь такой же как в dialogManager


export const orderUiRouter = express.Router();

// Все эндпоинты требуют x-session-token
orderUiRouter.use(sessionAuth);

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
}

  } catch (e) {
    console.error('[order/ui-update] upsell compute failed:', e);
    upsell = null;
  }
}

return res.json({ orderDraft, upsell });

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

    const order = await submitOrderForSession(session, order_id);

    // Логика отправки в Telegram сохранена
    await sendOrderToTelegram(order);

    await logEvent('order_submitted_ui', {
      session,
      deviceId: session.device_id,
      orderId: order.id,
      source: 'chat_ui',
    });

    return res.json({
      ok: true,
      orderId: order.id,
      status: order.status,
    });
  } catch (err) {
    console.error('Error in POST /order/submit', err);
    const code = err.code || 'INTERNAL_ERROR';
    let status = 500;

    if (code === 'VALIDATION_ERROR') status = 400;
    if (code === 'ORDER_NOT_FOUND' || code === 'ORDER_STATUS_INVALID') {
      status = 400;
    }

    return res.status(status).json({
      error: code,
      message: err.message || 'Internal server error',
    });
  }
});
