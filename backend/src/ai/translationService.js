// src/ai/translationService.js
// Простой Translation Service на базе OpenAI.

import { openai, hasOpenAI } from '../services/openaiClient.js';

const DEFAULT_TRANSLATION_MODEL =
  process.env.OPENAI_TRANSLATION_MODEL ||
  process.env.OPENAI_NLU_MODEL ||
  'gpt-4o-mini';

/**
 * Перевод текста в EN для semantic matching.
 *
 * @param {string} text       — исходный текст пользователя
 * @param {string} sourceLang — код языка (например, "ru", "uk", "en", "pl"), можно null
 * @returns {Promise<string>} — текст на английском или исходный текст при ошибке
 */
export async function translateToEnglish(text, sourceLang) {
  const original = String(text ?? '');
  const trimmed = original.trim();

  if (!trimmed) return '';

  if (!hasOpenAI) {
    // Нет ключа OpenAI — работаем без перевода.
    return original;
  }

  const systemPrompt =
    'You translate restaurant user queries into concise English for menu search. Preserve food entities and normalize transliterated dish words to canonical culinary terms when obvious (for example: rolls, sushi, sashimi, gunkan, temaki, soup, tuna, salmon, crab, shrimp). Return ONLY the translated query text.';

  const userPayload = sourceLang
    ? `Source language: ${sourceLang}\nText:\n${original}`
    : `Text:\n${original}`;

  try {
    const completion = await openai.chat.completions.create({
      model: DEFAULT_TRANSLATION_MODEL,
      temperature: 0,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPayload },
      ],
    });

    const translated = completion.choices?.[0]?.message?.content?.trim();
    if (!translated) return original;

    return translated;
  } catch (err) {
    console.error('[translationService] translateToEnglish error', err);
    // Fallback — работаем как раньше, без перевода
    return original;
  }
}

/**
 * На будущее: перевод из EN в targetLang.
 *
 * @param {string} textEn     — текст на английском
 * @param {string} targetLang — целевой язык (например, "ru", "uk", "es")
 * @returns {Promise<string>} — переведённый текст или оригинал при ошибке
 */
export async function translateFromEnglish(textEn, targetLang) {
  const original = String(textEn ?? '');
  const trimmed = original.trim();

  if (!trimmed) return '';
  if (!targetLang) return original;

  if (!hasOpenAI) {
    return original;
  }

  const systemPrompt =
    'You are a translation engine. Translate from English into the requested target language. Return ONLY the translated text without any explanations.';

  const userPayload = `Target language: ${targetLang}\nText:\n${original}`;

  try {
    const completion = await openai.chat.completions.create({
      model: DEFAULT_TRANSLATION_MODEL,
      temperature: 0,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPayload },
      ],
    });

    const translated = completion.choices?.[0]?.message?.content?.trim();
    if (!translated) return original;

    return translated;
  } catch (err) {
    console.error('[translationService] translateFromEnglish error', err);
    return original;
  }
}
