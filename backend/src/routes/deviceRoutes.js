// src/routes/deviceRoutes.js
import express from 'express';
import { getDeviceProfile } from '../services/deviceProfileService.js';

export const deviceRouter = express.Router();

/**
 * GET /api/v1/device/profile
 * Профиль текущего устройства по device_id из cookie
 */
deviceRouter.get('/profile', async (req, res) => {
  try {
    const deviceId = req.deviceId;

    if (!deviceId) {
      return res.status(400).json({ error: 'Device ID is missing' });
    }

    // Используем сервис вместо прямого SQL
    const profile = await getDeviceProfile(deviceId, { createIfMissing: false });

    if (!profile) {
      return res.status(404).json({ error: 'Device profile not found' });
    }

    return res.json(profile);
  } catch (err) {
    console.error('Error fetching device profile', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

