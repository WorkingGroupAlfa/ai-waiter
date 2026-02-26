// src/utils/errors.js

/**
 * Унифицированный ответ с ошибкой.
 *
 * @param {Response} res
 * @param {number} statusCode - HTTP статус (400, 401, 404, 500 ...)
 * @param {string} code       - машинное имя ошибки (SESSION_NOT_FOUND, UNAUTHORIZED, ...)
 * @param {string} message    - человекочитаемое сообщение
 * @param {object} [extra]    - доп. поля (опционально)
 */
export function sendError(res, statusCode, code, message, extra = {}) {
  return res.status(statusCode).json({
    error: code,
    message,
    ...extra,
  });
}
