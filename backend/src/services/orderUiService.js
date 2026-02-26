// src/services/orderUiService.js
// Сервис для интерактивного UI-обновления драфта заказа
import { getActiveMenuItemsByCodes } from '../models/menuModel.js';
import {
  getOrCreateDraftOrderForSession,
  getOrderWithItemsForChat,
} from './orderChatService.js';
import {
  addItemToOrder,
  updateItemQuantity,
  removeItemFromOrder,
} from './orderMutationService.js';

import { findOrderItems } from '../models/orderModel.js';

/**
 * Копия логики из dialogManager.buildOrderDraftForResponse,
 * чтобы фронт получал IDENTICAL формат.
 */
function buildOrderDraftForResponse(order) {
  if (!order) return null;

  return {
    id: order.id,
    status: order.status,
    tableId: order.table_id,
    totalAmount:
      typeof order.total_amount === 'number'
        ? order.total_amount
        : parseFloat(order.total_amount || '0') || 0,
    items: (order.items || []).map((it) => ({
      id: it.id,
      code: it.item_code,
      name: it.item_name,
      quantity: it.quantity,
      unitPrice: it.unit_price,
      modifiers: it.modifiers,
      notes: it.notes,
      menuItemId: it.menu_item_id,
    })),
  };
}

/**
 * Хелпер: по op пытаемся понять, к какому order_item.id применить операцию.
 * Поддерживаем:
 *  - order_item_id
 *  - item_code (ищем первую подходящую строку)
 */
async function resolveOrderItemId(orderId, op) {
  const { order_item_id, item_code } = op || {};

  if (order_item_id) {
    return order_item_id;
  }

  if (item_code) {
    const items = await findOrderItems(orderId);
    const upper = String(item_code).toUpperCase();
    const found = items.find(
      (it) => (it.item_code || '').toUpperCase() === upper
    );
    return found ? found.id : null;
  }

  return null;
}

/**
 * Применяем одну операцию к заказу.
 * Операция имеет вид:
 *  { type: 'set',    item_code?, order_item_id?, menu_item_id?, quantity }
 *  { type: 'remove', item_code?, order_item_id?, menu_item_id? }
 */
async function applyUiOperation(session, orderId, op) {
  const type = op.type || 'set';

  if (!['set', 'remove'].includes(type)) {
    const err = new Error('Unsupported operation type');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }

if (type === 'set') {
  const quantity = Number(op.quantity);

  if (!Number.isFinite(quantity)) {
    const err = new Error('Quantity must be a finite number');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }

  // 1) quantity <= 0 → удаляем позицию
  if (quantity <= 0) {
    const orderItemId = await resolveOrderItemId(orderId, op);
    if (orderItemId) {
      await removeItemFromOrder(orderId, orderItemId);
    }
  } else {
    // 2) quantity > 0 → либо обновляем существующий order_item,
    // либо создаём новый по item_code / menu_item_id
    const existingOrderItemId = await resolveOrderItemId(orderId, op);

    if (existingOrderItemId) {
      // просто обновляем количество
      await updateItemQuantity(orderId, existingOrderItemId, {
        quantity,
      });
    } else {
      // нужно добавить новую позицию
      let menuItemId = op.menu_item_id;

      // если нет menu_item_id, но есть item_code — ищем блюдо по коду
      if (!menuItemId && op.item_code) {
        const items = await getActiveMenuItemsByCodes(
          session.restaurant_id,
          [op.item_code]
        );
        const menuItem = items[0];
        menuItemId = menuItem?.id || null;
      }

      if (!menuItemId) {
        const err = new Error('menu_item_id or item_code is required');
        err.code = 'VALIDATION_ERROR';
        throw err;
      }

      await addItemToOrder(orderId, menuItemId, {
        quantity,
        language: op.language || null,
      });
    }
  }
} else if (type === 'remove') {
  // существующий блок remove можно оставить как есть
  const orderItemId = await resolveOrderItemId(orderId, op);
  if (!orderItemId) {
    return;
  }
  await removeItemFromOrder(orderId, orderItemId);
}


  // После операции всегда возвращаем актуальный orderDraft
  const updatedOrder = await getOrderWithItemsForChat(orderId);
  return buildOrderDraftForResponse(updatedOrder);
}

/**
 * Публичная функция: применить одну или несколько операций
 * к текущему draft-заказу сессии и вернуть обновлённый orderDraft.
 *
 * payload может быть:
 *  - одной операцией: { type, ... }
 *  - либо массивом:   { operations: [ ... ] }
 */
export async function applyUiUpdateForSession(session, payload) {
  const draftOrder = await getOrCreateDraftOrderForSession(session);
  const orderId = draftOrder.id;

  const operations = Array.isArray(payload?.operations)
    ? payload.operations
    : [payload];

  let lastDraft = null;

for (const op of operations) {
  if (!op) continue;
  lastDraft = await applyUiOperation(session, orderId, op);
}

  if (!lastDraft) {
    const fullOrder = await getOrderWithItemsForChat(orderId);
    return buildOrderDraftForResponse(fullOrder);
  }

  return lastDraft;
}
