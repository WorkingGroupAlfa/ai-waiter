import { v4 as uuidv4 } from 'uuid';
import { touchDeviceProfile } from '../services/deviceProfileService.js';

export async function deviceIdMiddleware(req, res, next) {
  try {
    let deviceId = req.cookies?.device_id;

    if (!deviceId) {
      deviceId = uuidv4();

      res.cookie('device_id', deviceId, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 24 * 365, // 1 год
      });
    }

    req.deviceId = deviceId;

    // ⬇️ ВАЖНО: ждём, пока профиль создастся/обновится
    await touchDeviceProfile(deviceId);

    return next();
  } catch (err) {
    console.error('Error in deviceIdMiddleware', err);
    // Если прям очень не хочешь валить запросы из-за проблем с БД —
    // можно всё равно вызвать next(), но FK всё равно будет падать.
    return next();
  }
}
