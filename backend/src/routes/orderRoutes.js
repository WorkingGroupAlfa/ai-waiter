// src/routes/orderRoutes.js
import express from 'express';
import { sessionAuth } from '../middleware/sessionAuth.js';
import { sendOrderToTelegram } from '../services/telegramService.js';
import { logEvent } from '../services/eventService.js';
import {
  createOrGetDraftOrderForSession,
  getCurrentActiveOrderForSession,
  addItemToOrderForSession,
  updateOrderItemForSession,
  deleteOrderItemForSession,
  submitOrderForSession,
  cancelOrderForSession,
  getOrderForSession,
} from '../services/orderService.js';

export const orderRouter = express.Router();

/**
 * Универсальный хелпер для маппинга ошибок сервиса в HTTP-ответы
 */
function handleOrderServiceError(err, res, logPrefix) {
  console.error(logPrefix, err);

  switch (err.code) {
    case 'ORDER_NOT_FOUND':
      return res.status(404).json({ error: 'Order not found for this session' });

    case 'NO_ACTIVE_ORDER':
      return res.status(404).json({ error: 'No active order for this session' });

    case 'ORDER_NOT_DRAFT':
      return res.status(400).json({ error: 'Can only modify items in draft orders' });

    case 'VALIDATION_ERROR':
      return res.status(400).json({ error: err.message || 'Validation error' });

    case 'EMPTY_ORDER':
      return res.status(400).json({ error: 'Cannot submit an empty order' });

    case 'FRAUD_QUANTITY_SINGLE':
      return res.status(400).json({ error: 'Suspicious quantity in one of items' });

    case 'FRAUD_QUANTITY_TOTAL':
      return res.status(400).json({ error: 'Suspiciously large order (too many items)' });

    case 'ORDER_ITEM_NOT_FOUND':
      return res.status(404).json({ error: 'Order item not found' });

    default:
      return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * POST /api/v1/orders/draft
 * Создать (или вернуть существующий) черновой заказ для текущей сессии
 */
orderRouter.post('/draft', sessionAuth, async (req, res) => {
  try {
    const session = req.session;

    const order = await createOrGetDraftOrderForSession(session);

    await logEvent(
      'order_draft_created',
      {
        session,
        deviceId: session.device_id,
        orderId: order.id,
      },
      {
        order_id: order.id,
        status: order.status,
        total_amount: order.total_amount,
      }
    );

    return res.json(order);
  } catch (err) {
    return handleOrderServiceError(err, res, 'Error in POST /orders/draft');
  }
});

/**
 * GET /api/v1/orders/current
 * Вернуть текущий активный заказ (draft / submitted / in_kitchen / ready) для сессии
 */
orderRouter.get('/current', sessionAuth, async (req, res) => {
  try {
    const session = req.session;

    const order = await getCurrentActiveOrderForSession(session);
    if (!order) {
      return res.status(404).json({ error: 'No active order for this session' });
    }

    return res.json(order);
  } catch (err) {
    return handleOrderServiceError(err, res, 'Error in GET /orders/current');
  }
});

/**
 * POST /api/v1/orders/:orderId/items
 * Добавить позицию в заказ
 * body: { item_name, quantity, unit_price?, item_code?, modifiers?, notes? }
 */
orderRouter.post('/:orderId/items', sessionAuth, async (req, res) => {
  try {
    const session = req.session;
    const { orderId } = req.params;
    const { item_name, quantity, unit_price, item_code, modifiers, notes } = req.body;

    const fullOrder = await addItemToOrderForSession(session, orderId, {
      item_name,
      quantity,
      unit_price,
      item_code,
      modifiers,
      notes,
    });

    return res.json(fullOrder);
  } catch (err) {
    return handleOrderServiceError(err, res, 'Error in POST /orders/:orderId/items');
  }
});

/**
 * PATCH /api/v1/orders/:orderId/items/:itemId
 * Обновить позицию заказа (количество, цену, модификаторы, комментарии)
 */
orderRouter.patch('/:orderId/items/:itemId', sessionAuth, async (req, res) => {
  try {
    const session = req.session;
    const { orderId, itemId } = req.params;
    const { quantity, unit_price, modifiers, notes } = req.body;

    const fullOrder = await updateOrderItemForSession(session, orderId, itemId, {
      quantity,
      unit_price,
      modifiers,
      notes,
    });

    return res.json(fullOrder);
  } catch (err) {
    return handleOrderServiceError(err, res, 'Error in PATCH /orders/:orderId/items/:itemId');
  }
});

/**
 * DELETE /api/v1/orders/:orderId/items/:itemId
 */
orderRouter.delete('/:orderId/items/:itemId', sessionAuth, async (req, res) => {
  try {
    const session = req.session;
    const { orderId, itemId } = req.params;

    const fullOrder = await deleteOrderItemForSession(session, orderId, itemId);
    return res.json(fullOrder);
  } catch (err) {
    return handleOrderServiceError(err, res, 'Error in DELETE /orders/:orderId/items/:itemId');
  }
});

/**
 * POST /api/v1/orders/:orderId/submit
 * Подтвердить заказ (draft -> submitted) с проверками
 */
orderRouter.post('/:orderId/submit', sessionAuth, async (req, res) => {
  try {
    const session = req.session;
    const { orderId } = req.params;

    const fullOrder = await submitOrderForSession(session, orderId);

    // логируем подтверждение заказа
    await logEvent(
      'order_submitted',
      {
        session,
        deviceId: session.device_id,
        orderId: fullOrder.id,
      },
      {
        order_id: fullOrder.id,
        status: fullOrder.status,
        total_amount: fullOrder.total_amount,
      }
    );

    // отправляем в Telegram (без падения submit при ошибке)
    try {
      await sendOrderToTelegram(fullOrder);
    } catch (err) {
      console.error('[Telegram] Failed to send order:', err?.message || err);
    }

    return res.json(fullOrder);
  } catch (err) {
    return handleOrderServiceError(err, res, 'Error in POST /orders/:orderId/submit');
  }
});

/**
 * POST /api/v1/orders/:orderId/cancel
 * Отменить заказ (draft или submitted -> cancelled)
 */
orderRouter.post('/:orderId/cancel', sessionAuth, async (req, res) => {
  try {
    const session = req.session;
    const { orderId } = req.params;

    const fullOrder = await cancelOrderForSession(session, orderId);
    return res.json(fullOrder);
  } catch (err) {
    return handleOrderServiceError(err, res, 'Error in POST /orders/:orderId/cancel');
  }
});

/**
 * GET /api/v1/orders/:orderId
 * Получить заказ по id (если принадлежит текущей сессии)
 */
orderRouter.get('/:orderId', sessionAuth, async (req, res) => {
  try {
    const session = req.session;
    const { orderId } = req.params;

    const order = await getOrderForSession(session, orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found for this session' });
    }

    return res.json(order);
  } catch (err) {
    return handleOrderServiceError(err, res, 'Error in GET /orders/:orderId');
  }
});

