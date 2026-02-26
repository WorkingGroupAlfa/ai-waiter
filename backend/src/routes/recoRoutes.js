import express from 'express';
import { sessionAuth } from '../middleware/sessionAuth.js';

import { getOrderWithItemsForChat } from '../services/orderChatService.js';
import { getIngredientBasedUpsell, getChatUpsellSuggestion } from '../ai/recommendationService.js';
import { logEvent } from '../services/eventService.js';

export const recoRouter = express.Router();

/**
 * POST /api/v1/reco/related-items
 * body: { item_codes: ["SHRIMP_POPCORN"], limit?: number, restaurant_id?: string }
 * Если restaurant_id не передан — берём из сессии.
 */
recoRouter.post('/related-items', sessionAuth, async (req, res) => {
  try {
    const session = req.session;
    const { item_codes, limit, restaurant_id } = req.body || {};

    if (!item_codes || !Array.isArray(item_codes) || item_codes.length === 0) {
      return res.status(400).json({ error: 'item_codes array is required' });
    }

    const restaurantId = restaurant_id || session.restaurant_id;
    const lim = typeof limit === 'number' ? limit : 3;

    const fakeOrderItems = item_codes.map(c => ({ item_code: c }));
const items = await getIngredientBasedUpsell(fakeOrderItems, { restaurantId, });
return res.json({ items });

  } catch (err) {
    console.error('Error in POST /reco/related-items', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/v1/reco/upsell
 *
 * body: { order_id: string }
 *
 * Возвращает рекомендацию для допродажи по конкретному заказу.
 * Требует действующей сессии (sessionAuth), чтобы проверить принадлежность заказа.
 */
recoRouter.post('/upsell', sessionAuth, async (req, res) => {
  try {
    const session = req.session;
    const deviceId = req.deviceId;
    const { order_id } = req.body || {};

    if (!order_id) {
      return res.status(400).json({ error: 'order_id is required' });
    }

    // 1. Получаем заказ с позициями
    const order = await getOrderWithItemsForChat(order_id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // 2. Проверяем, что заказ принадлежит текущей сессии
    if (order.session_id !== session.id) {
      return res.status(403).json({ error: 'Order does not belong to this session' });
    }

    // 3. Получаем предложение апселла
    const upsell = await getChatUpsellSuggestion({
  order,
  session,
  deviceId,
  deviceMemory: null,
  allergies: [],
});

    // Если есть текст предложения — логируем показ апселла
    if (upsell && upsell.text) {
      await logEvent(
        'upsell_shown',
        { session, deviceId, orderId: order.id },
        {
          order_id: order.id,
          suggested_item_code: upsell.itemCode,
          suggested_item_name: upsell.itemName || upsell.itemCode,
          // язык в данном случае можем не знать точно — отдаём на усмотрение фронта,
          // но если хочешь, можно дополнительно принять language в body и писать сюда
        }
      );
    }

    return res.json({
      order_id: order.id,
      suggestion: upsell || null
    });
  } catch (err) {
    console.error('Error in POST /api/v1/reco/upsell', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

