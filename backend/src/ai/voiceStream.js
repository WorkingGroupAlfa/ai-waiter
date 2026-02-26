// backend/src/ai/voiceStream.js
import { WebSocketServer } from 'ws';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { transcribeAudioBuffer } from './asrService.js';
import { isSpeechPresent } from './noiseClassifier.js';
import { streamTtsOverWs } from './ttsService.js';
import { handleUserMessage } from './dialogManager.js';
import { insertPerformanceMetric } from '../models/performanceMetricsModel.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// uploads лежит на уровень выше src: backend/uploads
// Здесь директория используется только для совместимости;
// основная работа с файлами происходит в asrService.
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');

function ensureUploadsDir() {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
}

/**
 * Инициализация WebSocket сервера для стриминга голоса
 * Путь: ws://host:port/api/v1/voice/stream?session_token=...
 *
 * Клиент → сервер:
 *   - бинарные чанки audio/webm (MediaRecorder)
 *   - JSON:
 *       { type: 'ping' }
 *       { type: 'end' }          // конец фразы
 *       { type: 'audio_chunk', data: <base64> } // старый режим, оставляем для совместимости
 *
 * Сервер → клиент:
 *   - JSON:
 *       { type: 'pong' }
 *       { type: 'no_speech' }
 *       { type: 'asr_final', text, asrMs }
 *       {
 *         type: 'dm_reply',
 *         inputText,
 *         replyText,
 *         actions,
 *         asrMs,
 *         dmMs
 *       }
 *       { type: 'thinking', phrase }
 *       { type: 'tts_done', asrMs, dmMs, ttsMs }
 *       { type: 'tts_failed', replyText, actions, asrMs, dmMs, ttsMs }
 *       { type: 'error', message }
 *
 *   - бинарные сообщения:
 *       MP3-чанки TTS (без обёртки)
 */
export function setupVoiceWebSocket(server) {
  ensureUploadsDir();

  const wss = new WebSocketServer({
    server,
    path: '/api/v1/voice/stream',
  });

  console.log('[VoiceWS] WebSocket voice stream enabled at /api/v1/voice/stream');

  wss.on('connection', (ws, req) => {
    console.log('[VoiceWS] New client connected');

    let sessionToken = null;
    try {
      const url = new URL(req.url, 'http://localhost');
      sessionToken =
        url.searchParams.get('session_token') || url.searchParams.get('token');
    } catch (err) {
      console.warn('[VoiceWS] Failed to parse session_token from URL:', err);
    }

    const state = {
      chunks: [],
      closed: false,
      sessionToken: sessionToken || null,
    };

    ws.on('message', async (data, isBinary) => {
      try {
        // Бинарное сообщение — считаем, что это аудио-чанк
        if (isBinary) {
          if (state.closed) return;
          state.chunks.push(Buffer.from(data));
          return;
        }

        // Текст / JSON
        let msg;
        try {
          msg = JSON.parse(data.toString());
        } catch (e) {
          console.warn('[VoiceWS] Non-JSON text message, ignoring');
          return;
        }

        const type = msg.type;

        if (type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
          return;
        }

        if (type === 'audio_chunk' && msg.data) {
          // Старый режим, когда клиент шлёт base64-аудио
          const buf = Buffer.from(msg.data, 'base64');
          state.chunks.push(buf);
          return;
        }

        if (type === 'end' || type === 'end_utterance') {
          if (!state.chunks.length) {
            ws.send(
              JSON.stringify({
                type: 'error',
                message: 'No audio data received',
              }),
            );
            return;
          }

          const audioBuffer = Buffer.concat(state.chunks);
          state.chunks = [];

          // Шум/тишина — не запускаем ASR
          if (!isSpeechPresent(audioBuffer)) {
            ws.send(JSON.stringify({ type: 'no_speech' }));
            return;
          }

          const asrStart = Date.now();
          let asrText = '';
          let asrMs = 0;

          try {
            const asrResult = await transcribeAudioBuffer(audioBuffer, {
              mimeType: msg.mimeType || 'audio/webm',
            });
            asrText = (asrResult && asrResult.text) || '';
            asrMs = Date.now() - asrStart;

            await insertPerformanceMetric({
              metricName: 'voice.asr',
              scope: 'voice_ws',
              durationMs: asrMs,
              labels: {
                has_error: false,
              },
              meta: {
                text_length: asrText.length,
              },
            });
          } catch (err) {
            console.error('[VoiceWS] ASR error:', err);

            await insertPerformanceMetric({
              metricName: 'voice.asr',
              scope: 'voice_ws',
              durationMs: Date.now() - asrStart,
              labels: {
                has_error: true,
              },
              meta: {
                errorMessage: err?.message || String(err),
              },
            });

            ws.send(
              JSON.stringify({
                type: 'error',
                message: 'ASR internal error',
              }),
            );
            return;
          }

          ws.send(
            JSON.stringify({
              type: 'asr_final',
              text: asrText,
              asrMs,
            }),
          );

          // Режим "только ASR" (старый клиент): если нет sessionToken, на этом останавливаемся.
          if (!state.sessionToken || !asrText.trim()) {
            console.log('[VoiceWS] ASR-only mode or empty text, skip DM/TTS');
            return;
          }

          // UX: подсказка "думаю" для голосового ассистента
          ws.send(
            JSON.stringify({
              type: 'thinking',
              phrase: 'Секунду, уточню...',
            }),
          );

          // ---- Dialog Manager ----
          const dmStart = Date.now();
          let replyText = '';
          let actions = {};
          let dmMs = 0;

          try {
            const dmResult = await handleUserMessage({
              sessionToken: state.sessionToken,
              text: asrText,
              source: 'voice',
            });

            replyText = (dmResult && dmResult.replyText) || '';
            actions = (dmResult && dmResult.actions) || {};
            dmMs = Date.now() - dmStart;

            await insertPerformanceMetric({
              metricName: 'voice.dm',
              scope: 'voice_ws',
              durationMs: dmMs,
              labels: {
                has_error: false,
              },
              meta: {
                input_length: asrText.length,
                reply_length: replyText.length,
              },
            });
          } catch (err) {
            console.error('[VoiceWS] DialogManager error:', err);

            await insertPerformanceMetric({
              metricName: 'voice.dm',
              scope: 'voice_ws',
              durationMs: Date.now() - dmStart,
              labels: {
                has_error: true,
              },
              meta: {
                errorMessage: err?.message || String(err),
              },
            });

            ws.send(
              JSON.stringify({
                type: 'error',
                message: 'Dialog Manager error',
              }),
            );
            return;
          }

          ws.send(
            JSON.stringify({
              type: 'dm_reply',
              inputText: asrText,
              replyText,
              actions,
              asrMs,
              dmMs,
            }),
          );

          if (!replyText.trim()) {
            console.log('[VoiceWS] Empty replyText, skipping TTS');
            return;
          }

          // ---- TTS ----
          const ttsStart = Date.now();
          let ttsMs = 0;

          try {
            await streamTtsOverWs({
              ws,
              text: replyText,
              voice: 'alloy',
              chunkSize: 16 * 1024,
            });
            ttsMs = Date.now() - ttsStart;

            await insertPerformanceMetric({
              metricName: 'voice.tts',
              scope: 'voice_ws',
              durationMs: ttsMs,
              labels: {
                has_error: false,
              },
              meta: {
                reply_length: replyText.length,
              },
            });
          } catch (err) {
            console.error('[VoiceWS] TTS error:', err);

            ttsMs = Date.now() - ttsStart;

            await insertPerformanceMetric({
              metricName: 'voice.tts',
              scope: 'voice_ws',
              durationMs: ttsMs,
              labels: {
                has_error: true,
              },
              meta: {
                errorMessage: err?.message || String(err),
                reply_length: replyText.length,
              },
            });

            // Fallback по ТЗ: отдать текст без аудио
            ws.send(
              JSON.stringify({
                type: 'tts_failed',
                replyText,
                actions,
                asrMs,
                dmMs,
                ttsMs,
              }),
            );
            return;
          }

          ws.send(
            JSON.stringify({
              type: 'tts_done',
              asrMs,
              dmMs,
              ttsMs,
            }),
          );

          console.log('[VoiceWS] timings:', {
            asrMs,
            dmMs,
            ttsMs,
            inputText: asrText,
            replyLength: replyText.length,
          });

          return;
        }
      } catch (err) {
        console.error('[VoiceWS] Unexpected error on message:', err);
        ws.send(
          JSON.stringify({
            type: 'error',
            message: 'Unexpected WS error',
          }),
        );
      }
    });

    ws.on('close', () => {
      console.log('[VoiceWS] Client disconnected');
      state.closed = true;
      state.chunks = [];
    });

    ws.on('error', (err) => {
      console.error('[VoiceWS] WebSocket error:', err);
    });
  });
}
