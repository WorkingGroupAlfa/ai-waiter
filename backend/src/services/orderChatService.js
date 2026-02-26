// src/services/orderChatService.js
import { v4 as uuidv4 } from 'uuid';
import {
  findDraftOrderForSession,
  insertDraftOrder,
  insertOrderItem,
  deleteLastOrderItemByCode,
  calcOrderTotal,
  updateOrderTotal,
  findOrderWithItems,
} from '../models/orderModel.js';

// Временное "меню" с ценами (потом заменим на таблицу menu)
const MENU_PRICES = {
  LEMONADE: 120,
  SHRIMP_POPCORN: 520,
};

/**
 * Найти или создать draft-заказ для данной сессии
 */
export async function getOrCreateDraftOrderForSession(session) {
  const existing = await findDraftOrderForSession(session.id);
  if (existing) {
    return existing;
  }

  // генерируем id на стороне Node
  const newOrderId = uuidv4();

  const inserted = await insertDraftOrder({
    id: newOrderId,
    sessionId: session.id,
    deviceId: session.device_id,
    restaurantId: session.restaurant_id,
    tableId: session.table_id,
  });

  return inserted;
}

/**
 * Добавить блюда в заказ как отдельные позиции
 * dishes: [{ code, name, quantity, modifiers?, notes? }]
 */
export async function addDishItemsToOrder(orderId, dishes) {
  const inserted = [];

  for (const dish of dishes) {
    const code = dish.code || 'UNKNOWN';
    const name = dish.name || code;
    const unitPrice = MENU_PRICES[code] ?? 0;

    // поддержка quantity (по умолчанию 1)
    const quantity = Number(dish.quantity || 1);

    const orderItemId = uuidv4();

    const row = await insertOrderItem({
      id: orderItemId,
      orderId,
      itemCode: code,
      itemName: name,
      quantity,
      unitPrice,
      modifiers: dish.modifiers || {},
      notes: dish.notes || '',
    });

    inserted.push(row);
  }

  return inserted;
}

/**
 * Удалить одну позицию из заказа по коду блюда (item_code).
 * Удаляем самую "пізню" (останню додану).
 */
export async function removeOneItemFromOrderByCode(orderId, itemCode) {
  return deleteLastOrderItemByCode(orderId, itemCode);
}

/**
 * Пересчитать total_amount по сумме позиций
 */
export async function recalcOrderTotal(orderId) {
  const total = await calcOrderTotal(orderId);
  await updateOrderTotal(orderId, total);
}

/**
 * Получить заказ вместе с массивом items
 */
export async function getOrderWithItemsForChat(orderId) {
  return findOrderWithItems(orderId);
}

/**
 * Главная функция: обработать intent=order из NLU,
 * обновить заказ и вернуть его.
 */
export async function handleOrderIntentFromNLU(session, nlu) {
  const dishes = nlu?.entities?.dishes || [];

  if (dishes.length === 0) {
    return { order: null, addedItems: [] };
  }

  const order = await getOrCreateDraftOrderForSession(session);
  const addedItems = await addDishItemsToOrder(order.id, dishes);
  await recalcOrderTotal(order.id);
  const fullOrder = await getOrderWithItemsForChat(order.id);

  return { order: fullOrder, addedItems };
}

/**
 * Обработать intent=modify_order:
 * сейчас поддерживаем лише операцію "remove" по коду страви.
 */
export async function handleModifyOrderFromNLU(session, nlu) {
  const mods = (nlu?.entities?.modifications || []).filter(
    (m) => (m.operation || 'remove') === 'remove' && m.code
  );
  const dishes = nlu?.entities?.dishes || [];

  // если modifications пусто, но есть блюда — считаем, что надо удалить их
  const targets =
    mods.length > 0
      ? mods
      : dishes
          .filter((d) => d.code)
          .map((d) => ({
            operation: 'remove',
            code: d.code,
            name: d.name,
          }));

  if (targets.length === 0) {
    return {
      order: null,
      removedItems: [],
    };
  }

  // берём/создаём черновой заказ
  const order = await getOrCreateDraftOrderForSession(session);

  const removedItems = [];

  for (const t of targets) {
    const removed = await removeOneItemFromOrderByCode(order.id, t.code);
    if (removed) {
      removedItems.push(removed);
    }
  }

  // пересчитываем сумму и забираем полный заказ
  await recalcOrderTotal(order.id);
  const fullOrder = await getOrderWithItemsForChat(order.id);

  return {
    order: fullOrder,
    removedItems,
  };
}


