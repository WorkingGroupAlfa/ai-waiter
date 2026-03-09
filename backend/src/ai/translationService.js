// src/ai/translationService.js
// Простой Translation Service на базе OpenAI.

import { openai, hasOpenAI } from '../services/openaiClient.js';

const DEFAULT_TRANSLATION_MODEL =
  process.env.OPENAI_TRANSLATION_MODEL ||
  process.env.OPENAI_NLU_MODEL ||
  'gpt-4o-mini';

function escapeRegExp(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectLikelyBrandTerms(text) {
  const src = String(text || '');
  const out = new Set();

  // Markdown bold chunks (often dish/drink names).
  for (const m of src.matchAll(/\*\*([^*]{2,80})\*\*/g)) {
    if (m?.[1]) out.add(String(m[1]).trim());
  }

  // Latin-name patterns typical for brands/cocktails.
  const patterns = [
    /\b[A-Z][A-Za-z0-9'’.-]{1,}\s+[A-Za-z0-9'’.-]{2,}(?:\s+[A-Za-z0-9'’.-]{2,}){0,2}\b/g,
    /\b[A-Za-z]+['’][A-Za-z]+(?:\s+[A-Za-z0-9'’.-]+){0,2}\b/g,
    /\b[A-Za-z]+[-/][A-Za-z0-9]+(?:\s+[A-Za-z0-9'’.-]+){0,2}\b/g,
    /\b[A-Z]{2,}(?:\s+[A-Z]{2,}){0,2}\b/g,
    /\b[A-Za-z]-\d{1,3}\b/g,
  ];

  for (const re of patterns) {
    for (const m of src.matchAll(re)) {
      const v = String(m?.[0] || '').trim();
      if (!v) continue;
      if (!/[A-Za-z]/.test(v)) continue;
      if (/^(here|there|please|target|source|text|ingredients|allergens|want|add|order)$/i.test(v)) continue;
      if (v.length < 2 || v.length > 80) continue;
      out.add(v);
    }
  }

  return Array.from(out);
}

function protectTerms(text, terms = []) {
  let out = String(text || '');
  const slots = [];
  const uniqTerms = Array.from(
    new Set((Array.isArray(terms) ? terms : []).map((x) => String(x || '').trim()).filter(Boolean))
  ).sort((a, b) => b.length - a.length);

  for (const term of uniqTerms) {
    const key = `__ENTITY_${slots.length}__`;
    const re = new RegExp(`\\b${escapeRegExp(term)}\\b`, 'g');
    if (!re.test(out)) continue;
    out = out.replace(re, key);
    slots.push({ key, value: term });
  }

  return { text: out, slots };
}

function restoreTerms(text, slots = []) {
  let out = String(text || '');
  for (const slot of slots) {
    out = out.replaceAll(slot.key, slot.value);
  }
  return out;
}

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
    'You translate restaurant user queries into concise English for menu search. Preserve food entities and proper product/brand/cocktail names (do not literally translate them). Normalize transliterated dish words to canonical culinary terms when obvious (for example: rolls, sushi, sashimi, gunkan, temaki, soup, tuna, salmon, crab, shrimp). Return ONLY the translated query text.';

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

  const autoProtected = collectLikelyBrandTerms(original);
  const protectedPayload = protectTerms(original, autoProtected);

  const systemPrompt =
    'You are a translation engine. Translate from English into the requested target language. Keep placeholders like __ENTITY_0__ unchanged. Do not literally translate product/brand/cocktail proper names. Return ONLY the translated text without explanations.';

  const userPayload = `Target language: ${targetLang}\nText:\n${protectedPayload.text}`;

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
    return restoreTerms(translated, protectedPayload.slots);
  } catch (err) {
    console.error('[translationService] translateFromEnglish error', err);
    return original;
  }
}

/**
 * Generic translation from any source language into target language.
 * Uses deterministic settings and keeps dish/entity names natural.
 *
 * @param {string} text
 * @param {string} targetLang
 * @param {string|null} sourceLang
 * @returns {Promise<string>}
 */
export async function translateText(text, targetLang, sourceLang = null) {
  const original = String(text ?? '');
  const trimmed = original.trim();

  if (!trimmed) return '';
  const target = String(targetLang || '').trim().toLowerCase();
  if (!target) return original;

  if (!hasOpenAI) {
    return original;
  }

  const autoProtected = collectLikelyBrandTerms(original);
  const protectedPayload = protectTerms(original, autoProtected);

  const systemPrompt =
    'You are a translation engine for restaurant UI text. Translate naturally into the target language. Keep placeholders like __ENTITY_0__ unchanged. Do not literally translate product/brand/cocktail proper names. Keep dish names and culinary terms semantically correct (not transliterated when a standard translation exists). Return ONLY translated text.';

  const userPayload = sourceLang
    ? `Source language: ${sourceLang}\nTarget language: ${target}\nText:\n${protectedPayload.text}`
    : `Target language: ${target}\nText:\n${protectedPayload.text}`;

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
    return restoreTerms(translated, protectedPayload.slots);
  } catch (err) {
    console.error('[translationService] translateText error', err);
    return original;
  }
}
