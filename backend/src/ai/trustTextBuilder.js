// src/ai/trustTextBuilder.js
// EN-only: create upsell text from reason_code + context.

function safeStr(v) {
  return (v ?? '').toString().trim();
}


function hash32(str) {
  // FNV-1a 32-bit hash (deterministic, no deps)
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function pickDeterministic(templates, seedStr) {
  if (!Array.isArray(templates) || templates.length === 0) return null;
  const idx = hash32(seedStr) % templates.length;
  return templates[idx];
}

function getLocalDayKey(time_ctx) {
  const iso = safeStr(time_ctx?.local_iso);
  // expected "YYYY-MM-DDTHH:MM:SS"
  if (iso && iso.length >= 10) return iso.slice(0, 10);
  // fallback: UTC date
  return new Date().toISOString().slice(0, 10);
}

function daypartFromHour(hour) {
  if (!Number.isFinite(hour)) return null;
  if (hour < 11) return 'morning';
  if (hour < 16) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

function buildTimeHint(time_ctx = null) {
  const dp = safeStr(time_ctx?.daypart).toLowerCase();
  switch (dp) {
    case 'morning':
      return ' this morning';
    case 'afternoon':
      return ' this afternoon';
    case 'evening':
      return ' this evening';
    case 'night':
      return ' tonight';
    default:
      return '';
  }
}

// open-meteo weather_code groups (rough, no hallucinations)
function buildWeatherHint(weather = null) {
  const code = Number(weather?.weather_code);
  const temp = Number(weather?.temperature_c);

  // Temperature-driven hints
  if (Number.isFinite(temp)) {
    if (temp >= 28) return ' (something refreshing for a warm day)';
    if (temp <= 8) return ' (something warm for a chilly day)';
  }

  // Code-driven hints (only if code is present)
  if (!Number.isFinite(code)) return '';

  // Clear / mainly clear / partly cloudy
  if ([0, 1, 2].includes(code)) return ' (nice day for it)';

  // Rain / drizzle / showers / freezing rain
  if (
    (code >= 51 && code <= 67) || // drizzle/rain
    (code >= 80 && code <= 82)    // rain showers
  ) {
    return ' (cozy choice on a rainy day)';
  }

  // Snow / snow grains / snow showers
  if (
    (code >= 71 && code <= 77) || // snow
    (code >= 85 && code <= 86)    // snow showers
  ) {
    return ' (cozy choice on a snowy day)';
  }

  return '';
}


// Returns { timezone, hour, daypart, local_iso } or null if timezone invalid.
export function buildTimeContext({ timezone } = {}) {
  const tz = safeStr(timezone);
  if (!tz) return null;

  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour12: false,
    }).formatToParts(now);

    const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    const hour = Number(map.hour);
    const local_iso = `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}`;

    return {
      timezone: tz,
      hour: Number.isFinite(hour) ? hour : null,
      daypart: Number.isFinite(hour) ? daypartFromHour(hour) : null,
      local_iso,
    };
  } catch {
    return null;
  }
}

function applyPersona(text, persona = null, emotion = 'neutral') {
  const p = persona || {};
  const humor = Math.max(0, Math.min(1, Number(p.humor_level ?? 0)));
  const baseTone = safeStr(p.tone) || 'neutral';

  const emo = safeStr(emotion).toLowerCase();

  const isNegative = ['angry', 'upset', 'frustrated', 'sad'].includes(emo);
  const isRushed = ['in_a_hurry', 'rushed', 'hurry', 'urgent'].includes(emo);

  // Emotion is the main moderator — persona is secondary.
  const tone = isNegative ? 'calm' : baseTone;

  let out = safeStr(text);

  // 1) Humor/emoji handling
  if (!isNegative && !isRushed && humor >= 0.6) {
    out += ' 🙂';
  }

  // 2) Tone transforms (persona)
  if (tone === 'formal') {
    // Keep it simple; just ensure polite phrasing.
    out = out.replace(/\bCan I\b/g, 'May I').replace(/\bcan I\b/g, 'may I');
  } else if (tone === 'friendly') {
    // Friendly tone, but avoid "Fancy ..." when emotion requires calm.
    out = out.replace(/^Would you like to add /, 'Fancy adding ');
  }

  // 3) Emotion overrides (hard rules)
  if (isNegative) {
    // Force calm: no emoji, no slang, no exclamation marks.
    out = out.replace(/🙂/g, '');
    out = out.replace(/\!+/g, '.');
    out = out.replace(/^Fancy /, 'Would you like to ');
  }

  if (isRushed) {
    // Keep it short: remove emoji, remove long lead-ins, keep first sentence.
    out = out.replace(/🙂/g, '');
    out = out.replace(/\!+/g, '');
    const firstSentence = out.split(/(?<=[.!?])\s+/)[0];
    out = firstSentence || out;
    if (out.length > 140) out = out.slice(0, 137).trimEnd() + '...';
  }

  return out.trim();
}


/**
 * Build EN-only upsell text.
 *
 * @param {object} args
 * @param {string} args.reason_code
 * @param {string} args.base_item_name
 * @param {string} args.upsell_item_name
 * @param {object|null} args.time_ctx
 * @param {object|null} args.weather
 * @param {object|null} args.persona
 * @param {string} args.emotion
 */

// STEP 4: Safe NLG main builder
// EN-only draft. The caller translates via existing translation/NLG layer.
export function build({ intent, slots = {}, persona = null, emotion = 'neutral', language = 'en' } = {}) {
  void language; // EN-only output; language is kept for interface symmetry

  const i = safeStr(intent).toLowerCase() || 'pairing_suggestion';

  const baseName =
    safeStr(slots?.base_item_name) ||
    safeStr(slots?.base_item_code) ||
    'your order';

  const upsellName =
    safeStr(slots?.upsell_item_name) ||
    safeStr(slots?.upsell_item_code) ||
    'this';

  const timeCtx = slots?.time_ctx || slots?.time_context || null;

  const timeHint = buildTimeHint(timeCtx);
  const weatherHint = buildWeatherHint(slots?.weather || null);

  // Deterministic variation: stable within a (local) day for same base+upsell+intent,
  // but changes across different items and across days.
  const dayKey = getLocalDayKey(timeCtx);
  const seed = `${i}::${baseName}::${upsellName}::${dayKey}`;

  const TEMPLATES = {
    popular_pairing: [
      () => `Would you like to add ${upsellName} with your ${baseName}${timeHint}? It’s a popular pairing${weatherHint}.`,
      () => `Would you like to add ${upsellName}${timeHint}? It pairs really well with your ${baseName}${weatherHint}.`,
      () => `Would you like to add ${upsellName} alongside your ${baseName}${timeHint}? A classic combo${weatherHint}.`,
      () => `Would you like to add ${upsellName}${timeHint}? It complements your ${baseName} nicely${weatherHint}.`,
      () => `Would you like to add ${upsellName} with your ${baseName}${timeHint}? A well-loved match${weatherHint}.`,
    ],
    category_pairing: [
      () => `Would you like to add ${upsellName}${timeHint}? It pairs nicely with your selection${weatherHint}.`,
      () => `Would you like to add ${upsellName}${timeHint}? It’s a great fit for what you’ve picked${weatherHint}.`,
      () => `Would you like to add ${upsellName}${timeHint}? This tends to complement your choice well${weatherHint}.`,
      () => `Would you like to add ${upsellName}${timeHint}? Nice balance with your current order${weatherHint}.`,
    ],
    usual_pick: [
      () => `Would you like to add your usual ${upsellName}${timeHint}?${weatherHint}`,
      () => `Would you like to go with your usual ${upsellName}${timeHint}?${weatherHint}`,
      () => `Would you like to add ${upsellName}${timeHint} — your usual?${weatherHint}`,
    ],
    pairing_suggestion: [
      () => `Would you like to add ${upsellName} with your ${baseName}${timeHint}? It goes great together${weatherHint}.`,
      () => `Would you like to add ${upsellName}${timeHint}? It’s a great match for your ${baseName}${weatherHint}.`,
      () => `Would you like to add ${upsellName} alongside your ${baseName}${timeHint}? A tasty pairing${weatherHint}.`,
      () => `Would you like to add ${upsellName}${timeHint}? It complements your ${baseName} nicely${weatherHint}.`,
      () => `Would you like to add ${upsellName} with your ${baseName}${timeHint}? A solid combo${weatherHint}.`,
    ],
  };

  const list = TEMPLATES[i] || TEMPLATES.pairing_suggestion;
const tmpl = pickDeterministic(list, seed) || list[0];
const text = tmpl();

return applyPersona(text, persona, emotion);


}


/**
 * Backward compatible wrapper (old API).
 * Converts reason_code/context -> { intent, slots } and delegates to build().
 * IMPORTANT: reason_code is NOT used directly in user-facing wording.
 */
export function buildUpsellTextEn({
  reason_code,
  base_item_name,
  upsell_item_name,
  time_ctx = null,
  weather = null,
  persona = null,
  emotion = 'neutral',
  language = 'en',
} = {}) {
  const reason = safeStr(reason_code).toLowerCase();

  // Map legacy reason_code -> intent (best-effort)
  let intent = 'pairing_suggestion';
  if (reason === 'favorite_item_for_device') intent = 'usual_pick';
  else if (reason === 'upsell_service') intent = 'pairing_suggestion';
  else if (reason === 'cooccur') intent = 'popular_pairing';
  else if (reason === 'ingredient_based_pairing' || reason === 'pairing_with_item') intent = 'pairing_suggestion';

  const slots = {
    base_item_name: safeStr(base_item_name) || null,
    upsell_item_name: safeStr(upsell_item_name) || null,
    time_ctx,
    weather,
  };

  return build({ intent, slots, persona, emotion, language });
}

