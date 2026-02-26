// src/services/orderService.js
import { v4 as uuidv4 } from 'uuid';
import {
  findDraftOrderForSession,
  insertDraftOrder,
  findActiveOrderForSession,
  findOrderByIdAndSession,
  findOrderItems,
  insertOrderItem,
  updateOrderItem,
  deleteOrderItem,
  calcOrderTotal,
  updateOrderTotal,
  submitOrder,
  cancelOrder,
  getOrderItemsForFraudCheck,
} from '../models/orderModel.js';

// --- внутренние хелперы ---

async function ensureOrderForSession(orderId, sessionId) {
  const order = await findOrderByIdAndSession(orderId, sessionId);
  if (!order) {
    const err = new Error('Order not found for this session');
    err.code = 'ORDER_NOT_FOUND';
    throw err;
  }
  return order;
}

async function ensureDraftOrderForSession(orderId, sessionId) {
  const order = await ensureOrderForSession(orderId, sessionId);
  if (order.status !== 'draft') {
    const err = new Error('Can only modify items in draft orders');
    err.code = 'ORDER_NOT_DRAFT';
    throw err;
  }
  return order;
}

async function attachItems(order) {
  const items = await findOrderItems(order.id);
  order.items = items;
  return order;
}

// --- публичное API сервиса ---

export async function createOrGetDraftOrderForSession(session) {
  let order = await findDraftOrderForSession(session.id);

  if (!order) {
    const id = uuidv4();
    order = await insertDraftOrder({
      id,
      sessionId: session.id,
      deviceId: session.device_id,
      restaurantId: session.restaurant_id,
      tableId: session.table_id,
    });
  }

  return attachItems(order);
}

export async function getCurrentActiveOrderForSession(session) {
  const order = await findActiveOrderForSession(session.id);
  if (!order) {
    return null;
  }
  return attachItems(order);
}

export async function getOrderForSession(session, orderId) {
  const order = await ensureOrderForSession(orderId, session.id);
  return attachItems(order);
}

export async function addItemToOrderForSession(
  session,
  orderId,
  { item_name, quantity, unit_price, item_code, modifiers, notes }
) {
  if (!item_name || !quantity) {
    const err = new Error('item_name and quantity are required');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }

  await ensureDraftOrderForSession(orderId, session.id);

  const id = uuidv4();

  await insertOrderItem({
    id,
    orderId,
    itemCode: item_code ?? null,
    itemName: item_name,
    quantity,
    unitPrice: unit_price ?? null,
    modifiers: modifiers ?? null,
    notes: notes ?? null,
  });

  const total = await calcOrderTotal(orderId);
  await updateOrderTotal(orderId, total);

  return getOrderForSession(session, orderId);
}

export async function updateOrderItemForSession(
  session,
  orderId,
  itemId,
  { quantity, unit_price, modifiers, notes }
) {
  await ensureDraftOrderForSession(orderId, session.id);

  const fields = {};
  if (quantity !== undefined) fields.quantity = quantity;
  if (unit_price !== undefined) fields.unit_price = unit_price;
  if (modifiers !== undefined) fields.modifiers = modifiers;
  if (notes !== undefined) fields.notes = notes;

  if (Object.keys(fields).length === 0) {
    const err = new Error('No fields to update');
    err.code = 'VALIDATION_ERROR';
    throw err;
  }

  const updated = await updateOrderItem(orderId, itemId, fields);
  if (!updated) {
    const err = new Error('Order item not found');
    err.code = 'ORDER_ITEM_NOT_FOUND';
    throw err;
  }

  const total = await calcOrderTotal(orderId);
  await updateOrderTotal(orderId, total);

  return getOrderForSession(session, orderId);
}

export async function deleteOrderItemForSession(session, orderId, itemId) {
  await ensureDraftOrderForSession(orderId, session.id);

  const deletedCount = await deleteOrderItem(orderId, itemId);
  if (deletedCount === 0) {
    const err = new Error('Order item not found');
    err.code = 'ORDER_ITEM_NOT_FOUND';
    throw err;
  }

  const total = await calcOrderTotal(orderId);
  await updateOrderTotal(orderId, total);

  return getOrderForSession(session, orderId);
}

export async function submitOrderForSession(session, orderId) {
  await ensureDraftOrderForSession(orderId, session.id);

  const items = await getOrderItemsForFraudCheck(orderId);
  if (items.length === 0) {
    const err = new Error('Cannot submit an empty order');
    err.code = 'EMPTY_ORDER';
    throw err;
  }

  let totalQuantity = 0;
  for (const row of items) {
    const q = Number(row.quantity) || 0;
    totalQuantity += q;

    if (q > 50) {
      const err = new Error('Suspicious quantity in one of items');
      err.code = 'FRAUD_QUANTITY_SINGLE';
      throw err;
    }
  }

  if (totalQuantity > 200) {
    const err = new Error('Suspiciously large order (too many items)');
    err.code = 'FRAUD_QUANTITY_TOTAL';
    throw err;
  }

  const total = await calcOrderTotal(orderId);
  await updateOrderTotal(orderId, total);
  await submitOrder(orderId);

  return getOrderForSession(session, orderId);
}

export async function cancelOrderForSession(session, orderId) {
  const order = await ensureOrderForSession(orderId, session.id);

  if (!['draft', 'submitted'].includes(order.status)) {
    const err = new Error('Only draft or submitted orders can be cancelled');
    err.code = 'ORDER_NOT_DRAFT';
    throw err;
  }

  await cancelOrder(orderId);
  return getOrderForSession(session, orderId);
}
