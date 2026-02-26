// src/routes/eventsRoutes.js
import express from 'express';
import { sessionAuth } from '../middleware/sessionAuth.js';
import { logEvent } from '../services/eventService.js';

export const eventsRouter = express.Router();

/**
 * POST /api/v1/events
 *
 * body: { event_type: string, payload?: object }
 *
 * session берём из x-session-token (sessionAuth),
 * device_id тоже тянем из middleware.
 */
eventsRouter.post('/', sessionAuth, async (req, res) => {
  try {
    const session = req.session;
    const deviceId = req.deviceId;

    const { event_type, payload } = req.body || {};

    if (!event_type || typeof event_type !== 'string') {
      return res.status(400).json({ error: 'event_type is required' });
    }

    await logEvent(
      event_type,
      { session, deviceId },
      payload || {}
    );

    return res.json({ status: 'ok' });
  } catch (err) {
    console.error('Error in POST /api/v1/events', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

