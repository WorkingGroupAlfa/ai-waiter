// src/services/orderUiService.js
// Сервис для интерактивного UI-обновления драфта заказа
import { getActiveMenuItemsByCodes } from '../models/menuModel.js';
import { query } from '../db.js';
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

function normalizeLookupText(v) {
  return String(v || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function resolveMenuItemIdByCodeFallback(restaurantId, rawCode) {
  const opItemCode = String(rawCode || '').trim();
  if (!restaurantId || !opItemCode) return null;

  // 1) direct active lookup by code variants
  const normalizedCodes = Array.from(
    new Set([opItemCode, opItemCode.toUpperCase(), opItemCode.toLowerCase()].filter(Boolean))
  );
  const direct = await getActiveMenuItemsByCodes(restaurantId, normalizedCodes);
  if (direct?.[0]?.id) return direct[0].id;

  // 2) if old code exists but inactive, try to find active replacement by same name
  const oldCodeRes = await query(
    `
    SELECT id, item_code, name_ua, name_en, is_active
    FROM menu_items
    WHERE restaurant_id = $1
      AND UPPER(item_code) = UPPER($2)
    ORDER BY is_active DESC, updated_at DESC NULLS LAST, created_at DESC
    LIMIT 1
    `,
    [restaurantId, opItemCode]
  );
  const oldCode = oldCodeRes.rows?.[0] || null;
  if (oldCode && oldCode.is_active === false) {
    const oldNameUa = normalizeLookupText(oldCode.name_ua);
    const oldNameEn = normalizeLookupText(oldCode.name_en);

    if (oldNameUa || oldNameEn) {
      const byNameRes = await query(
        `
        SELECT id, item_code
        FROM menu_items
        WHERE restaurant_id = $1
          AND is_active = TRUE
          AND (
            ($2 <> '' AND lower(coalesce(name_ua, '')) = $2)
            OR ($3 <> '' AND lower(coalesce(name_en, '')) = $3)
          )
        ORDER BY updated_at DESC NULLS LAST, created_at DESC
        LIMIT 2
        `,
        [restaurantId, oldNameUa || '', oldNameEn || '']
      );
      if (byNameRes.rows.length === 1) {
        return byNameRes.rows[0].id;
      }
    }
  }

  // 3) robust lexical fallback by item name (strict: only unique best match)
  const needle = normalizeLookupText(opItemCode);
  if (!needle || needle.length < 3) return null;

  const lexical = await query(
    `
    SELECT
      id,
      item_code,
      name_ua,
      name_en
    FROM menu_items
    WHERE restaurant_id = $1
      AND is_active = TRUE
      AND (
        lower(coalesce(name_ua, '')) LIKE $2
        OR lower(coalesce(name_en, '')) LIKE $2
        OR lower(replace(coalesce(name_ua, ''), '-', ' ')) LIKE $2
        OR lower(replace(coalesce(name_en, ''), '-', ' ')) LIKE $2
      )
    ORDER BY updated_at DESC NULLS LAST, created_at DESC
    LIMIT 5
    `,
    [restaurantId, `%${needle}%`]
  );

  if (!lexical.rows.length) return null;
  if (lexical.rows.length === 1) return lexical.rows[0].id;

  const scored = lexical.rows
    .map((row) => {
      const nUa = normalizeLookupText(row.name_ua);
      const nEn = normalizeLookupText(row.name_en);
      let score = 0;
      if (nUa === needle || nEn === needle) score += 6;
      if (nUa.startsWith(needle) || nEn.startsWith(needle)) score += 3;
      if (nUa.includes(needle) || nEn.includes(needle)) score += 2;
      if (needle.includes(nUa) || needle.includes(nEn)) score += 1;
      return { id: row.id, score };
    })
    .sort((a, b) => b.score - a.score);

  if (!scored.length || scored[0].score <= 0) return null;
  const best = scored[0];
  const next = scored[1] || null;
  if (!next || best.score >= next.score + 2) {
    return best.id;
  }

  return null;
}

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
  const { order_item_id } = op || {};
  const item_code = op?.item_code || op?.code || null;

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
  const rawItemCode = op?.item_code || op?.itemCode || op?.code || null;
  const opItemCode = rawItemCode ? String(rawItemCode).trim() : null;
  const opMenuItemId = op?.menu_item_id || op?.menuItemId || null;
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
      let menuItemId = opMenuItemId;

      // если нет menu_item_id, но есть item_code — ищем блюдо по коду
      if (!menuItemId && opItemCode) {
        menuItemId = await resolveMenuItemIdByCodeFallback(
          session.restaurant_id,
          opItemCode
        );
      }

      if (!menuItemId) {
        const err = new Error(
          opItemCode
            ? `No active menu item found for item_code: ${opItemCode}`
            : 'menu_item_id or item_code is required'
        );
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
