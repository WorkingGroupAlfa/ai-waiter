// src/routes/chatRoutes.js
import express from 'express';
import { sendError } from '../utils/errors.js';
import { handleUserMessage } from '../ai/dialogManager.js';
import { insertPerformanceMetric } from '../models/performanceMetricsModel.js';
import { translateFromEnglish } from '../ai/translationService.js';
import { getSessionByToken } from '../services/sessionService.js';
import { countDeviceEventsInWindow } from '../models/eventsModel.js';


export const chatRouter = express.Router();
const MAX_MESSAGES_PER_HOUR = Number(process.env.CHAT_MAX_MESSAGES_PER_HOUR || 30);
const CHAT_WINDOW_SECONDS = 3600;
const MAX_INPUT_CHARS = Number(process.env.CHAT_MAX_INPUT_CHARS || 900);
const MAX_INPUT_TOKENS_EST = Number(process.env.CHAT_MAX_INPUT_TOKENS_EST || 350);
const RATE_LIMIT_TEXT_RU =
  'Вы отправили слишком много сообщений. Попробуйте снова немного позже.';
const localRateFallback = new Map();

function estimateTokenCount(text) {
  const src = String(text || '');
  if (!src.trim()) return 0;
  // Rough estimate across Latin/Cyr/CJK: words + punctuation chunks.
  const chunks = src.match(/[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) || [];
  return chunks.length;
}

function hitLocalRateFallback(deviceId) {
  if (!deviceId) return false;
  const now = Date.now();
  const bucket = Math.floor(now / CHAT_WINDOW_SECONDS / 1000);
  const key = `${deviceId}:${bucket}`;
  const state = localRateFallback.get(key) || { count: 0, ts: now };
  state.count += 1;
  state.ts = now;
  localRateFallback.set(key, state);

  // Best-effort cleanup.
  if (localRateFallback.size > 2000) {
    for (const [k, v] of localRateFallback.entries()) {
      if (!v?.ts || now - v.ts > CHAT_WINDOW_SECONDS * 2000) {
        localRateFallback.delete(k);
      }
    }
  }
  return state.count > MAX_MESSAGES_PER_HOUR;
}

chatRouter.get('/welcome', async (req, res) => {
  // 1) берем язык клиента: query приоритетнее
  const clientLanguage =
    (req.query?.client_language || req.query?.lang || '').toString().trim() ||
    // fallback: Accept-Language
    (req.headers['accept-language'] || '')
      .toString()
      .split(',')[0]
      .split('-')[0]
      .trim() ||
    'en';

  // 2) базовый EN-текст (без LLM-диалога!)
  const welcomeEn =
    "Hi! I’m your AI waiter. Ask me about the menu, or tell me what you’d like to order.";

  // 3) перевод через существующий translationService (fallback на EN уже внутри)
  try {
    const translated = await translateFromEnglish(welcomeEn, clientLanguage);
    return res.json({
      text: (translated || welcomeEn).toString(),
      language: clientLanguage,
    });
  } catch (err) {
    console.error('[GET /chat/welcome] error:', err);
    return res.json({ text: welcomeEn, language: 'en' });
  }
});

chatRouter.get('/greeting', async (req, res) => {
  // язык клиента: query приоритетнее, потом Accept-Language
  const clientLanguage =
    (req.query?.client_language || req.query?.lang || '').toString().trim() ||
    (req.headers['accept-language'] || '')
      .toString()
      .split(',')[0]
      .split('-')[0]
      .trim() ||
    'en';

  // daypart приходит с фронта (ВАЖНО: именно локальное время устройства)
  const daypartRaw = (req.query?.daypart || '').toString().trim().toLowerCase();
  const daypart =
    daypartRaw === 'morning' || daypartRaw === 'day' || daypartRaw === 'evening'
      ? daypartRaw
      : 'day';

  // базовый EN-текст (дальше переводим как welcome1)
  const greetingEn =
  daypart === 'morning'
    ? 'Good morning! How can I help you today?'
    : daypart === 'evening'
      ? 'Good evening! How can I help you today?'
      : 'Good afternoon! How can I help you today?';


  try {
    const translated = await translateFromEnglish(greetingEn, clientLanguage);
    return res.json({
      text: (translated || greetingEn).toString(),
      language: clientLanguage,
      daypart,
    });
  } catch (err) {
    console.error('[GET /chat/greeting] error:', err);
    return res.json({ text: greetingEn, language: 'en', daypart });
  }
});


// UI strings for widget chrome (placeholder/buttons/labels).
// Frontend asks once on init, using client_language like welcome message.
// We try to avoid LLM calls where possible: use built-in dictionaries for ru/uk/en,
// and fallback to translateFromEnglish for any other language.
const UI_TEXTS_EN = {
  input_placeholder: 'Message…',
  mini_subtotal: 'Subtotal',
  cart_title: 'Cart',
  cart_close_aria: 'Close',
  cart_remove: 'Remove',
  cart_submit: 'Send to kitchen',
  quick_bill_title: 'Ask for the bill?',
  quick_waiter_title: 'Call a waiter?',
  quick_confirm_label: 'I confirm sending',
  quick_send: 'Send',
  quick_cancel: 'Cancel',
  qty_unit_short: 'pcs.',
  mini_cart_empty: 'Cart is empty',
    // system messages
  sys_order_sent_tg: 'Order sent.',
  sys_quick_sending: '⏳ Sending: {label}…',
  sys_quick_sent_tg: '✅ Sent: {label}.',
  sys_quick_failed: '❌ Failed to send: {label}.',
  quick_action_waiter_label: 'Call a waiter',
  quick_action_bill_label: 'Request the bill',
};

const UI_TEXTS_UK = {
  input_placeholder: 'Повідомлення…',
  mini_subtotal: 'Разом',
  cart_title: 'Кошик',
  cart_close_aria: 'Закрити',
  cart_remove: 'Видалити',
  cart_submit: 'Відправити на кухню',
  quick_bill_title: 'Попросити рахунок?',
  quick_waiter_title: 'Викликати офіціанта?',
  quick_confirm_label: 'Підтверджую відправку',
  quick_send: 'Відправити',
  quick_cancel: 'Скасувати',
  qty_unit_short: 'шт.',
  mini_cart_empty: 'Кошик порожній',
  sys_order_sent_tg: 'Замовлення відправлено.',
  sys_quick_sending: '⏳ Відправляю: {label}…',
  sys_quick_sent_tg: '✅ Відправлено: {label}.',
  sys_quick_failed: '❌ Не вдалося відправити: {label}.',
  // quick action labels
  quick_action_waiter_label: 'Виклик офіціанта',
  quick_action_bill_label: 'Запит рахунку',
};

const UI_TEXTS_RU = {
  input_placeholder: 'Сообщение…',
  mini_subtotal: 'Итого',
  cart_title: 'Корзина',
  cart_close_aria: 'Закрыть',
  cart_remove: 'Удалить',
  cart_submit: 'Отправить на кухню',
  quick_bill_title: 'Попросить счёт?',
  quick_waiter_title: 'Вызвать официанта?',
  quick_confirm_label: 'Подтверждаю отправку',
  quick_send: 'Отправить',
  quick_cancel: 'Отмена',
  qty_unit_short: 'шт.',
  mini_cart_empty: 'Корзина пуста',
  sys_order_sent_tg: 'Заказ отправлен',
  sys_quick_sending: '⏳ Отправляю: {label}…',
  sys_quick_sent_tg: '✅ Отправлено: {label}.',
  sys_quick_failed: '❌ Не удалось отправить: {label}.',
  quick_action_waiter_label: 'Вызов официанта',
  quick_action_bill_label: 'Запрос счёта',
};

// simple in-memory cache per language (process lifetime)
const uiTextsCache = new Map();

chatRouter.get('/ui-texts', async (req, res) => {
  const clientLanguage =
    (req.query?.client_language || req.query?.lang || '').toString().trim() ||
    (req.headers['accept-language'] || '')
      .toString()
     .split(',')[0]
      .split('-')[0]
      .trim() ||
    'en';

  const lang = clientLanguage.toLowerCase();

  // cache hit
  if (uiTextsCache.has(lang)) {
    return res.json({ language: lang, texts: uiTextsCache.get(lang) });
  }

  // fast paths for built-ins
  let base =
    lang === 'uk' ? UI_TEXTS_UK :
    lang === 'ru' ? UI_TEXTS_RU :
    lang === 'en' ? UI_TEXTS_EN :
    null;

  if (base) {
    uiTextsCache.set(lang, base);
    return res.json({ language: lang, texts: base });
  }

  // fallback: auto-translate from English key-by-key (small payload)
  try {
    const entries = Object.entries(UI_TEXTS_EN);

    const translatedPairs = await Promise.all(
      entries.map(async ([key, enVal]) => {
       // NOTE: translateFromEnglish already handles "no OpenAI" fallback (returns original).
        const tr = await translateFromEnglish(enVal, lang);
        return [key, (tr || enVal).toString()];
      })
    );

    const texts = Object.fromEntries(translatedPairs);
    uiTextsCache.set(lang, texts);
    return res.json({ language: lang, texts });
  } catch (err) {
    console.error('[GET /chat/ui-texts] error:', err);
    uiTextsCache.set(lang, UI_TEXTS_EN);
    return res.json({ language: 'en', texts: UI_TEXTS_EN });
  }
});



/**
 * POST /api/v1/chat/message
 * body: {
 *   session_token?: string;
 *   message?: string;
 *   text?: string;   // для обратной совместимости
 *   source?: string; // 'chat' | 'voice' | ...
 * }
 *
 * Также принимаем x-session-token из заголовка.
 */
chatRouter.post('/message', async (req, res) => {
  const httpStart = Date.now();
  const source = req.body?.source || 'chat';

  const sessionToken =
    req.headers['x-session-token'] ||
    req.body?.session_token ||
    null;

  const body = req.body || {};
  const rawText = (body.text ?? body.message ?? '').toString();
  const text = rawText.length > MAX_INPUT_CHARS ? rawText.slice(0, MAX_INPUT_CHARS) : rawText;
const clientLanguage = (
    body.client_language || 
    body.clientLanguage || 
    body.language || 
    body.locale || 
    req.headers['x-client-language'] || 
    '' 
  ).toString().trim() || null;


  // Базовая валидация
  if (!sessionToken) {
    await insertPerformanceMetric({
      metricName: 'http.chat.message',
      scope: 'chat',
      durationMs: Date.now() - httpStart,
      labels: {
        source,
        has_error: true,
        reason: 'SESSION_MISSING',
      },
      meta: {},
    });

    return sendError(res, 401, 'SESSION_REQUIRED', 'Session token is required');
  }

  if (!text.trim()) {
    await insertPerformanceMetric({
      metricName: 'http.chat.message',
      scope: 'chat',
      durationMs: Date.now() - httpStart,
      labels: {
        source,
        has_error: true,
        reason: 'EMPTY_MESSAGE',
      },
      meta: {},
    });

    return sendError(res, 400, 'EMPTY_MESSAGE', 'Message text is required');
  }

  if (estimateTokenCount(text) > MAX_INPUT_TOKENS_EST) {
    await insertPerformanceMetric({
      metricName: 'http.chat.message',
      scope: 'chat',
      durationMs: Date.now() - httpStart,
      labels: {
        source,
        has_error: true,
        reason: 'MESSAGE_TOO_LARGE',
      },
      meta: {},
    });
    return sendError(res, 400, 'MESSAGE_TOO_LARGE', 'Message is too large');
  }

  try {
    const session = await getSessionByToken(sessionToken);
    const deviceId = session?.device_id || null;

    if (deviceId) {
      let recentCount = 0;
      try {
        recentCount = await countDeviceEventsInWindow({
          deviceId,
          eventType: 'chat_message_in',
          windowSeconds: CHAT_WINDOW_SECONDS,
        });
      } catch (rateErr) {
        console.error('[chatRoutes] db rate-limit check failed, fallback to local map', rateErr);
        if (hitLocalRateFallback(deviceId)) {
          return res.status(429).json({ error: 'RATE_LIMITED', message: RATE_LIMIT_TEXT_RU });
        }
      }

      if (recentCount >= MAX_MESSAGES_PER_HOUR) {
        await insertPerformanceMetric({
          metricName: 'http.chat.message',
          scope: 'chat',
          durationMs: Date.now() - httpStart,
          labels: {
            source,
            has_error: true,
            reason: 'RATE_LIMITED',
          },
          meta: {},
        });
        return res.status(429).json({ error: 'RATE_LIMITED', message: RATE_LIMIT_TEXT_RU });
      }
    }
  } catch (rateCheckErr) {
    console.error('[chatRoutes] rate-limit precheck failed', rateCheckErr);
  }

  try {
    const result = await handleUserMessage({
      sessionToken,
      text,
      source,
      clientLanguage,
    });

    await insertPerformanceMetric({
      metricName: 'http.chat.message',
      scope: 'chat',
      durationMs: Date.now() - httpStart,
      labels: {
        source,
        has_error: false,
      },
      meta: {
        has_nlu: !!result?.nlu,
        has_order: !!result?.order,
      },
    });

return res.json({
  replyText: result.replyText,
  actions: result.actions ?? {},
  // дополнительная служебная инфа для фронта/отладки:
  nlu: result.nlu ?? null,
  order: result.order ?? null,         // legacy

  // Новые поля для нового UI:
  orderDraft: result.orderDraft ?? null,
  upsell: result.upsell ?? null,
  meta: result.meta ?? {},
  recommendations: result.recommendations ?? null,
});

  } catch (err) {
    console.error('Error in POST /chat/message', err);

    await insertPerformanceMetric({
      metricName: 'http.chat.message',
      scope: 'chat',
      durationMs: Date.now() - httpStart,
      labels: {
        source,
        has_error: true,
        reason: 'UNHANDLED_EXCEPTION',
      },
      meta: {
        errorMessage: err?.message || String(err),
      },
    });

    return sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});


