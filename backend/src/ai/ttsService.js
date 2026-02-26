// backend/src/ai/ttsService.js
import { WebSocket } from 'ws';
import { synthesizeSpeech } from '../services/voiceService.js';

/**
 * Обёртка над HTTP TTS-сервисом для использования в WebSocket-пайплайне.
 *
 * @param {string} text
 * @param {object} [options]
 * @param {string} [options.voice]
 * @returns {Promise<Buffer>}
 */
export async function synthesizeTtsBuffer(text, { voice } = {}) {
  const buffer = await synthesizeSpeech({ text, voice });
  return buffer;
}

/**
 * Стримит TTS-аудио чанками по WebSocket.
 *
 * Формат: сервер шлёт чистый бинарный MP3 без обёртки.
 * Клиент отличает бинарные чанки от JSON по типу event.data.
 *
 * @param {object} params
 * @param {import('ws').WebSocket} params.ws
 * @param {string} params.text
 * @param {string} [params.voice]
 * @param {number} [params.chunkSize] - размер чанка в байтах
 */
export async function streamTtsOverWs({
  ws,
  text,
  voice = 'alloy',
  chunkSize = 16 * 1024,
}) {
  if (!text || !String(text).trim()) {
    return;
  }

  const buffer = await synthesizeTtsBuffer(text, { voice });

  const totalLength = buffer.length;
  let offset = 0;

  while (offset < totalLength) {
    if (ws.readyState !== WebSocket.OPEN) {
      break;
    }

    const end = Math.min(offset + chunkSize, totalLength);
    const chunk = buffer.subarray(offset, end);

    try {
      ws.send(chunk, { binary: true });
    } catch (err) {
      console.error('[ttsService] WS send error:', err);
      break;
    }

    offset = end;
  }
}
