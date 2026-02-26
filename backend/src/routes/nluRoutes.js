// src/routes/nluRoutes.js
import express from 'express';
import { parseUserInput } from '../ai/nluService.js';

export const nluRouter = express.Router();

/**
 * POST /api/v1/nlu/parse
 * body: {
 *   text: string;
 *   locale?: string;        // опционально, ISO-код языка
 *   restaurant_id?: string; // опционально, чтобы включить контекст ресторана
 * }
 *
 * Возвращает:
 * {
 *   intent,
 *   items: [...],
 *   meta: { emotion, language, clarificationNeeded }
 * }
 */
nluRouter.post('/parse', async (req, res) => {
  const { text, locale, restaurant_id } = req.body || {};

  try {
    if (!text || !String(text).trim()) {
      return res.status(400).json({ error: 'text is required' });
    }

    const nlu = await parseUserInput({
      text: String(text),
      locale: locale || undefined,
      sessionContext: {
        restaurantId: restaurant_id || null,
      },
    });

    return res.json(nlu);
  } catch (err) {
    console.error('Error in /nlu/parse:', err);
    return res.status(500).json({ error: 'Internal NLU error' });
  }
});




