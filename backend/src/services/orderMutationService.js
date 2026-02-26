// src/services/orderMutationService.js
// Atomic order mutation engine used by AI dialog layer.

import { v4 as uuidv4 } from 'uuid';
import {
  findOrderById,
  insertOrderItem,
  updateOrderItem,
  deleteOrderItem,
  calcOrderTotal,
  updateOrderTotal,
} from '../models/orderModel.js';
import { getMenuItemWithDetailsById } from '../models/menuModel.js';

/**
 * Внутренний хелпер: убедиться, что заказ существует и в статусе draft.
 */
async function ensureDraftOrder(orderId) {
  const order = await findOrderById(orderId);
  if (!order) {
    const err = new Error('Order not found');
    err.code = 'ORDER_NOT_FOUND';
    throw err;
  }
  if (order.status !== 'draft') {
    const err = new Error('Only draft orders can be modified');
    err.code = 'ORDER_NOT_DRAFT';
    throw err;
  }
  return order;
}

/**
 * Добавить блюдо в заказ по menuItemId.
 *
 * @param {string} orderId
 * @param {string} menuItemId
 * @param {{ quantity?: number, modifiers?: object, language?: string }} options
 * @returns {Promise<{ order: object, item: object }>}
 */
export async function addItemToOrder(
  orderId,
  menuItemId,
  { quantity = 1, modifiers = {}, language } = {}
) {
  const order = await ensureDraftOrder(orderId);

  const menuItem = await getMenuItemWithDetailsById(menuItemId);
  if (!menuItem) {
    const err = new Error('Menu item not found');
    err.code = 'MENU_ITEM_NOT_FOUND';
    throw err;
  }
  if (menuItem.restaurant_id !== order.restaurant_id) {
    const err = new Error('Menu item does not belong to this restaurant');
    err.code = 'MENU_ITEM_INVALID';
    throw err;
  }

  const itemId = uuidv4();
  const itemCode = menuItem.item_code;
  const lang = (language || '').startsWith('en') ? 'en' : 'ua';
  const itemName =
    lang === 'en'
      ? menuItem.name_en || menuItem.name_ua || itemCode
      : menuItem.name_ua || menuItem.name_en || itemCode;

  const unitPrice = menuItem.base_price;


  
  const inserted = await insertOrderItem({
    id: itemId,
    orderId: order.id,
    itemCode,
    itemName,
    quantity,
    unitPrice,
    modifiers,
    notes: '',
  });

  const total = await calcOrderTotal(order.id);
  await updateOrderTotal(order.id, total);

  return {
    order: { ...order, total_amount: total },
    item: inserted,
  };
}

/**
 * Обновить количество позиции.
 */
export async function updateItemQuantity(orderId, orderItemId, { quantity }) {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    const err = new Error('Quantity must be positive number');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }

  const order = await ensureDraftOrder(orderId);

  const updated = await updateOrderItem(order.id, orderItemId, { quantity });
  if (!updated) {
    const err = new Error('Order item not found');
    err.code = 'ORDER_ITEM_NOT_FOUND';
    throw err;
  }

  const total = await calcOrderTotal(order.id);
  await updateOrderTotal(order.id, total);

  return {
    order: { ...order, total_amount: total },
    item: updated,
  };
}

/**
 * Обновить modifiers позиции (полной заменой JSON).
 */
export async function updateItemModifiers(orderId, orderItemId, { modifiers }) {
  const order = await ensureDraftOrder(orderId);

  const updated = await updateOrderItem(order.id, orderItemId, { modifiers });
  if (!updated) {
    const err = new Error('Order item not found');
    err.code = 'ORDER_ITEM_NOT_FOUND';
    throw err;
  }

  const total = await calcOrderTotal(order.id);
  await updateOrderTotal(order.id, total);

  return {
    order: { ...order, total_amount: total },
    item: updated,
  };
}

/**
 * Удалить позицию из заказа (только draft).
 */
export async function removeItemFromOrder(orderId, orderItemId) {
  const order = await ensureDraftOrder(orderId);

  const deletedCount = await deleteOrderItem(order.id, orderItemId);
  if (deletedCount === 0) {
    const err = new Error('Order item not found');
    err.code = 'ORDER_ITEM_NOT_FOUND';
    throw err;
  }

  const total = await calcOrderTotal(order.id);
  await updateOrderTotal(order.id, total);

  return {
    order: { ...order, total_amount: total },
  };
}
