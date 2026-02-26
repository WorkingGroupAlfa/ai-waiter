// src/services/nluService.js
import { openai, hasOpenAI } from './openaiClient.js';

function detectEmotion(textRaw) {
  const text = (textRaw || '').toLowerCase();

  if (!text.trim()) return 'neutral';

  // очень грубая эвристика, потом заменим на LLM
  if (text.includes('быстро') || text.includes('скорее') || text.includes('hurry') || text.includes('quick')) {
    return 'in_a_hurry';
  }

  if (text.includes('спасибо') || text.includes('дякую') || text.includes('thank')) {
    return 'grateful';
  }

  if (text.includes('задолб') || text.includes('достало') || text.includes('wtf') || text.includes('fuck')) {
    return 'annoyed';
  }

  return 'neutral';
}


/**
 * Старая rule-based логика NLU.
 * Работает даже без OpenAI.
 */
export function parseUserMessageRuleBased(textRaw) {
  const text = (textRaw || '').trim();

  if (!text) {
    return {
      intent: 'empty',
      entities: {
        dishes: [],
        quantities: [],
        allergies: [],
      },
      language: 'unknown',
      confidence: 0,
    };
  }

  const lower = text.toLowerCase();
  const language = detectLanguage(lower);

  let intent = 'unknown';
  let confidence = 0.4;

  const entities = {
  dishes: [],
  quantities: [],
  allergies: [],
  modifications: [],
  };

  // --- Простейшее определение intent ---

  // Приветствия
  if (
    // Для кириллицы — без \b, просто вхождение подстроки
    /(привіт|привет|здравствуйте|доброго дня|добрый день)/i.test(lower) ||
    // Для английского можно оставить \b
    /\b(hi|hello|hey)\b/i.test(lower)
  ) {
    intent = 'greeting';
    confidence = 0.9;
  }

  // Запрос помощи / что ты умеешь
  if (
    lower.includes('що ти вмієш') ||
    lower.includes('что ты умеешь') ||
    lower.includes('help') ||
    lower.includes('помоги') ||
    lower.includes('як користуватись') ||
    lower.includes('как пользоваться')
  ) {
    intent = 'help';
    confidence = Math.max(confidence, 0.8);
  }

  // Аллергии
  if (
    lower.includes('алергі') ||
    lower.includes('аллерг') ||
    lower.includes('allerg')
  ) {
    intent = 'allergy_info';
    confidence = Math.max(confidence, 0.9);

    if (lower.includes('орех') || lower.includes('nut')) {
      entities.allergies.push('nuts');
    }
    if (
      lower.includes('молок') ||
      lower.includes('milk') ||
      lower.includes('лактоз')
    ) {
      entities.allergies.push('milk/lactose');
    }
    if (lower.includes('глютен') || lower.includes('gluten')) {
      entities.allergies.push('gluten');
    }
        if (
      lower.includes('seafood') ||
      lower.includes('морепродукт') ||
      lower.includes('кревет')
    ) {
      entities.allergies.push('seafood');
    }

  }

  // Заказ / добавление в заказ – ключевые слова
  const orderKeywords = [
    'хочу',
    'закажи',
    'замов',
    'замовити',
    'принеси',
    'принеси-но',
    'возьми',
    'можно',
    'можно мне',
    'can i get',
    'i want',
    'i would like',
    'i’ll have',
    "i'll have",
    'order',
    'get me',
  ];

  const hasOrderKeyword = orderKeywords.some((kw) => lower.includes(kw));

  // --- Нормализация блюд (пока очень простая) ---

  const menuPatterns = [
    {
      code: 'LEMONADE',
      names: [
        'лимонад',
    'lemonade',
      ],
    },
    {
      code: 'SHRIMP_POPCORN',
      names: [
        'попкорн з креветок',
    'попкорн с креветками',
    'попкорн з креветками',
    'попкорн из креветок',      // 👈 ДОБАВИТЬ ЭТО
    'креветочный попкорн',
    'shrimp popcorn',
    'shrimp pop corn',
    'shrimp-popcorn',
      ],
    },
  ];

  for (const item of menuPatterns) {
    for (const name of item.names) {
      if (lower.includes(name)) {
        entities.dishes.push({
          code: item.code,
          name: name,
        });
        break;
      }
    }
  }

  // Если текст похож на заказ (есть ключевые слова или блюда), помечаем как order
  if (hasOrderKeyword || entities.dishes.length > 0) {
    intent = entities.dishes.length > 0 ? 'order' : 'add_to_order';
    confidence = Math.max(confidence, 0.9);
  }

  // --- Количества (очень базово) ---

  const qtyRegex = /\b(\d+)\s*(шт|штук|pieces|pcs|x)?\b/gi;
  let m;
  while ((m = qtyRegex.exec(lower)) !== null) {
    const n = parseInt(m[1], 10);
    if (!Number.isNaN(n)) {
      entities.quantities.push(n);
    }
  }

  // слова-количества
  const wordQtyMap = {
    один: 1,
    одна: 1,
    одно: 1,
    'one ': 1,
    два: 2,
    дві: 2,
    две: 2,
    'two ': 2,
    три: 3,
    'three ': 3,
  };

  for (const [key, val] of Object.entries(wordQtyMap)) {
    if (lower.includes(key)) {
      entities.quantities.push(val);
    }
  }

    // --- Изменение существующего замовлення: "remove lemonade", "забери попкорн" ---

  const modifyKeywords = [
    'remove ',
    'delete ',
    'without ',
    'no ',
    'убери',
    'забери',
    'видали',
    'прибери',
    'прибрати',
    'без ',
  ];

  const hasModifyKeyword = modifyKeywords.some((kw) => lower.includes(kw));

  if (hasModifyKeyword && entities.dishes.length > 0) {
    intent = 'modify_order';
    confidence = Math.max(confidence, 0.9);

    entities.modifications = entities.dishes.map((d) => ({
      operation: 'remove',
      code: d.code || null,
      name: d.name || null,
    }));
  }


    // --- Ответ на апселл (без явных блюд/количеств) ---

  const hasDishesOrQty =
    (entities.dishes && entities.dishes.length > 0) ||
    (entities.quantities && entities.quantities.length > 0);

  if (!hasDishesOrQty) {
    const confirmKeywords = [
      'так',
      'да',
      'ага',
      'ок',
      'окей',
      'good',
      'sounds good',
      'yes',
      'sure',
      'please do',
      'add it',
      'додавай',
      'додай',
      'добавь',
    ];

    const rejectKeywords = [
      'ні',
      'не',
      'no',
      'nope',
      'not now',
      'maybe later',
      'не треба',
      'не нужно',
      'поки що ні',
    ];

    if (confirmKeywords.some((kw) => lower.includes(kw))) {
      intent = 'confirm_upsell';
      confidence = Math.max(confidence, 0.85);
    } else if (rejectKeywords.some((kw) => lower.includes(kw))) {
      intent = 'reject_upsell';
      confidence = Math.max(confidence, 0.85);
    }
  }


  // Если ничего не распознали решительно — intent остаётся unknown
  if (intent === 'unknown') {
    confidence = 0.4;
  }

  return {
  intent,
  entities,
  language,
  emotion: detectEmotion(textRaw),
  confidence,
  };
}

/**
 * НОВАЯ версия NLU:
 *  1) делаем rule-based разбор
 *  2) если есть OPENAI_API_KEY → просим модель улучшить результат
 *  3) аккуратно мержим, чтобы не сломать блюда/коды
 */
export async function parseUserMessage(textRaw) {
  const base = parseUserMessageRuleBased(textRaw);

  if (!hasOpenAI) {
    return base;
  }

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You are an NLU engine for a restaurant AI waiter. ' +
            'You MUST respond with a single valid JSON object only. ' +
            'JSON shape: { "intent": string, "entities": { "dishes": [{ "code": string | null, "name": string }], "quantities": number[], "allergies": string[] }, "language": "ru" | "en" | "uk" | "mixed" | "unknown", "confidence": number }. ' +
            'For dishes, if you know the internal code, use it (e.g. "LEMONADE", "SHRIMP_POPCORN"), otherwise use null. ' +
            'Do not include any extra fields, comments or text outside JSON.',
        },
        {
          role: 'user',
          content:
            'User message: ' +
            JSON.stringify(textRaw) +
            '\n' +
            'Baseline rule-based parse: ' +
            JSON.stringify(base),
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      console.warn('[NLU] OpenAI returned empty content, fallback to rule-based.');
      return base;
    }

    let llm;
    try {
      llm = JSON.parse(content);
    } catch (e) {
      console.error('[NLU] Failed to parse OpenAI JSON, fallback to rule-based.', e, content);
      return base;
    }

    // Мержим entities аккуратно, чтобы не потерять блюда/коды
    const baseEntities = base.entities || {
        dishes: [],
  quantities: [],
  allergies: [],
  modifications: [],
    };
    const llmEntities = llm.entities || {};

    const mergedDishes =
      Array.isArray(llmEntities.dishes) && llmEntities.dishes.length > 0
        ? llmEntities.dishes
        : baseEntities.dishes;

    const mergedQuantities =
      Array.isArray(llmEntities.quantities) && llmEntities.quantities.length > 0
        ? llmEntities.quantities
        : baseEntities.quantities;

    const mergedAllergies = Array.from(
      new Set([
        ...(baseEntities.allergies || []),
        ...((Array.isArray(llmEntities.allergies) && llmEntities.allergies) || []),
      ])
    );

        const mergedModifications =
      Array.isArray(llmEntities.modifications) && llmEntities.modifications.length > 0
        ? llmEntities.modifications
        : baseEntities.modifications || [];


        const intent = llm.intent || base.intent;
    const language = llm.language || base.language;
    const confidence =
      typeof llm.confidence === 'number' ? llm.confidence : base.confidence;

    const emotion = llm.emotion || base.emotion || detectEmotion(textRaw);


    return {
      intent,
      entities: {
        dishes: mergedDishes,
        quantities: mergedQuantities,
        allergies: mergedAllergies,
        modifications: mergedModifications,
      },
      language,
      emotion,
      confidence,
    };
  } catch (err) {
    console.error('[NLU] OpenAI error, fallback to rule-based.', err);
    return base;
  }
}

function detectLanguage(lower) {
  const hasCyrillic = /[а-яёіїєґ]/i.test(lower);
  const hasLatin = /[a-z]/i.test(lower);

  if (hasCyrillic && !hasLatin) return 'ru';
  if (hasLatin && !hasCyrillic) return 'en';
  if (hasCyrillic && hasLatin) return 'mixed';
  return 'unknown';
}
