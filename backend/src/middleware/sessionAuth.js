// src/middleware/sessionAuth.js
import { getSessionByToken, touchSession } from '../services/sessionService.js';

/**
 * Проверяет x-session-token, достаёт сессию из БД и кладёт в req.session
 */
export async function sessionAuth(req, res, next) {
  try {
    const sessionToken = req.headers['x-session-token'];

    if (!sessionToken) {
      return res.status(401).json({ error: 'x-session-token header is required' });
    }

    const session = await getSessionByToken(sessionToken);

    if (!session) {
      return res.status(401).json({ error: 'Session not found' });
    }

    const now = new Date();

    if (session.status !== 'active') {
      return res.status(401).json({ error: 'Session is not active' });
    }

    if (new Date(session.expires_at) < now) {
      return res.status(401).json({ error: 'Session expired' });
    }

    // Обновляем last_activity через сервис (модель)
    await touchSession(session.id);

    req.session = session;        // вся строка сессии
    req.sessionId = session.id;   // удобный alias
    // синхронизуем deviceId
    req.deviceId = session.device_id;

    next();
  } catch (err) {
    console.error('Error in sessionAuth middleware', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
