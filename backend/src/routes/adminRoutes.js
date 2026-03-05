// src/routes/adminRoutes.js
// src/routes/adminRoutes.js
import { getActiveMenuItemsByCodes } from '../models/menuModel.js';
import { invalidateSynonymsCache } from '../ai/semanticMatcher.js';
import { invalidateDishSearchCache } from '../ai/dishSearchEngine.js';
import express from 'express';
import {
  getFraudOrders,
  getSummaryAnalytics,
  getEmotionAnalytics,
  getUpsellStatsByItem,
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
import { createOrUpdateMenuItemWithDetails, deleteMenuItemSoft } from '../services/menuAdminService.js';
import { rebuildEmbeddingsForRestaurant } from '../ai/embeddingService.js';
import { loadPersona, savePersona } from '../services/aiPersonaService.js';
import { getSettings as getRestaurantSettingsSvc, updateSettings as updateRestaurantSettingsSvc, DEFAULT_DAYPARTS } from '../services/restaurantSettingsService.js';
import {
  listMenuCustomCategories,
  createMenuCustomCategory,
  updateMenuCustomCategory,
  removeMenuCustomCategory,
} from '../services/customCategoryService.js';
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
 * DELETE /api/v1/admin/menu/items/:id
 * Soft-delete блюда (is_active=false)
 *
 * Требует заголовка x-admin-token с ADMIN_TOKEN.
 * restaurant_id передаётся в query или body.
 */
adminRouter.delete('/menu/items/:id', adminAuth, async (req, res) => {
  try {
    const id = req.params?.id;
    const restaurant_id = req.query?.restaurant_id || req.body?.restaurant_id;
    const item = await deleteMenuItemSoft({ restaurant_id, id });
    return res.json({ item });
  } catch (err) {
    console.error('Error in DELETE /admin/menu/items/:id', err);
    return res.status(400).json({ error: 'BAD_REQUEST', message: err?.message || String(err) });
  }
});

/**
 * GET /api/v1/admin/menu/custom-categories
 * Query:
 *  - restaurant_id (required)
 *  - only_active=true|false (optional)
 */
adminRouter.get('/menu/custom-categories', adminAuth, async (req, res) => {
  try {
    const restaurantId = req.query?.restaurant_id;
    if (!restaurantId) {
      return res.status(400).json({ error: 'restaurant_id is required' });
    }

    const onlyActive = req.query?.only_active === 'true';
    const rows = await listMenuCustomCategories(restaurantId, { onlyActive });
    return res.json({ rows });
  } catch (err) {
    console.error('Error in GET /admin/menu/custom-categories', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/v1/admin/menu/custom-categories
 * Body:
 *  - restaurant_id, slug, name_ua, name_en?, aliases?, is_active?, sort_order?
 */
adminRouter.post('/menu/custom-categories', adminAuth, async (req, res) => {
  try {
    const payload = req.body || {};
    const row = await createMenuCustomCategory(payload);
    return res.status(201).json({ row });
  } catch (err) {
    console.error('Error in POST /admin/menu/custom-categories', err);
    return res.status(400).json({
      error: 'BAD_REQUEST',
      message: err?.message || 'Invalid payload',
    });
  }
});

/**
 * PUT /api/v1/admin/menu/custom-categories/:id
 */
adminRouter.put('/menu/custom-categories/:id', adminAuth, async (req, res) => {
  try {
    const id = req.params?.id;
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }

    const row = await updateMenuCustomCategory(id, req.body || {});
    if (!row) {
      return res.status(404).json({ error: 'Not found' });
    }
    return res.json({ row });
  } catch (err) {
    console.error('Error in PUT /admin/menu/custom-categories/:id', err);
    return res.status(400).json({
      error: 'BAD_REQUEST',
      message: err?.message || 'Invalid payload',
    });
  }
});

/**
 * DELETE /api/v1/admin/menu/custom-categories/:id
 */
adminRouter.delete('/menu/custom-categories/:id', adminAuth, async (req, res) => {
  try {
    const id = req.params?.id;
    if (!id) {
      return res.status(400).json({ error: 'id is required' });
    }
    const ok = await removeMenuCustomCategory(id);
    return res.json({ ok });
  } catch (err) {
    console.error('Error in DELETE /admin/menu/custom-categories/:id', err);
    return res.status(500).json({ error: 'Internal server error' });
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
    invalidateDishSearchCache(restaurant_id);
    return res.json({ status: 'ok' });
  } catch (err) {
    console.error('Error in POST /admin/ai/synonyms', err);
    return res.status(500).json({ error: 'Internal server error' });
}
});
