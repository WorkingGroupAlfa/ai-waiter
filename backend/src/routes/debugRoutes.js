// src/routes/debugRoutes.js
import express from 'express';
import { parseUserInput } from '../ai/nluService.js';
import { resolveReferences } from '../ai/contextResolver.js';

export const debugRouter = express.Router();

/**
 * POST /api/v1/debug/nlu
 * body: { text, locale?, restaurant_id? }
 *
 * Возвращает:
 * {
 *   intent,
 *   items: [{ rawText, quantity, modifiers, allergensRisk, menu_item_id, matchConfidence, matchSource }],
 *   meta: { emotion, language, clarificationNeeded }
 * }
 */
debugRouter.post('/nlu', async (req, res) => {
  try {
    const { text, locale, restaurant_id } = req.body || {};

    if (!text || !String(text).trim()) {
      return res.status(400).json({ error: 'text is required' });
    }

    const nluResult = await parseUserInput({
      text,
      locale,
      sessionContext: {
        restaurantId: restaurant_id || null,
      },
    });

    return res.json(nluResult);
  } catch (err) {
    console.error('Error in POST /api/v1/debug/nlu', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/v1/debug/context-resolver
 * body: { text, locale?, restaurant_id?, order?, dialog_state? }
 *
 * Возвращает:
 * {
 *   nlu: ...,
 *   resolved: {
 *     intent,
 *     actions,
 *     contextPatch
 *   }
 * }
 */
debugRouter.post('/context-resolver', async (req, res) => {
  try {
    const { text, locale, restaurant_id, order, dialog_state } = req.body || {};

    if (!text || !String(text).trim()) {
      return res.status(400).json({ error: 'text is required' });
    }

    const nluResult = await parseUserInput({
      text,
      locale,
      sessionContext: {
        restaurantId: restaurant_id || null,
      },
    });

    const resolved = resolveReferences({
      nluResult: { ...nluResult, rawText: text },
      dialogState: dialog_state || null,
      currentOrder: order || null,
    });

    return res.json({
  nlu: nluResult,
  resolved,
  resolver_version: 'v2-phrases-includes'
});
  } catch (err) {
    console.error('Error in POST /api/v1/debug/context-resolver', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
