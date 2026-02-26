// src/services/telegramService.js
// Бизнес-логика отправки заказов в Telegram:
// форматирование + выбор chatId.
// Никаких прямых HTTP-запросов и токенов здесь нет.

import { sendTelegramMessage } from '../telegram/telegramClient.js';

/**
 * Формируем текст заказа для Телеграма.
 */
function formatOrderText(order) {
  const {
    restaurant_id,
    table_id,
    id,
    status,
    total_amount,
    submitted_at,
    items = [],
  } = order;

  const lines = [];

  lines.push('🧾 *Нове замовлення*');
  lines.push(`Ресторан: \`${restaurant_id || '-'}\``);
  lines.push(`Стіл: \`${table_id || '-'}\``);
  lines.push(`Order ID: \`${id}\``);
  lines.push(`Статус: *${status}*`);

  if (submitted_at) {
    lines.push(
      `Час: \`${new Date(submitted_at).toLocaleString('uk-UA')}\``
    );
  }

  lines.push('');
  lines.push('*Позиції:*');

  if (!items.length) {
    lines.push('_(порожнє замовлення)_');
  } else {
    for (const item of items) {
      const name = item.item_name || item.item_code || 'позиція';
      const qty = Number(item.quantity ?? 1);
      const price =
        item.unit_price != null ? `${item.unit_price}₴` : 'за меню';
      lines.push(`• ${qty} × ${name} (${price})`);
    }
  }

  lines.push('');
  const total =
    typeof total_amount === 'number'
      ? total_amount
      : parseFloat(total_amount || '0') || 0;
  lines.push(`💰 *Сума:* \`${total}₴\``);

  return lines.join('\n');
}

/**
 * Публичная функция, которую дергают orderRoutes при submit.
 */
export async function sendOrderToTelegram(order) {
  // Берём chatId напрямую из process.env,
  // поддерживаем и новый, и старый вариант имени переменной.
  const chatId =
    process.env.TELEGRAM_CHAT_ID_ORDERS || process.env.TELEGRAM_CHAT_ID;

  if (!chatId) {
    console.warn(
      '[Telegram] TELEGRAM_CHAT_ID_ORDERS or TELEGRAM_CHAT_ID is not set, skipping send.'
    );
    return;
  }

  const text = formatOrderText(order);

  try {
    await sendTelegramMessage(chatId, text, {
      parse_mode: 'Markdown',
    });
  } catch (err) {
    console.error('[Telegram] Failed to send order to Telegram', err);
    // Не пробрасываем ошибку дальше, чтобы не ломать submit заказа
  }
}

export async function sendOrderToStaff(order) {
  // "Staff" = персонал ресторана (Telegram-чат), не кухня
  return sendOrderToTelegram(order);
}

/**
 * Отправка быстрых действий (без LLM) в Telegram персоналу.
 * Например: "Позовіть офіціанта", "Попросили рахунок".
 */
function formatQuickActionText({ restaurant_id, table_id, session_id, action }) {
  const lines = [];
  lines.push('⚡️ *Quick action*');
  if (restaurant_id) lines.push(`🏷 *Restaurant:* \`${restaurant_id}\``);
  if (table_id) lines.push(`🪑 *Table:* \`${table_id}\``);
  if (session_id) lines.push(`🧾 *Session:* \`${session_id}\``);

  let label = action;
  if (action === 'request_waiter') label = '🔔 Виклик офіціанта';
  if (action === 'request_bill') label = '💳 Запит рахунку';
  lines.push(`➡️ *Action:* ${label}`);

  lines.push(`⏱ *Time:* \`${new Date().toISOString()}\``);
  return lines.join('\n');
}

export async function sendQuickActionToTelegram(payload) {
  const chatId =
    process.env.TELEGRAM_CHAT_ID_STAFF ||
    process.env.TELEGRAM_CHAT_ID_ORDERS ||
    process.env.TELEGRAM_CHAT_ID;

  if (!chatId) {
    console.warn(
      '[Telegram] TELEGRAM_CHAT_ID_STAFF or TELEGRAM_CHAT_ID_ORDERS or TELEGRAM_CHAT_ID is not set, skipping send.'
    );
    return;
  }

  const text = formatQuickActionText(payload || {});

  try {
    await sendTelegramMessage(chatId, text, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('[Telegram] Failed to send quick action to Telegram', err);
  }
}

export async function sendQuickActionToStaff(payload) {
  return sendQuickActionToTelegram(payload);
}

