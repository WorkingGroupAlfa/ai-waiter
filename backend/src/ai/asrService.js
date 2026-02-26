// backend/src/ai/asrService.js
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { openai, hasOpenAI } from '../services/openaiClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// uploads лежит на уровень выше src: backend/uploads
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');

function ensureUploadsDir() {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
}

/**
 * ASR-сервис для WebSocket-режима:
 * принимает аудио-буфер и вызывает Whisper / gpt-4o-transcribe.
 *
 * @param {Buffer} audioBuffer
 * @param {object} [options]
 * @param {string} [options.mimeType] - тип входного аудио (информативно, на OpenAI не влияет)
 * @returns {Promise<{ text: string, raw: any }>}
 */
export async function transcribeAudioBuffer(audioBuffer, { mimeType } = {}) {
  if (!audioBuffer || !audioBuffer.length) {
    throw new Error('AUDIO_BUFFER_EMPTY');
  }

  if (!hasOpenAI || !openai) {
    throw new Error('OPENAI_NOT_CONFIGURED');
  }

  ensureUploadsDir();

  // Расширение .webm чисто информативно, OpenAI сам определит формат
  const tmpName = `ws-${Date.now()}-${Math.random().toString(36).slice(2)}.webm`;
  const tmpPath = path.join(uploadsDir, tmpName);

  await fsp.writeFile(tmpPath, audioBuffer);

  try {
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath),
      model: 'gpt-4o-transcribe',
      response_format: 'json',
    });

    const text = (transcription && transcription.text) || '';
    return { text, raw: transcription };
  } finally {
    try {
      await fsp.unlink(tmpPath);
    } catch (err) {
      console.warn('[asrService] Failed to remove temp file:', tmpPath, err);
    }
  }
}
