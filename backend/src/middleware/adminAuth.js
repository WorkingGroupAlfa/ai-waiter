// src/middleware/adminAuth.js
import { sendError } from '../utils/errors.js';

/**
 * Простейшая админ-авторизация по токену.
 * Используем для /qr/admin/* и будущих /admin/analytics/*.
 */
export function adminAuth(req, res, next) {
  const headerToken = req.header('x-admin-token');
  const queryToken = req.query.admin_token;
  const token = headerToken || queryToken || null;

  const expected = process.env.ADMIN_TOKEN;

  if (!expected) {
    console.warn('[adminAuth] ADMIN_TOKEN is not set in environment');
    return sendError(
      res,
      500,
      'ADMIN_CONFIG_ERROR',
      'Admin access is not configured on the server'
    );
  }

  if (!token || token !== expected) {
    return sendError(res, 401, 'UNAUTHORIZED', 'Адмін-доступ заборонено');
  }

  return next();
}
