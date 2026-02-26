// src/routes/adminRoutes.js
// src/routes/adminRoutes.js
import { getActiveMenuItemsByCodes } from '../models/menuModel.js';
import { invalidateSynonymsCache } from '../ai/semanticMatcher.js';
import express from 'express';
import {
  getFraudOrders,
  getSummaryAnalytics,
  getEmotionAnalytics,
  getUpsellStatsByItem,
  getUpsellAcceptanceByReasonCode,
  getUpsellAcceptanceBySourceKind,
  getUpsellSkipReasons,
  getSessionsForRestaurant,
  getOrdersForRestaurant,
  getRecentDialogs,
  markBadAnswer,
  addSynonym,
  getSynonymsForRestaurant,
} from '../services/adminService.js';
import adminUpsellRulesRoutes from './adminUpsellRulesRoutes.js';

import {
  listUpsellRules,
  createUpsellRule,
  updateUpsellRule,
  deleteUpsellRule,
  toggleUpsellRule,
  duplicateUpsellRule,
} from '../models/upsellRulesModel.js';

import adminAutoRelatedRoutes from "./adminAutoRelatedRoutes.js";

import { adminAuth } from '../middleware/adminAuth.js';
import { createOrUpdateMenuItemWithDetails } from '../services/menuAdminService.js';
import { rebuildEmbeddingsForRestaurant } from '../ai/embeddingService.js';
import { loadPersona, savePersona } from '../services/aiPersonaService.js';
import { getSettings as getRestaurantSettingsSvc, updateSettings as updateRestaurantSettingsSvc, DEFAULT_DAYPARTS } from '../services/restaurantSettingsService.js';
import { getChatUpsellSuggestion } from '../ai/recommendationService.js';
import { respondInLanguage } from '../ai/nlgService.js';
import { build as buildUpsellTextEn } from '../ai/trustTextBuilder.js';
import { getWeatherForRestaurant } from '../services/weatherService.js';
import { computeTimeContext } from '../services/restaurantSettingsService.js';
import crypto from 'crypto';


export const adminRouter = express.Router();
adminRouter.use('/upsell-rules', adminUpsellRulesRoutes);
adminRouter.use("/auto-related", adminAutoRelatedRoutes);


/**
 * GET /api/v1/admin/fraud/review
 * Список заказов с высоким risk_score / risk_flag = true
 */
adminRouter.get('/fraud/review', async (req, res) => {
  try {
    const orders = await getFraudOrders();
    return res.json({ orders });
  } catch (err) {
    console.error('Error in GET /admin/fraud/review', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/v1/admin/analytics/summary
 * Общая сводка по заказам/выручке.
 */
adminRouter.get('/analytics/summary', async (req, res) => {
  try {
    const summary = await getSummaryAnalytics();
    return res.json({ summary });
  } catch (err) {
    console.error('Error in GET /admin/analytics/summary', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/v1/admin/analytics/emotions
 * Распределение эмоций по дням
 */
adminRouter.get('/analytics/emotions', async (req, res) => {
  try {
    const emotions = await getEmotionAnalytics();
    return res.json({ emotions });
  } catch (err) {
    console.error('Error in GET /admin/analytics/emotions', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/v1/admin/menu/items
 * Создать/обновить блюдо с ингредиентами, аллергенами и фото.
 *
 * Требует заголовка x-admin-token с ADMIN_TOKEN.
 */
adminRouter.post('/menu/items', adminAuth, async (req, res) => {
  try {
    const item = await createOrUpdateMenuItemWithDetails(req.body || {});
    return res.json({ item });
  } catch (err) {
    console.error('Error in POST /admin/menu/items', err);
    return res.status(400).json({
      error: 'BAD_REQUEST',
      message: err.message || 'Invalid menu item payload',
    });
  }
});

/**
 * POST /api/v1/admin/menu/embeddings/rebuild
 * Перегенерация эмбеддингов для всех блюд ресторана.
 *
 * Body:
 * {
 *   restaurant_id: string,
 *   only_active?: boolean // по умолчанию true
 * }
 */
adminRouter.post('/menu/embeddings/rebuild', adminAuth, async (req, res) => {
  try {
    const restaurantId = req.body?.restaurant_id;
    const onlyActive =
      typeof req.body?.only_active === 'boolean'
        ? req.body.only_active
        : true;

    if (!restaurantId) {
      return res.status(400).json({
        error: 'BAD_REQUEST',
        message: 'restaurant_id is required',
      });
    }

    const result = await rebuildEmbeddingsForRestaurant(restaurantId, {
      onlyActive,
    });

    return res.json(result);
  } catch (err) {
    console.error('Error in POST /admin/menu/embeddings/rebuild', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

adminRouter.get('/analytics/upsell', adminAuth, async (req, res) => {
  try {
    const restaurantId = req.query?.restaurant_id;
    if (!restaurantId) {
      return res.status(400).json({
        error: 'restaurant_id is required',
      });
    }

    const stats = await getUpsellStatsByItem(restaurantId);
    return res.json({ stats });
  } catch (err) {
    console.error('Error in GET /admin/analytics/upsell', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});


adminRouter.get('/analytics/upsell-reason-codes', adminAuth, async (req, res) => {
  try {
    const restaurantId = req.query?.restaurant_id;
    if (!restaurantId) return res.status(400).json({ error: 'restaurant_id is required' });
    const rows = await getUpsellAcceptanceByReasonCode(restaurantId);
    return res.json({ rows });
  } catch (err) {
    console.error('Error in GET /admin/analytics/upsell-reason-codes', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

adminRouter.get('/analytics/upsell-source-kinds', adminAuth, async (req, res) => {
  try {
    const restaurantId = req.query?.restaurant_id;
    if (!restaurantId) return res.status(400).json({ error: 'restaurant_id is required' });
    const rows = await getUpsellAcceptanceBySourceKind(restaurantId);
    return res.json({ rows });
  } catch (err) {
    console.error('Error in GET /admin/analytics/upsell-source-kinds', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

adminRouter.get('/analytics/upsell-skip-reasons', adminAuth, async (req, res) => {
  try {
    const restaurantId = req.query?.restaurant_id;
    if (!restaurantId) return res.status(400).json({ error: 'restaurant_id is required' });
    const rows = await getUpsellSkipReasons(restaurantId);
    return res.json({ rows });
  } catch (err) {
    console.error('Error in GET /admin/analytics/upsell-skip-reasons', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});



/**
 * POST /api/v1/admin/upsell-simulate
 * Admin-only: run upsell pipeline without touching runtime (no events, no dialog_state).
 *
 * Body:
 * {
 *   restaurant_id: string,
 *   items: string[],              // item_code list
 *   language?: string,            // e.g. "en" | "ua" | "ru"
 *   emotion?: string,             // e.g. "neutral" | "angry" ...
 *   time_context_override?: object|null,
 *   weather_override?: object|null,
 *   epsilon_override?: number|null
 * }
 */
adminRouter.post('/upsell-simulate', adminAuth, async (req, res) => {
  try {
    const restaurantId = req.body?.restaurant_id;
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    const language = (req.body?.language || 'en').toString();
    const emotion = (req.body?.emotion || 'neutral').toString();

    const timeOverride = req.body?.time_context_override ?? null;
    const weatherOverride = req.body?.weather_override ?? null;

    const epsOverrideRaw = req.body?.epsilon_override;
    const epsilonOverride =
      typeof epsOverrideRaw === 'number' && Number.isFinite(epsOverrideRaw)
        ? Math.max(0, Math.min(1, epsOverrideRaw))
        : null;

    if (!restaurantId) {
      return res.status(400).json({ error: 'restaurant_id is required' });
    }
    if (!items.length) {
      return res.status(400).json({ error: 'items[] is required' });
    }

    // --- context: time/weather (with safe fallbacks) ---
    const settings = await getRestaurantSettingsSvc(restaurantId);

    const timeCtx =
      timeOverride && typeof timeOverride === 'object'
        ? timeOverride
        : computeTimeContext(new Date(), settings?.timezone, settings?.dayparts || DEFAULT_DAYPARTS);

    const weather =
      weatherOverride && typeof weatherOverride === 'object'
        ? weatherOverride
        : (Number.isFinite(Number(settings?.lat)) && Number.isFinite(Number(settings?.lon))
            ? await getWeatherForRestaurant({ lat: Number(settings.lat), lon: Number(settings.lon) })
            : null);

    // --- build minimal order/session mocks ---
    const order = {
      id: null,
      restaurant_id: restaurantId,
      items: items.map((code) => ({ item_code: String(code) })),
    };

    const session = {
      id: crypto.randomUUID?.() || 'admin_sim',
      restaurant_id: restaurantId,
      device_id: null,
    };

    const context = {
      channel: 'admin_sim',
      language,
      emotion,
      time_ctx: timeCtx,
      weather,
      ...(epsilonOverride !== null ? { epsilon: epsilonOverride } : {}),
    };

    const upsellPack = await getChatUpsellSuggestion({
      order,
      session,
      deviceId: null,
      deviceMemory: null,
      allergies: [],
      limitTopN: 5,
      context,
    });

    // message previews
    let message_preview_en = null;
    let message_preview_localized = null;

    if (upsellPack?.picked?.item_code) {
      const persona = await loadPersona(restaurantId);

      // best-effort base item name from the first order item
      const baseCode = items[0] ? String(items[0]) : null;
      let baseName = baseCode;

      if (baseCode) {
        const baseRows = await getActiveMenuItemsByCodes(restaurantId, [baseCode]);
        const r = Array.isArray(baseRows) && baseRows.length ? baseRows[0] : null;
        baseName = r?.name_en || r?.name_ua || baseCode;
      }

      const intent =
        typeof upsellPack?.picked?.message_intent === 'string' && upsellPack.picked.message_intent.trim()
          ? upsellPack.picked.message_intent
          : 'pairing_suggestion';

      const slots = {
        ...(upsellPack?.picked?.message_slots || {}),
        base_item_name: baseName,
        upsell_item_name: upsellPack?.picked?.item_name || upsellPack.picked.item_code,
        time_ctx: timeCtx,
        weather,
      };

      message_preview_en = buildUpsellTextEn({
        intent,
        slots,
        persona,
        emotion,
        language,
      });

      message_preview_localized = await respondInLanguage({
        baseTextEn: message_preview_en,
        targetLanguage: language,
      });
    }

    return res.json({
      features: upsellPack?.features ?? null,
      top: Array.isArray(upsellPack?.top) ? upsellPack.top : [],
      picked: upsellPack?.picked ?? null,
      strategy: upsellPack?.strategy ?? null,
      message_preview_en,
      message_preview_localized,
    });
  } catch (err) {
    console.error('Error in POST /admin/upsell-simulate', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});


/**
 * GET /api/v1/admin/ai/persona
 * Query: restaurant_id
 */
adminRouter.get('/ai/persona', adminAuth, async (req, res) => {
  try {
    const restaurantId = req.query?.restaurant_id;
    if (!restaurantId) {
      return res.status(400).json({ error: 'restaurant_id is required' });
    }

    const persona = await loadPersona(restaurantId);
    return res.json(persona);
  } catch (err) {
    console.error('Error in GET /admin/ai/persona', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /api/v1/admin/ai/persona
 * Body:
 * {
 *   restaurant_id, speech_rate, humor_level, tone, greeting, farewell
 * }
 */
adminRouter.put('/ai/persona', adminAuth, async (req, res) => {
  try {
    const {
      restaurant_id,
      speech_rate,
      humor_level,
      tone,
      greeting,
      farewell,
    } = req.body || {};

    if (!restaurant_id) {
      return res.status(400).json({ error: 'restaurant_id is required' });
    }

    const saved = await savePersona({
      restaurant_id,
      speech_rate: Number(speech_rate ?? 1.0),
      humor_level: Number(humor_level ?? 0.0),
      tone: tone || 'neutral',
      greeting: greeting || '',
      farewell: farewell || '',
    });

    return res.json(saved);
  } catch (err) {
    console.error('Error in PUT /admin/ai/persona', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/v1/admin/restaurant-settings
 * Query: restaurant_id
 */
adminRouter.get('/restaurant-settings', adminAuth, async (req, res) => {
  try {
    const restaurantId = req.query?.restaurant_id;
    if (!restaurantId) {
      return res.status(400).json({ error: 'restaurant_id is required' });
    }

    const settings = await getRestaurantSettingsSvc(restaurantId);

    // Defaults if row doesn't exist yet
    return res.json(
      settings || {
        restaurant_id: restaurantId,
        timezone: null,
        lat: null,
        lon: null,
        weather_enabled: false,
        weather_provider: 'open-meteo',
        weather_cache_ttl_seconds: 600,
        dayparts: DEFAULT_DAYPARTS,
        upsell_max_per_session: 3,
        upsell_min_gap_minutes: 5,
        upsell_default_epsilon: 0.1,
      }
    );
  } catch (err) {
    console.error('Error in GET /admin/restaurant-settings', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * PUT /api/v1/admin/restaurant-settings
 * Query: restaurant_id (optional, can also be in body)
 * Body: partial patch of settings
 */
adminRouter.put('/restaurant-settings', adminAuth, async (req, res) => {
  try {
    const restaurantId = req.query?.restaurant_id || req.body?.restaurant_id;
    if (!restaurantId) {
      return res.status(400).json({ error: 'restaurant_id is required' });
    }

    const patch = { ...(req.body || {}) };
    delete patch.restaurant_id;
    delete patch.restaurantId;

    const updated = await updateRestaurantSettingsSvc(restaurantId, patch);
    return res.json(updated);
  } catch (err) {
    console.error('Error in PUT /admin/restaurant-settings', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});


/**
 * GET /api/v1/admin/sessions
 * query:
 *   restaurant_id (required)
 *   only_active=true|false (optional, default true)
 */
adminRouter.get('/sessions', adminAuth, async (req, res) => {
  try {
    const { restaurant_id, only_active } = req.query;

    if (!restaurant_id) {
      return res.status(400).json({ error: 'restaurant_id is required' });
    }

    const onlyActive = only_active !== 'false';

    const sessions = await getSessionsForRestaurant(restaurant_id, { onlyActive });
    return res.json({ sessions });
  } catch (err) {
    console.error('Error in GET /admin/sessions', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/v1/admin/orders
 * query:
 *   restaurant_id (required)
 *   status (optional)
 *   limit (optional, default 100)
 */
adminRouter.get('/orders', adminAuth, async (req, res) => {
  try {
    const { restaurant_id, status, limit } = req.query;

    if (!restaurant_id) {
      return res.status(400).json({ error: 'restaurant_id is required' });
    }

    const numericLimit = Number(limit) || 100;

    const orders = await getOrdersForRestaurant(restaurant_id, {
      status: status || null,
      limit: numericLimit,
    });

    return res.json({ orders });
  } catch (err) {
    console.error('Error in GET /admin/orders', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/v1/admin/ai/dialogs
 * query:
 *   limit (optional, default 50)
 *
 * Возвращает последние пары user_text / bot_reply по событиям chat_message_in/out.
 */
adminRouter.get('/ai/dialogs', adminAuth, async (req, res) => {
  try {
    const { limit } = req.query;
    const numericLimit = Number(limit) || 50;

    const dialogs = await getRecentDialogs(numericLimit);
    return res.json({ dialogs });
  } catch (err) {
    console.error('Error in GET /admin/ai/dialogs', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/v1/admin/ai/bad-answer
 * body: {
 *   restaurant_id,
 *   session_id?,
 *   device_id?,
 *   in_event_id?,
 *   out_event_id?,
 *   user_text?,
 *   bot_reply?,
 *   comment?
 * }
 */
adminRouter.post('/ai/bad-answer', adminAuth, async (req, res) => {
  try {
    const {
      restaurant_id,
      session_id,
      device_id,
      in_event_id,
      out_event_id,
      user_text,
      bot_reply,
      comment,
    } = req.body || {};

    if (!restaurant_id || !out_event_id) {
      return res.status(400).json({ error: 'restaurant_id and out_event_id are required' });
    }

    const payload = {
      id: crypto.randomUUID(),
      restaurantId: restaurant_id,
      sessionId: session_id || null,
      deviceId: device_id || null,
      inEventId: in_event_id || null,
      outEventId: out_event_id,
      userText: user_text || null,
      botReply: bot_reply || null,
      comment: comment || null,
    };

    await markBadAnswer(payload);

    return res.json({ status: 'ok' });
  } catch (err) {
    console.error('Error in POST /admin/ai/bad-answer', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/v1/admin/ai/synonyms
 * query:
 *   restaurant_id (required)
 */
adminRouter.get('/ai/synonyms', adminAuth, async (req, res) => {
  try {
    const { restaurant_id } = req.query;

    if (!restaurant_id) {
      return res.status(400).json({ error: 'restaurant_id is required' });
    }

    const synonyms = await getSynonymsForRestaurant(restaurant_id);
    return res.json({ synonyms });
  } catch (err) {
    console.error('Error in GET /admin/ai/synonyms', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/v1/admin/ai/synonyms
 * body: { restaurant_id, locale?, phrase, canonical }
 */
adminRouter.post('/ai/synonyms', adminAuth, async (req, res) => {
  try {
    const { restaurant_id, locale, phrase, canonical } = req.body || {};

    if (!restaurant_id || !phrase || !canonical) {
      return res
        .status(400)
        .json({ error: 'restaurant_id, phrase and canonical are required' });
    }

    const payload = {
      id: crypto.randomUUID(),
      restaurantId: restaurant_id,
      locale: locale || null,
      phrase,
      canonical,
    };

    const exists = await getActiveMenuItemsByCodes(restaurant_id, [String(canonical).trim()]);
if (!exists || exists.length === 0) {
  return res.status(400).json({
    error: `canonical must be a valid item_code. Not found: ${canonical}`,
  });
}

    await addSynonym(payload);
    invalidateSynonymsCache(restaurant_id);
    return res.json({ status: 'ok' });
  } catch (err) {
    console.error('Error in POST /admin/ai/synonyms', err);
    return res.status(500).json({ error: 'Internal server error' });
  }

  /**
 * UPSSELL RULES (DB-managed)
 */

// GET /api/v1/admin/upsell-rules?restaurant_id=...&page=1&limit=50&is_active=true&rule_type=item_to_item
adminRouter.get('/upsell-rules', adminAuth, async (req, res) => {
  try {
    const restaurantId = req.query?.restaurant_id;
    if (!restaurantId) {
      return res.status(400).json({ error: 'restaurant_id is required' });
    }

    const page = Number(req.query?.page ?? 1);
    const limit = Number(req.query?.limit ?? 50);

    const isActive =
      req.query?.is_active === undefined
        ? null
        : String(req.query.is_active).toLowerCase() === 'true';

    const ruleType = req.query?.rule_type ? String(req.query.rule_type) : null;

    const out = await listUpsellRules({
      restaurantId,
      page,
      limit,
      isActive,
      ruleType,
    });

    return res.json(out);
  } catch (err) {
    console.error('Error in GET /admin/upsell-rules', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/v1/admin/upsell-rules
adminRouter.post('/upsell-rules', adminAuth, async (req, res) => {
  try {
    const rule = await createUpsellRule(req.body || {});
    return res.json({ rule });
  } catch (err) {
    console.error('Error in POST /admin/upsell-rules', err);
    return res.status(400).json({ error: 'BAD_REQUEST', message: err.message });
  }
});

// PUT /api/v1/admin/upsell-rules/:id
adminRouter.put('/upsell-rules/:id', adminAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const rule = await updateUpsellRule(id, req.body || {});
    return res.json({ rule });
  } catch (err) {
    console.error('Error in PUT /admin/upsell-rules/:id', err);
    return res.status(400).json({ error: 'BAD_REQUEST', message: err.message });
  }
});

// DELETE /api/v1/admin/upsell-rules/:id
adminRouter.delete('/upsell-rules/:id', adminAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    await deleteUpsellRule(id);
    return res.json({ ok: true });
  } catch (err) {
    console.error('Error in DELETE /admin/upsell-rules/:id', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/v1/admin/upsell-rules/:id/toggle   body: { is_active?: boolean }
adminRouter.post('/upsell-rules/:id/toggle', adminAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const isActive =
      typeof req.body?.is_active === 'boolean' ? req.body.is_active : null;

    const rule = await toggleUpsellRule(id, isActive);
    return res.json({ rule });
  } catch (err) {
    console.error('Error in POST /admin/upsell-rules/:id/toggle', err);
    return res.status(400).json({ error: 'BAD_REQUEST', message: err.message });
  }
});

// POST /api/v1/admin/upsell-rules/:id/duplicate
adminRouter.post('/upsell-rules/:id/duplicate', adminAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const rule = await duplicateUpsellRule(id);
    return res.json({ rule });
  } catch (err) {
    console.error('Error in POST /admin/upsell-rules/:id/duplicate', err);
    return res.status(400).json({ error: 'BAD_REQUEST', message: err.message });
  }
});


  
});

