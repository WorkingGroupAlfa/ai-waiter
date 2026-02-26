// src/routes/sessionRoutes.js
import express from 'express';
import { startDevSession, getSessionByToken } from '../services/sessionService.js';
import { getDeviceProfile } from '../services/deviceProfileService.js';

export const sessionRouter = express.Router();

/**
 * DEV-эндпоинт для старта сессии без QR.
 * POST /api/v1/session/dev-start
 * body: { restaurant_id, table_id }
 */
sessionRouter.post('/dev-start', async (req, res) => {
  try {
    const { restaurant_id, table_id } = req.body;
    const deviceId = req.deviceId;

    if (!restaurant_id || !table_id) {
      return res.status(400).json({ error: 'restaurant_id and table_id are required' });
    }

    const payload = await startDevSession({
      restaurantId: restaurant_id,
      tableId: table_id,
      deviceId,
    });

    return res.json(payload);
  } catch (err) {
    console.error('Error creating session', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/v1/session/me
 * — посмотреть текущую сессию по session_token
 * session_token передаём в заголовке x-session-token
 */
sessionRouter.get('/me', async (req, res) => {
  try {
    const sessionToken = req.headers['x-session-token'];

    if (!sessionToken) {
      return res.status(400).json({ error: 'x-session-token header is required' });
    }

    const session = await getSessionByToken(sessionToken);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    return res.json({
      id: session.id,
      device_id: session.device_id,
      restaurant_id: session.restaurant_id,
      table_id: session.table_id,
      status: session.status,
      created_at: session.created_at,
      last_activity: session.last_activity,
      expires_at: session.expires_at,
    });
  } catch (err) {
    console.error('Error fetching session', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/v1/session/device/profile
 * — посмотреть профиль текущего устройства по device_id из cookie
 */
sessionRouter.get('/device/profile', async (req, res) => {
  try {
    const deviceId = req.deviceId;

    if (!deviceId) {
      return res.status(400).json({ error: 'Device ID not found in request' });
    }

    const profile = await getDeviceProfile(deviceId);

    if (!profile) {
      return res.status(404).json({ error: 'Device profile not found' });
    }

    return res.json(profile);
  } catch (err) {
    console.error('Error fetching device profile', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
