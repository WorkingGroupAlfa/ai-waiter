// backend/src/routes/voiceRoutes.js
import express from 'express';
import multer from 'multer';
import {
  transcribeAudioFile,
  synthesizeSpeech,
} from '../services/voiceService.js';

export const voiceRouter = express.Router();

// Мультер для обработки audio/form-data
const upload = multer({ dest: 'uploads/' });

/**
 * POST /api/v1/voice/asr
 * Speech → Text (Whisper)
 * Принимает файл: form-data { audio: <file> }
 */
voiceRouter.post('/asr', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Audio file is required' });
    }

    const audioPath = req.file.path;

    const text = await transcribeAudioFile(audioPath);

    return res.json({ text });
  } catch (err) {
    console.error('ASR error:', err);

    // Можно чуть красивее различать типы ошибок, но чтобы не ломать поведение — оставим 500
    return res.status(500).json({ error: 'ASR internal error' });
  }
});

/**
 * POST /api/v1/voice/tts
 * Text → Speech (TTS)
 * Принимает JSON: { text: "Hello", voice: "alloy" }
 * Возвращает аудиофайл mp3
 */
voiceRouter.post('/tts', async (req, res) => {
  try {
    const { text, voice } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    const buffer = await synthesizeSpeech({ text, voice });

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': buffer.length,
    });

    return res.send(buffer);
  } catch (err) {
    console.error('TTS error:', err);
    return res.status(500).json({ error: 'TTS internal error' });
  }
});

