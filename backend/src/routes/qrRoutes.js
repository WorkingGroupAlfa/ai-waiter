// src/routes/qrRoutes.js
import express from 'express';
import { adminAuth } from '../middleware/adminAuth.js';
import {
  verifyQrAndCreateSession,
  createAdminQrToken,
  createOrGetPersistentTableQr,
  issueSessionByTableCode,
} from '../services/qrService.js';
import { sendError } from '../utils/errors.js';

export const qrRouter = express.Router();

/**
 * DEV / ADMIN эндпоинт:
 * POST /api/v1/qr/admin/create
 * body: { restaurant_id, table_id, ttl_minutes? }
 *
 * Генерирует одноразовый qr_token со сроком жизни.
 */
qrRouter.post('/admin/create', adminAuth, async (req, res) => {
  try {
    const { restaurant_id, table_id, ttl_minutes } = req.body || {};

    if (!restaurant_id || !table_id) {
      return sendError(
        res,
        400,
        'VALIDATION_ERROR',
        'restaurant_id і table_id є обовʼязковими'
      );
    }

    const result = await createAdminQrToken({
      restaurantId: restaurant_id,
      tableId: table_id,
      ttlMinutes: ttl_minutes,
    });

    return res.json(result);
  } catch (err) {
    console.error('Error creating QR token', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * ADMIN endpoint:
 * POST /api/v1/qr/admin/table-code
 * body: { restaurant_id, table_id, rotate? }
 *
 * Returns a persistent table_code + qr_url for printable static QR.
 */
qrRouter.post('/admin/table-code', adminAuth, async (req, res) => {
  try {
    const { restaurant_id, table_id, rotate } = req.body || {};

    if (!restaurant_id || !table_id) {
      return sendError(
        res,
        400,
        'VALIDATION_ERROR',
        'restaurant_id and table_id are required'
      );
    }

    const result = await createOrGetPersistentTableQr({
      restaurantId: restaurant_id,
      tableId: table_id,
      rotate: Boolean(rotate),
    });

    return res.json(result);
  } catch (err) {
    console.error('Error creating persistent table QR', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Публичный эндпоинт:
 * POST /api/v1/qr/verify
 * body: { qr_token }
 *
 * Проверяет QR-токен, создаёт session_token для текущего device_id.
 */
qrRouter.post('/verify', async (req, res) => {
  try {
    const { qr_token } = req.body;
    const deviceId = req.deviceId;

    if (!qr_token) {
      return res.status(400).json({ error: 'qr_token is required' });
    }

    if (!deviceId) {
      return res.status(400).json({ error: 'Device ID is missing' });
    }

    const result = await verifyQrAndCreateSession({
      qrToken: qr_token,
      deviceId,
    });

    if (result.status === 'NOT_FOUND') {
      return res.status(404).json({ error: 'QR token not found' });
    }

    if (result.status === 'ALREADY_USED') {
      return res.status(400).json({ error: 'QR token already used' });
    }

    if (result.status === 'EXPIRED') {
      return res.status(400).json({ error: 'QR token expired' });
    }

    // OK
    return res.json(result.session);
  } catch (err) {
    console.error('Error verifying QR token', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * Public endpoint:
 * POST /api/v1/qr/table-code/issue
 * body: { table_code }
 *
 * Creates a fresh chat session for persistent static table QR.
 */
qrRouter.post('/table-code/issue', async (req, res) => {
  try {
    const { table_code } = req.body || {};
    const deviceId = req.deviceId;

    if (!table_code) {
      return res.status(400).json({ error: 'table_code is required' });
    }

    if (!deviceId) {
      return res.status(400).json({ error: 'Device ID is missing' });
    }

    const result = await issueSessionByTableCode({
      tableCode: String(table_code).trim(),
      deviceId,
    });

    if (result.status === 'NOT_FOUND') {
      return res.status(404).json({ error: 'table_code not found' });
    }

    return res.json(result.session);
  } catch (err) {
    console.error('Error issuing session by table_code', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
