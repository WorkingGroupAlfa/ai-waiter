// src/services/sessionService.js
import {
  findSessionById,
  updateSessionLastActivity,
} from '../models/sessionModel.js';

/**
 * Получить сессию по токену (используется /session/me и sessionAuth)
 */
export async function getSessionByToken(sessionToken) {
  return findSessionById(sessionToken);
}

/**
 * Обновить last_activity (используется в sessionAuth)
 */
export async function touchSession(sessionId) {
  await updateSessionLastActivity(sessionId);
}
