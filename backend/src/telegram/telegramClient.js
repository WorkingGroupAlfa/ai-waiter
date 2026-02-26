// src/telegram/telegramClient.js
// Низкоуровневый клиент для Telegram Bot API на базе HTTPS-запроса.
// Без node-telegram-bot-api и без завязки на config/env.js.

 /**
  * Универсальная отправка сообщения в Telegram.
  * options сейчас используем только для parse_mode,
  * чтобы не усложнять клиент.
  */
export async function sendTelegramMessage(chatId, text, options = {}) {
  // Берём токен напрямую из process.env,
  // как это было в старом telegramService.
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    console.warn(
      '[Telegram] TELEGRAM_BOT_TOKEN is not set, cannot send message.'
    );
    return;
  }

  if (!chatId) {
    console.warn('[Telegram] chatId is not provided, cannot send message.');
    return;
  }

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  const payload = {
    chat_id: chatId,
    text,
    // передаём parse_mode, если есть
    ...(options.parse_mode ? { parse_mode: options.parse_mode } : {}),
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(
        '[Telegram] API error',
        res.status,
        res.statusText,
        body
      );
    }
  } catch (err) {
    console.error('[Telegram] Failed to send message via Telegram API', err);
  }
}


