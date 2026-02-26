// src/routes/menuRoutes.js
import express from 'express';
import { sendError } from '../utils/errors.js';
import {
  fetchMenuItems,
  fetchRestaurantAllergens,
  fetchMenuItemById,
  suggestMenuItems,
} from '../services/menuService.js';
import { checkAllergensForItems } from '../services/allergyService.js';
import { DEFAULT_DEMO_RESTAURANT_ID } from '../config/menu.js';
import { sessionAuth } from '../middleware/sessionAuth.js';

export const menuRouter = express.Router();


/**
 * GET /api/v1/menu/items
 * Опциональные query:
 *  - restaurant_id (по умолчанию azuma_demo для демо)
 *  - only_active=true/false (по умолчанию true)
 *
 * ПУБЛИЧНЫЙ эндпоинт — БЕЗ sessionAuth.
 */
menuRouter.get('/items', async (req, res) => {
  try {
    const restaurantId = req.query.restaurant_id || DEFAULT_DEMO_RESTAURANT_ID;
    const onlyActive =
      typeof req.query.only_active === 'string'
        ? req.query.only_active !== 'false'
        : true;

    const items = await fetchMenuItems(restaurantId, { onlyActive });

    return res.json({
      restaurant_id: restaurantId,
      items,
    });
  } catch (err) {
    console.error('Error in GET /menu/items', err);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

/**
 * GET /api/v1/menu/items/:id
 * Детали конкретного блюда (включая ингредиенты, аллергены, фото).
 * Публичный эндпоинт.
 */
menuRouter.get('/items/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const item = await fetchMenuItemById(id);

    if (!item) {
      return sendError(res, 404, 'NOT_FOUND', 'Menu item not found');
    }

    return res.json(item);
  } catch (err) {
    console.error('Error in GET /menu/items/:id', err);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

/**
 * GET /api/v1/menu/allergens
 * Вернёт список всех аллергенов по ресторану.
 */
menuRouter.get('/allergens', async (req, res) => {
  try {
    const restaurantId = req.query.restaurant_id || DEFAULT_DEMO_RESTAURANT_ID;
    const allergens = await fetchRestaurantAllergens(restaurantId);

    return res.json({
      restaurant_id: restaurantId,
      allergens,
    });
  } catch (err) {
    console.error('Error in GET /menu/allergens', err);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

/**
 * POST /api/v1/menu/check-allergens
 * Body:
 * {
 *   restaurant_id?: string,
 *   item_codes: string[],
 *   allergies: string[]
 * }
 *
 * Возвращает список блюд с флагом пересечения по аллергенам.
 */
menuRouter.post('/check-allergens', async (req, res) => {
  try {
    const restaurantId = req.body.restaurant_id || DEFAULT_DEMO_RESTAURANT_ID;
    const itemCodes = Array.isArray(req.body.item_codes)
      ? req.body.item_codes
      : [];
    const allergies = Array.isArray(req.body.allergies)
      ? req.body.allergies
      : [];

    if (!itemCodes.length) {
      return sendError(
        res,
        400,
        'BAD_REQUEST',
        'item_codes is required and must be non-empty array'
      );
    }

    const items = await checkAllergensForItems(
      restaurantId,
      itemCodes,
      allergies
    );

    return res.json({
      restaurant_id: restaurantId,
      allergies,
      items,
    });
  } catch (err) {
    console.error('Error in POST /menu/check-allergens', err);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});



/**
 * GET /api/v1/menu/suggest?q=...&locale=...&limit=6
 * Требует x-session-token (через sessionAuth), чтобы узнать restaurant_id.
 */
menuRouter.get('/suggest', sessionAuth, async (req, res) => {
  try {
    const { q = '', locale = 'en', limit = '6' } = req.query;
    const query = String(q || '').trim();

    // Минимальная длина запроса, чтобы не спамить сервер
    if (!query || query.length < 2) {
      return res.json([]);
    }

    const limitNum = Math.min(parseInt(limit, 10) || 6, 12);

    const session = req.session;
    if (!session || !session.restaurant_id) {
      return sendError(res, 400, 'NO_SESSION', 'Session or restaurant not found');
    }

    const restaurantId = session.restaurant_id;

    const items = await suggestMenuItems(restaurantId, {
      query,
      locale,
      limit: limitNum,
    });

    return res.json(items);
  } catch (err) {
    console.error('Error in GET /menu/suggest', err);
    return sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
  }
});

