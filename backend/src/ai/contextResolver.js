// src/ai/contextResolver.js
// Contextual Reference Resolver:
//
// понимает "ещё один такой", "убери это", "сделай его острым", "не это, а второе"
// и т.д. Работает поверх результата NLU и текущего состояния диалога/заказа.

// Вместо RegExp используем устойчивый поиск по подстроке в lowercase,
// чтобы обойти любые странности с кодировками/локалями на Windows/Node.

const PHRASES_ADD = [
  'ещё один',
  'еще один',
  'ще один',
  'one more',
  'another one',
  'same again',
];

const PHRASES_REMOVE = [
  'убери это',
  'удали это',
  'убери его',
  'удали его',
  'remove this',
  'remove it',
  'delete it',
];

const PHRASES_SECOND = [
  'не это, а второе',
  'не это а второе',
  'не то, а второе',
  'not this but the second',
  'the second one',
];

const PHRASES_SPICY = [
  'острый',
  'острым',
  'острее',
  'гострий',
  'spicy',
];

function normalizeIntent(intent) {
  if (!intent) return 'unknown';
  if (intent === 'modify') return 'modify_order';
  return intent;
}

function hasPhrase(text, phrases) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return phrases.some((p) => lower.includes(p));
}

/**
 * @param {object} params
 * @param {object} params.nluResult - результат parseUserInput + rawText
 * @param {object|null} params.dialogState - строка из dialog_state или null
 * @param {object|null} params.currentOrder - текущий заказ с items
 *
 * @returns {{
 *   intent: string,
 *   actions: Array<{ type: string, payload: any }>,
 *   contextPatch: {
 *     lastFocusedOrderItemId?: string|null,
 *     lastFocusedMenuItemId?: string|null,
 *     lastFocusedItemCode?: string|null,
 *     lastFocusedItemName?: string|null,
 *   }
 * }}
 */
export function resolveReferences({ nluResult, dialogState, currentOrder }) {
  const rawText = (nluResult?.rawText || '').toString();
  let intent = normalizeIntent(nluResult?.intent);
  const items = Array.isArray(nluResult?.items) ? nluResult.items : [];

  const orderItems = Array.isArray(currentOrder?.items) ? currentOrder.items : [];

  const lastFocusedOrderItemId =
    dialogState?.last_focused_order_item_id ||
    dialogState?.lastFocusedOrderItemId ||
    null;
  const lastFocusedMenuItemId =
    dialogState?.last_focused_menu_item_id ||
    dialogState?.lastFocusedMenuItemId ||
    null;

  // Паттерны по тексту (через includes)
  const hasRemovePronoun = hasPhrase(rawText, PHRASES_REMOVE);
  const hasAddPronoun = hasPhrase(rawText, PHRASES_ADD);
  const hasSpicyPronoun = hasPhrase(rawText, PHRASES_SPICY);
  const hasSecondPronoun = hasPhrase(rawText, PHRASES_SECOND);

  // Если NLU сказал "unknown", но в тексте есть наши паттерны — поднимаем intent
  if (!intent || intent === 'unknown') {
    if (hasRemovePronoun || hasSpicyPronoun || hasSecondPronoun) {
      intent = 'modify_order';
    } else if (hasAddPronoun) {
      // "ещё один такой" без явных блюд — тоже изменение текущего заказа
      intent = 'modify_order';
    }
  }

  // Фокус по умолчанию — last-focused item из dialog_state,
  // если его нет — последняя позиция в заказе.
  let focusedOrderItem =
    (lastFocusedOrderItemId &&
      orderItems.find((it) => it.id === lastFocusedOrderItemId)) ||
    (orderItems.length > 0 ? orderItems[orderItems.length - 1] : null);

  const actions = [];
  const contextPatch = {
    lastFocusedOrderItemId:
      lastFocusedOrderItemId || (focusedOrderItem && focusedOrderItem.id) || null,
    lastFocusedMenuItemId: lastFocusedMenuItemId || null,
    lastFocusedItemCode: focusedOrderItem?.item_code || null,
    lastFocusedItemName: focusedOrderItem?.item_name || null,
  };

  // ---------- ВЕТКА: заказ / явное добавление блюд ----------
  if (intent === 'order' || intent === 'add_to_order') {
    for (const it of items) {
      const menuItemId = it.menu_item_id || null;
      const quantity = Number.isFinite(it.quantity) ? it.quantity : 1;
      const modifiers = Array.isArray(it.modifiers) ? it.modifiers : [];

      if (menuItemId) {
        actions.push({
          type: 'add_item',
          payload: {
            menuItemId,
            quantity,
            modifiers,
            matchConfidence: Number.isFinite(Number(it.matchConfidence))
              ? Number(it.matchConfidence)
              : 0,
            rawText: it.rawText || null,
          },
        });
        contextPatch.lastFocusedMenuItemId = menuItemId;
      } else if (hasAddPronoun && lastFocusedMenuItemId) {
        // "ещё один" прямо после того, как только что заказывали конкретное блюдо
        actions.push({
          type: 'add_item',
          payload: {
            menuItemId: lastFocusedMenuItemId,
            quantity,
            modifiers,
            matchConfidence: Number.isFinite(Number(it.matchConfidence))
              ? Number(it.matchConfidence)
              : 0,
            rawText: it.rawText || null,
          },
        });
      }
    }
  }

  // ---------- ВЕТКА: модификация заказа ----------
  else if (intent === 'modify_order') {
    // Определяем таргет — по last-focused, либо "второе блюдо"
    let targetItem = focusedOrderItem;

    if (hasSecondPronoun && orderItems.length >= 2) {
      targetItem = orderItems[1];
    }

    if (targetItem) {
      contextPatch.lastFocusedOrderItemId = targetItem.id;
      contextPatch.lastFocusedItemCode = targetItem.item_code || null;
      contextPatch.lastFocusedItemName = targetItem.item_name || null;
    }

    // Удаление
    if (hasRemovePronoun && targetItem) {
      actions.push({
        type: 'remove_item',
        payload: {
          orderItemId: targetItem.id,
        },
      });
    }

    // Сделать острым
    if (hasSpicyPronoun && targetItem) {
      actions.push({
        type: 'update_modifiers',
        payload: {
          orderItemId: targetItem.id,
          // простейшая логика: ставим флаг spicy = true
          modifiersPatch: { spicy: true },
        },
      });
    }

    // Ещё один такой же → увеличить quantity последнего блюда
    if (hasAddPronoun && targetItem) {
      actions.push({
        type: 'increment_quantity',
        payload: {
          orderItemId: targetItem.id,
          delta: 1,
        },
      });
    }

    // здесь потом можно расширять: "без цибулі", "додай сир" и т.п.
  }

  // ---------- ВЕТКА: отмена всего заказа ----------
  else if (intent === 'cancel_order') {
    actions.push({
      type: 'cancel_order',
      payload: {},
    });
  }

  return {
    intent,
    actions,
    contextPatch,
  };
}



