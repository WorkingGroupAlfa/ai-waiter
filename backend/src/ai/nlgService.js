// src/ai/nlgService.js
// NLG-слой: базовый текст на EN -> ответ на языке гостя.

import { translateFromEnglish } from './translationService.js';

/**
 * Переводит baseTextEn на targetLanguage.
 * Если targetLanguage = 'en' или перевод не удался — возвращает baseTextEn.
 *
 * @param {object} params
 * @param {string} params.baseTextEn    — базовый текст на английском
 * @param {string} params.targetLanguage — ISO-код языка ответа (например, 'en', 'ru', 'uk', 'es', 'pl')
 */
export async function respondInLanguage({ baseTextEn, targetLanguage }) {
  const base = (baseTextEn ?? '').toString();
  const lang = (targetLanguage || 'en').toLowerCase();

  if (!base) return '';

  // Для английского не дергаем лишний раз OpenAI.
  if (lang === 'en') {
    return base;
  }

  try {
    const translated = await translateFromEnglish(base, lang);
    // На всякий случай фолбек на английский
    return translated || base;
  } catch (err) {
    console.error('[nlgService] respondInLanguage error', err);
    return base;
  }
}
