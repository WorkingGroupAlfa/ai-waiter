// src/ai/nluService.js
// Высокоуровневый NLU-слой для AI WAITER.
// 1) legacy NLU: parseUserMessage (как раньше, из services/nluService.js)
// 2) новый NLU: parseUserInput({ text, locale, sessionContext })

import { openai, hasOpenAI } from '../services/openaiClient.js';
import { parseUserMessage as legacyParseUserMessage } from '../services/nluService.js';
import { matchDishMentionToMenu } from './semanticMatcher.js';
import { detectQueryLanguage } from './queryUnderstanding.js';
import { query } from '../db.js';

const NLU_MODEL = process.env.OPENAI_NLU_MODEL || 'gpt-4o-mini';
const MATCH_CONFIDENCE_THRESHOLD = Number(
  process.env.NLU_MATCH_THRESHOLD || 0.75
);

function normalizeIntent(rawIntent) {
  const i = (rawIntent || '').toString().trim().toLowerCase();

  // Canonical contract for dialogManager
  // Keep ask_menu as its own intent.
  switch (i) {
    case 'modify':
      return 'modify_order';
    case 'add':
    case 'add_item':
    case 'add_to_order':
      return 'add_to_order';
    case 'order':
      return 'order';
    case 'cancel':
    case 'cancel_order':
      return 'cancel_order';
    case 'confirm':
      return 'confirm';
    case 'confirm_upsell':
      return 'confirm_upsell';
    case 'reject_upsell':
      return 'reject_upsell';
    case 'ask_menu':
      return 'ask_menu';
    case 'smalltalk':
      return 'smalltalk';
    case 'greeting':
      return 'greeting';
    case 'farewell':
      return 'farewell';
    case 'help':
      return 'help';
    case 'info':
      return 'info';
    case 'unknown':
      return 'unknown';
    default:
      return i || 'unknown';
  }
}


// System prompt для нового NLU (строгий JSON).
// System prompt для нового NLU (строгий JSON).
const NLU_SYSTEM_PROMPT = `
You are an NLU engine for a restaurant AI waiter.

INPUT:
You will receive a single JSON object from the user with this shape:
{
  "text": string,                // raw user message
  "localeHint": string | null,   // optional UI locale (e.g. "ru", "en", "uk", "es", ...), may be null
  "autoLanguage": string,        // simple heuristic detector result: "ru" | "en" | "mixed" | "unknown"
  "sessionContext": object | null
}

The user can speak in ANY language (Russian, Ukrainian, English, Spanish, Polish, Chinese, Korean, etc.)
They can also mix languages in one sentence (code-switching).

Your task:
- Understand what the user wants (intent).
- Extract mentioned dishes/drinks (items).
- Detect the language of the message and return it in meta.language.
- Provide basic emotion + whether clarification is needed.

You MUST output STRICTLY valid JSON with this schema (no comments, no extra fields):

{
  "intent": "order" | "modify" | "ask_menu" | "confirm" | "cancel_order" | "smalltalk" | "greeting" | "farewell" | "unknown",
  "items": [
    {
      "rawText": string,
      "quantity": number,
      "modifiers": string[],
      "allergensRisk": string[]
    }
  ],
  "meta": {
    "language": string,
    "emotion": "neutral" | "in_a_hurry" | "grateful" | "angry" | "confused",
    "clarificationNeeded": boolean
  }
}

----------------
INTENT RULES
----------------

Use "intent" according to the overall meaning of the message:

- "order" — user is ordering something new
  Examples: "хочу...", "можно...", "I want...", "get me...", "Quiero...", "Poproszę..."

- "modify" — user changes an existing order
  Examples: "без лука", "замени лимонад на воду", "ещё одну такую же", "make it without cheese"

- "ask_menu" — asks about the menu or recommendations
  Examples: "что у вас есть", "show me the menu", "What do you recommend?", "Co polecasz?"

- "confirm" — confirms a previous suggestion or summary
  Examples: "да, беру", "perfect, let's do this", "tak, proszę", "sounds good, go ahead"

- "cancel_order" — cancels or partially cancels an order
  Examples: "отмени последний ролл", "cancel my drink", "zmień zamówienie, usuń deser"

- "greeting" — obvious greetings:
  Examples: "привет", "здравствуйте", "hello", "hi", "dobry wieczór"

- "farewell" — goodbyes:
  Examples: "пока", "спасибо, до свидания", "bye", "good night"

- "smalltalk" — chit-chat, jokes, non-order talk:
  Examples: "как дела?", "you are a cool bot", "ты настоящий?"

- "unknown" — if nothing fits or the message is unrelated to the restaurant context.

If the message contains both a greeting and a clear order, prefer "order".

----------------
ITEMS RULES
----------------

"items" is an array of separate dishes/drinks the user refers to.

For each item:
- "rawText":
  - The full phrase describing that dish/drink in the ORIGINAL language.
  - Examples: "spicy shrimp popcorn", "large Coke", "крабовый ролл", "ramen z krewetkami".

- "quantity":
  - If the user clearly specifies a number, use it.
    Examples: "две колы" -> 2, "three miso soups" -> 3.
  - For phrases like "ещё одну", "same again", "one more", treat as quantity = 1.
  - If quantity is not specified, default to 1.

- "modifiers":
  - Text flags that change the dish/drink:
    - size: "small", "medium", "large"
    - spiciness: "spicy", "extra spicy", "not spicy"
    - temperature: "hot", "cold", "iced"
    - sugar/ice level: "no sugar", "less sugar", "no ice", "light ice"
    - dietary: "vegan", "vegetarian", "gluten free", "lactose free"
    - style: "without onion", "no mayo", "extra cheese", "без соуса"
  - Use short English phrases where possible, even if the original message is not in English.
  - If the user says "same again", you can add a note like "same_as_previous" into modifiers.

- "allergensRisk":
  - List potential allergens if clearly implied by the dish or modifiers:
    - Examples: "shrimp", "seafood", "fish", "nuts", "peanuts", "gluten", "milk", "egg".
  - If no obvious allergens, return an empty array [].

If there are no dishes/drinks in the message, return an empty array "items": [].

----------------
META.LANGUAGE RULES
----------------

"meta.language" must describe the language of the user's message:

- If the message is clearly in a single language:
  - Return the lowercase ISO 639-1 code of that language.
  - Examples:
    - "en" for English
    - "ru" for Russian
    - "uk" for Ukrainian
    - "es" for Spanish
    - "pl" for Polish
    - "fr" for French
    - "de" for German
    - "it" for Italian
    - "pt" for Portuguese
    - "zh" for Chinese
    - "ja" for Japanese
    - "ko" for Korean
  - For any other language, also use its appropriate 2-letter ISO 639-1 code.

- If the message clearly mixes two or more languages (code-switching, e.g. Cyrillic + Latin or several languages in one phrase):
  - Return "mixed".

- If you cannot confidently determine the language:
  - Return "unknown".

IMPORTANT:
- DO NOT return human-readable names like "English", "Russian", "Polish".
- DO NOT return locale formats like "en-US", "pt-BR", "zh-CN".
- Use only 2-letter codes, "mixed" or "unknown".

You can use "localeHint" and "autoLanguage" as hints, but if they contradict the real text, ALWAYS trust the actual text.

----------------
META.EMOTION AND CLARIFICATION RULES
----------------

"meta.emotion":
- "neutral" — default if nothing special.
- "in_a_hurry" — user is rushing / impatient:
  Examples: "быстрее", "скорее", "hurry up", "as soon as possible".
- "grateful" — user is thanking:
  Examples: "спасибо", "thank you so much".
- "angry" — user is clearly upset or complaining.
- "confused" — user does not understand something or is asking for clarification.

"meta.clarificationNeeded":
- true — if:
  - the user is vague or ambiguous;
  - key details are missing (e.g. "I want a cola" but sizes are mandatory in this restaurant);
  - you are not confident which dish they mean.
- false — if:
  - the order is clear enough and can be processed without extra questions.

----------------
GENERAL REQUIREMENTS
----------------

- Output MUST be valid JSON, parseable by a strict JSON parser.
- NO comments, NO trailing commas, NO additional top-level fields.
- Use only the fields described above.
`;



// Определяем язык по набору символов (Cyrillic / Latin / смешанный).
function detectLanguageByText(textRaw) {
  return detectQueryLanguage(textRaw, null);
}

/**
 * Новый NLU: parseUserInput
 * @param {object} params
 * @param {string} params.text
 * @param {string} [params.locale] - hint: 'ru' | 'uk' | 'en' | 'mixed'
 * @param {object} [params.sessionContext] - сюда кладём restaurantId и др. контекст
 */
export async function parseUserInput({ text, locale = null, sessionContext = null } = {}) {
  
  let llmPayload = null;
  const llmIntent = (llmPayload?.intent || '').toString().trim().toLowerCase();
  const llmHasItems = Array.isArray(llmPayload?.items) && llmPayload.items.length > 0;

  const rawText = (text || '').trim();

  const baseResult = {
  intent: 'unknown',
  items: [],

  emotion: 'neutral',
  language: (locale || 'unknown'),
  clarificationNeeded: true,

  meta: {
    emotion: 'neutral',
    language: locale || 'unknown',
    clarificationNeeded: true,
  },
};

  if (!rawText) {
    return baseResult;
  }

  const autoLang = detectLanguageByText(rawText);

  // Базовый язык: хинт от фронта или простой детектор.
  // Дальше он может быть переопределён meta.language из LLM.
  let language = (autoLang || locale || 'unknown').toLowerCase();
  const restaurantId =
    sessionContext?.restaurantId || sessionContext?.restaurant_id || null;

  let intent = 'unknown';
  let items = [];
  let emotion = 'neutral';
  let clarificationNeeded = false;

  // --- 1. Пытаемся разобрать через LLM (новый промпт) ---
  

  if (hasOpenAI) {
    try {
      const completion = await openai.chat.completions.create({
        model: NLU_MODEL,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: NLU_SYSTEM_PROMPT,
          },
          {
            role: 'user',
            content: JSON.stringify({
              text: rawText,
              localeHint: locale || null,
              autoLanguage: autoLang,
              sessionContext: sessionContext || null,
            }),
          },
        ],
      });

      const content = completion.choices?.[0]?.message?.content || '{}';
      llmPayload = JSON.parse(content);
    } catch (err) {
      console.error('[NLU] parseUserInput LLM error, fallback to legacy NLU.', err);
    }
  }

  if (
    !llmPayload ||
    typeof llmPayload !== 'object' ||
    !llmPayload.intent ||
    // IMPORTANT: если LLM вернул "unknown" и не дал items — уходим в legacy 
    (llmIntent === 'unknown' && !llmHasItems)
  ) {
    // --- 2. Фолбек в legacy parseUserMessage ---
    const legacy = await legacyParseUserMessage(rawText);

    intent = legacy?.intent || 'unknown';
    emotion = legacy?.emotion || 'neutral';

    const legacyDishes = (legacy?.entities && legacy.entities.dishes) || [];
    const legacyAllergies =
      (legacy?.entities && legacy.entities.allergies) || [];

    items = legacyDishes.map((dish) => ({
      rawText: dish.name || dish.code || rawText,
      quantity: Number(dish.quantity || 1),
      modifiers: dish.modifications || [],
      allergensRisk: legacyAllergies,
    }));
  } else {
    // --- 3. Используем структуру из нового LLM ---
    intent = llmPayload.intent || 'unknown';
    const meta = llmPayload.meta || {};

    emotion = meta.emotion || llmPayload.emotion || 'neutral';
    clarificationNeeded = Boolean(meta.clarificationNeeded);

    // Пробуем взять язык из meta.language, если он валиден.
    if (typeof meta.language === 'string' && meta.language.trim()) {
      const candidate = meta.language.trim().toLowerCase();

      // Разрешены:
      //  - любые 2-буквенные ISO-коды (en, ru, uk, es, pl, zh, ko, ...)
      //  - специальные значения "mixed" и "unknown"
      if (
        /^[a-z]{2}$/.test(candidate) ||
        candidate === 'mixed'
      ) {
        language = candidate;
      } else if (candidate === 'unknown') {
        // оставляем unknown только если у нас и так нет лучшего хинта
        if (!language || language === 'unknown') {
         language = 'unknown';
        }
      }

      // Если candidate не валиден (например "English" или "en-US"),
      // просто игнорируем и оставляем language как было (locale/autoLang/fallback).
    }

    if (Array.isArray(llmPayload.items)) {
      items = llmPayload.items.map((it) => ({
        rawText: it.rawText || rawText,
        quantity: Number(it.quantity || 1),
        modifiers: Array.isArray(it.modifiers) ? it.modifiers : [],
        allergensRisk: Array.isArray(it.allergensRisk)
          ? it.allergensRisk
          : [],
      }));
    }
  }

// --- 3. Normalize intent to dialogManager canonical taxonomy ---
intent = normalizeIntent(intent);

  // --- 4. Семантический матчинг с меню (Menu Knowledge Engine) ---
  const resolvedItems = [];
  let anyLowConfidence = false;

  for (const item of items) {
    let match = {
      menu_item_id: null,
      confidence: 0,
      source: 'not_matched',
    };

    if (restaurantId) {
      try {
        match = await matchDishMentionToMenu({
          mentionText: item.rawText,
          locale: language,
          restaurantId,
        });
      } catch (err) {
        console.error('[NLU] semanticMatcher error', err);
      }
    }

    const confidence =
      typeof match.confidence === 'number' ? match.confidence : 0;

    if (confidence < MATCH_CONFIDENCE_THRESHOLD) {
      anyLowConfidence = true;
    }

    // --- Подтягиваем реальные аллергены из menu_items ---
    let mergedAllergens = Array.isArray(item.allergensRisk)
      ? [...item.allergensRisk]
      : [];

    if (match.menu_item_id && restaurantId) {
      try {
        const allergenRes = await query(
          `
            SELECT allergens
            FROM menu_items
            WHERE id = $1 AND restaurant_id = $2
          `,
          [match.menu_item_id, restaurantId]
        );

        const dbAllergens = allergenRes.rows?.[0]?.allergens || [];
        if (Array.isArray(dbAllergens) && dbAllergens.length > 0) {
          mergedAllergens = Array.from(
            new Set([...mergedAllergens, ...dbAllergens])
          );
        }
      } catch (err) {
        console.error(
          '[NLU] failed to load allergens for menu_item_id',
          match.menu_item_id,
          err
        );
      }
    }

    resolvedItems.push({
      ...item,
      allergensRisk: mergedAllergens,
      menu_item_id: match.menu_item_id || null,
      matchConfidence: confidence,
      matchSource: match.source || 'unknown',
    });
  }


  const finalClarificationNeeded =
    clarificationNeeded ||
    (intent === 'order' && resolvedItems.length === 0) ||
    anyLowConfidence;

  return {
  intent,
  items: resolvedItems,

  // ✅ top-level (чтобы dialogManager не терял эмоции/язык)
  emotion,
  language,
  clarificationNeeded: finalClarificationNeeded,

  // ✅ meta оставляем для совместимости
  meta: {
    emotion,
    language,
    clarificationNeeded: finalClarificationNeeded,
  },
};

}

// Legacy экспорт — чтобы всё старое продолжало работать
export { legacyParseUserMessage as parseUserMessage };

