// src/services/voiceService.js
import { openai, hasOpenAI } from './openaiClient.js';
import fs from 'fs';
import fsp from 'fs/promises';
import { insertPerformanceMetric } from '../models/performanceMetricsModel.js';

/**
 * ASR: файл → текст (Whisper / gpt-4o-transcribe)
 * @param {string} filePath - путь к временному аудио-файлу
 * @returns {Promise<string>} - распознанный текст
 */
export async function transcribeAudioFile(filePath) {
  if (!filePath) {
    throw new Error('filePath is required');
  }

  if (!hasOpenAI || !openai) {
    throw new Error('OPENAI_NOT_CONFIGURED');
  }

  const readStream = fs.createReadStream(filePath);

  try {
    const transcription = await openai.audio.transcriptions.create({
      file: readStream,
      model: 'gpt-4o-transcribe', // Whisper
      response_format: 'json',
    });

    return transcription.text;
  } finally {
    // Гарантированно пытаемся удалить временный файл
    try {
      await fsp.unlink(filePath);
    } catch (err) {
      console.warn('[voiceService] Failed to remove temp file:', filePath, err);
    }
  }
}

/**
 * TTS: текст → аудио (Buffer)
 * @param {object} params
 * @param {string} params.text
 * @param {string} [params.voice]
 * @returns {Promise<Buffer>}
 */
export async function synthesizeSpeech({ text, voice }) {
  const ttsStart = Date.now();
  const resolvedVoice = voice || 'alloy';

  try {
    if (!text || !String(text).trim()) {
      throw new Error('TEXT_REQUIRED');
    }

    if (!hasOpenAI || !openai) {
      throw new Error('OPENAI_NOT_CONFIGURED');
    }

    const speech = await openai.audio.speech.create({
      model: 'gpt-4o-mini-tts',
      voice: resolvedVoice,
      input: text,
      format: 'mp3',
    });

    const buffer = Buffer.from(await speech.arrayBuffer());

    await insertPerformanceMetric({
      metricName: 'tts.synthesizeSpeech',
      scope: 'voice_http',
      durationMs: Date.now() - ttsStart,
      labels: {
        has_error: false,
        voice: resolvedVoice,
      },
      meta: {
        text_length: String(text).length,
      },
    });

    return buffer;
  } catch (err) {
    await insertPerformanceMetric({
      metricName: 'tts.synthesizeSpeech',
      scope: 'voice_http',
      durationMs: Date.now() - ttsStart,
      labels: {
        has_error: true,
        voice: resolvedVoice,
      },
      meta: {
        errorMessage: err?.message || String(err),
        text_length: text ? String(text).length : 0,
      },
    });

    throw err;
  }
}