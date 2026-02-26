// src/ai/semanticMatcher.js
// Semantic Menu Matching Engine для AI WAITER.
//
// matchDishMentionToMenu({ mentionText, locale, restaurantId }) →
//   { menu_item_id, confidence, source }
//
// Уровни:
// 1) Эмбеддинги (menu_item_embeddings + текстовый эмбеддинг)
// 2) Synonym Graph (синонимы типа "попкорн з креветками" → SHRIMP_POPCORN)
// 3) Ingredient fallback (по полю ingredients в menu_items)

import { openai, hasOpenAI } from '../services/openaiClient.js';
import { query } from '../db.js';
import {
  getMenuItemsWithDetails,
  getActiveMenuItemsByCodes,
} from '../models/menuModel.js';
import { translateToEnglish } from './translationService.js';

// ------------------------
// Lexical matching helpers (fixes напитки/бренды: "фритц кола" → не лимонад)
// ------------------------
const NAME_STOPWORDS = new Set([
  // RU/UA noise
  'хочу','хотел','хотела','можно','дай','дайте','мне','пожалуйста','плиз','плз',
  'буду','возьму','закажу','заказать','заказ','принеси','принесите','нужно',
  'я','меню','посоветуй','посоветуйте','подскажи','подскажите',
  // EN noise
  'i','want','would','like','please','give','get','me','menu','recommend','suggest',
]);

function normalizeForNameMatch(s) {
  return String(s || '')
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripStopwords(text) {
  const tokens = normalizeForNameMatch(text).split(' ').filter(Boolean);
  const clean = tokens.filter((t) => !NAME_STOPWORDS.has(t));
  return clean.join(' ').trim();
}

function isDrinkishQuery(text) {
  const t = normalizeForNameMatch(text);
  // "кола" / "coca" / "cola" / "фритц" — всё это обычно напиток.
  return (
    t.includes('кол') ||
    t.includes('cola') ||
    t.includes('coca') ||
    t.includes('кока') ||
    t.includes('fritz') ||
    t.includes('фритц') ||
    t.includes('напит') ||
    t.includes('drink')
  );
}

function levenshteinDistance(a, b) {
  const s = String(a || '');
  const t = String(b || '');
  const n = s.length;
  const m = t.length;
  if (n === 0) return m;
  if (m === 0) return n;

  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[n][m];
}

function similarityRatio(a, b) {
  const x = normalizeForNameMatch(a);
  const y = normalizeForNameMatch(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const dist = levenshteinDistance(x, y);
  const maxLen = Math.max(x.length, y.length) || 1;
  return 1 - dist / maxLen;
}

async function matchByName({ mentionText, restaurantId }) {
  const cleaned = stripStopwords(mentionText);
  if (!cleaned || cleaned.length < 2) return null;

  const { rows } = await query(
    `
    SELECT id, item_code, name_ua, name_en, category, tags
    FROM menu_items
    WHERE restaurant_id = $1 AND is_active = TRUE
    `,
    [restaurantId]
  );

  const q = normalizeForNameMatch(cleaned);
  const drinkish = isDrinkishQuery(cleaned);

  // 1) Exact/contains match first (very deterministic)
  for (const r of rows) {
    const n1 = normalizeForNameMatch(r.name_ua);
    const n2 = normalizeForNameMatch(r.name_en);
    const c = normalizeForNameMatch(r.item_code);
    if (!q) continue;
    if (q === n1 || q === n2 || q === c) {
      return { menu_item_id: r.id, confidence: 0.99, source: 'name_exact' };
    }
  }

  // 2) Strong substring: if user says "кола" pick menu item containing "cola/кол".
  // This prevents embeddings from sending "cola" to random sushi.
  let best = null;
  let bestScore = 0;

  for (const r of rows) {
    const candidates = [r.name_ua, r.name_en, r.item_code].filter(Boolean);
    const tagsArr = Array.isArray(r.tags) ? r.tags : [];
    const isDrinkItem =
      String(r.category || '').toLowerCase() === 'drink' ||
      tagsArr.map(String).map(s => s.toLowerCase()).includes('drink') ||
      candidates.some((cnd) => {
        const cn = normalizeForNameMatch(cnd);
        return cn.includes('cola') || cn.includes('кол');
      });

    // If query is drinkish, penalize non-drink items heavily
    if (drinkish && !isDrinkItem) continue;

    for (const cand of candidates) {
      const candNorm = normalizeForNameMatch(cand);
      if (!candNorm) continue;

      let score = 0;
      // Strong intent: cola/кола queries should prefer any menu item that clearly looks like cola.
      if (
        drinkish &&
        (q.includes('кол') || q.includes('cola') || q.includes('coca') || q.includes('кока')) &&
        (candNorm.includes('cola') || candNorm.includes('кол') || candNorm.includes('coca') || candNorm.includes('кока'))
      ) {
        score = 0.96;
      } else if (candNorm.includes(q) || q.includes(candNorm)) {
        score = 0.97;
      } else {
        score = similarityRatio(q, candNorm);
      }

      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }
  }

  if (best && bestScore >= 0.88) {
    return {
      menu_item_id: best.id,
      confidence: Math.min(0.95, bestScore),
      source: drinkish ? 'name_fuzzy_drink' : 'name_fuzzy',
    };
  }

  return null;
}

// --- DB synonyms cache (ai_synonyms) ---
const SYN_CACHE_TTL_MS = Number(process.env.AI_SYNONYMS_TTL_MS || 120000); // 2 min
const _synCache = new Map(); // restaurantId -> { exp, rows }

export function invalidateSynonymsCache(restaurantId) {
  if (restaurantId) _synCache.delete(String(restaurantId));
}

async function loadSynonymsFromDB(restaurantId) {
  const key = String(restaurantId);
  const now = Date.now();
  const cached = _synCache.get(key);
  if (cached && cached.exp > now) return cached.rows;

  const { rows } = await query(
    `
    SELECT phrase, canonical, locale
    FROM ai_synonyms
    WHERE restaurant_id = $1
    ORDER BY created_at DESC
    `,
    [restaurantId]
  );

  const norm = (rows || [])
    .map(r => ({
      phrase: String(r.phrase || '').trim().toLowerCase(),
      canonical: String(r.canonical || '').trim(), // canonical = item_code
      locale: r.locale ? String(r.locale).trim().toLowerCase() : null,
    }))
    .filter(r => r.phrase && r.canonical);

  _synCache.set(key, { exp: now + SYN_CACHE_TTL_MS, rows: norm });
  return norm;
}


const DEFAULT_EMBEDDINGS_MODEL =
  process.env.OPENAI_EMBEDDINGS_MODEL || 'text-embedding-3-small';

const EMBEDDING_MATCH_THRESHOLD = Number(
  process.env.SEMANTIC_MATCH_THRESHOLD || 0.6
);
const SUGGEST_EMBEDDING_THRESHOLD = Number(
  process.env.SEMANTIC_SUGGEST_THRESHOLD || 0.5
);
// Synonym Graph: мапим текстовые синонимы на item_code.
// Для демо — шримп попкорн и крабовый ролл.
// Synonym Graph: мапим текстовые синонимы на item_code.
const SYNONYM_GRAPH = [
  // Лимонад
  {
    itemCode: 'LEMONADE',
    synonyms: [
      'lemonade',
      'лимонад',
      'домашний лимонад',
      'house lemonade',
      'home lemonade',
      'citrus lemonade',
      'лимонний напій',
    ],
  },

  // Тестовый стейк
  {
    itemCode: 'TEST_STEAK',
    synonyms: [
      'steak',
      'test steak',
      'стейк',
      'мясной стейк',
      'juicy steak',
      'стейк для теста',
    ],
  },

  // Крабовые роллы
  {
    itemCode: 'TEST_CRAB',
    synonyms: [
      'краб',
      'crab',
      'крабовые роллы',
      'крабові роли',
      'crab rolls',
      'crab meat rolls',
      "крабове м'ясо",
      'крабовое мясо',
      'crab sushi',
    ],
  },

  // Попкорн из креветок
  {
    itemCode: 'SHRIMP_POPCORN',
    synonyms: [
      'shrimp popcorn',
      'shrimp pop corn',
      'креветочный попкорн',
      'попкорн з креветками',
      'попкорн из креветок',
      'креветочный снэк',
      'креветочный снек',
    ],
  },
];


// Синонимы по ингредиентам (для ingredient fallback).
const INGREDIENT_SYNONYMS = {
  shrimp: ['shrimp', 'prawn', 'креветка', 'креветки', 'креветок'],
  crab: ['crab', 'краб', "крабове м'ясо", 'крабовое мясо'],
  lemon: ['lemon', 'лимон'],
};

function normalizeLocale(locale) {
  if (!locale) return 'en';
  const l = locale.toLowerCase();
  if (l.startsWith('ru')) return 'ru';
  if (l.startsWith('uk') || l.startsWith('ua')) return 'uk';
  if (l.startsWith('en')) return 'en';
  if (l === 'mixed') return 'mixed';
  return 'en';
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0;
  const len = Math.min(a.length, b.length);
  if (!len) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < len; i++) {
    const x = Number(a[i]) || 0;
    const y = Number(b[i]) || 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }

  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Заглушка для текстовых эмбеддингов, если нет OpenAI.
async function getTextEmbedding(text) {
  if (!hasOpenAI) {
    const str = String(text || '');
    const hash = [...str].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    return [hash % 1000, (hash * 7) % 1000, (hash * 13) % 1000];
  }

  const response = await openai.embeddings.create({
    model: DEFAULT_EMBEDDINGS_MODEL,
    input: text,
  });

  return response.data[0].embedding;
}

async function loadMenuEmbeddings(restaurantId, preferredLocale) {
  // Эмбеддинги теперь генерируются только в EN.
  // ru/uk оставляем как fallback для старых записей (если они ещё есть).
  const localesToTry = ['en'];

  const norm = normalizeLocale(preferredLocale);
  ['uk', 'ru'].forEach((l) => {
    if ((norm === l || norm === 'mixed') && !localesToTry.includes(l)) {
      localesToTry.push(l);
    }
  });

  for (const loc of localesToTry) {
    const result = await query(
      `
      SELECT
        mie.menu_item_id,
        mie.locale,
        mie.embedding,
        mi.item_code,
        mi.name_en,
        mi.name_ua,
        mi.category,
        mi.tags
      FROM menu_item_embeddings mie
      JOIN menu_items mi ON mi.id = mie.menu_item_id
      WHERE mi.restaurant_id = $1
        AND mie.locale = $2
      `,
      [restaurantId, loc]
    );

    if (result.rows.length > 0) {
      return { rows: result.rows, usedLocale: loc };
    }
  }

  return { rows: [], usedLocale: null };
}


async function matchByEmbeddings({ text, locale, restaurantId, onlyDrinkItems = false }) {
  const { rows, usedLocale } = await loadMenuEmbeddings(
    restaurantId,
    locale
  );

  if (!rows.length) {
    return null;
  }

  const mentionEmbedding = await getTextEmbedding(text);
  let bestRow = null;
  let bestScore = -1;

  for (const row of rows) {
    if (onlyDrinkItems) {
      const tagsArr = Array.isArray(row.tags) ? row.tags : [];
      const isDrinkItem =
        String(row.category || '').toLowerCase() === 'drink' ||
        tagsArr.map(String).map(s => s.toLowerCase()).includes('drink') ||
        [row.item_code, row.name_en, row.name_ua]
          .filter(Boolean)
          .some((cnd) => {
            const cn = normalizeForNameMatch(cnd);
            return cn.includes('cola') || cn.includes('кол') || cn.includes('coca') || cn.includes('кока');
          });
      if (!isDrinkItem) continue;
    }

    const vec = Array.isArray(row.embedding)
      ? row.embedding
      : row.embedding && Array.isArray(row.embedding.data)
      ? row.embedding.data
      : row.embedding && Array.isArray(row.embedding.values)
      ? row.embedding.values
      : null;

    if (!vec) continue;

    const score = cosineSimilarity(mentionEmbedding, vec);
    if (!Number.isFinite(score)) continue;

    if (score > bestScore) {
      bestScore = score;
      bestRow = row;
    }
  }

  if (!bestRow) return null;

  return {
    menu_item_id: bestRow.menu_item_id,
    confidence: bestScore,
    source: 'embedding',
    usedLocale,
  };
}



async function matchBySynonymGraph({ lowerText, restaurantId, locale }) {
  const rows = await loadSynonymsFromDB(restaurantId);
  if (!rows || rows.length === 0) return null;

  const loc = normalizeLocale(locale);

  // Приоритет: (1) точный locale, (2) locale=null, (3) всё остальное
  const ranked = [
    ...rows.filter(r => r.locale && r.locale === loc),
    ...rows.filter(r => !r.locale),
    ...rows.filter(r => r.locale && r.locale !== loc),
  ];

  for (const row of ranked) {
    if (!lowerText.includes(row.phrase)) continue;

    const items = await getActiveMenuItemsByCodes(restaurantId, [row.canonical]);
    if (!items || items.length === 0) continue;

    return {
      menu_item_id: items[0].id,
      confidence: 0.95,
      source: 'ai_synonyms_db',
    };
  }

  return null;
}


async function matchByIngredients({ lowerText, restaurantId }) {
  const menuItems = await getMenuItemsWithDetails(restaurantId, {
    onlyActive: true,
  });

  let best = null;

  for (const item of menuItems) {
    const ingredients =
      Array.isArray(item.ingredients) && item.ingredients.length > 0
        ? item.ingredients
        : Array.isArray(item.ingredients_json)
        ? item.ingredients_json
        : [];

    let score = 0;

    for (const raw of ingredients) {
      const ingName = String(raw || '').toLowerCase();
      if (!ingName) continue;

      const synonyms = [
        ingName,
        ...(INGREDIENT_SYNONYMS[ingName] || []),
      ];

      const hasMatch = synonyms.some((s) => lowerText.includes(s));
      if (hasMatch) {
        score += 1;
      }
    }

    if (score > 0 && (!best || score > best.score)) {
      best = { item, score };
    }
  }

  if (!best) return null;

  const confidence = Math.min(0.6 + 0.1 * (best.score - 1), 0.8);

  return {
    menu_item_id: best.item.id,
    confidence,
    source: 'ingredient_fallback',
  };
}

export async function matchDishMentionToMenu({ mentionText, locale, restaurantId }) {
  const usedLocale = (locale || 'en').toLowerCase();

  const text = (mentionText || '').trim();

  if (!text || !restaurantId) {
    return {
      menu_item_id: null,
      confidence: 0,
      source: 'invalid_input',
    };
  }

  const lowerText = text.toLowerCase();
  // 1) СНАЧАЛА Synonym Graph (работает по "сырому" тексту на любом языке)
  const synonymMatch = await matchBySynonymGraph({
    lowerText, restaurantId, locale: usedLocale
  });

  if (synonymMatch) {
    return synonymMatch;
  }

  // 1.5) Then lexical name match (exact/contains/fuzzy).
  // This prevents cases like "хочу фритц колу" → лимонад,
  // and "хочу колу" → крабовые роллы.
  const nameMatch = await matchByName({ mentionText: text, restaurantId });
  if (nameMatch) {
    return nameMatch;
  }

  // 2) Потом эмбеддинги — но сначала переводим текст в EN
  let textForEmbeddings = text;
  const sourceLang = locale; // сюда ты уже пробрасываешь meta.language из NLU

  try {
    textForEmbeddings = await translateToEnglish(text, sourceLang);
  } catch (err) {
    console.error('[semanticMatcher] translateToEnglish error', err);
    textForEmbeddings = text;
  }

  // 2) Embeddings. If the query looks like a drink request, restrict candidates to drink items first.
  const drinkish = isDrinkishQuery(text);
  const embMatch = await matchByEmbeddings({
    text: textForEmbeddings,
    // ВАЖНО: эмбеддинги теперь только EN, явно указываем 'en'
    locale: 'en',
    restaurantId,
    onlyDrinkItems: drinkish,
  });

  // If drinkish search didn't find anything, retry full menu (better than returning null)
  let embMatchAny = embMatch;
  if (!embMatchAny && drinkish) {
    embMatchAny = await matchByEmbeddings({
      text: textForEmbeddings,
      locale: 'en',
      restaurantId,
      onlyDrinkItems: false,
    });
  }

  if (embMatchAny && embMatchAny.confidence >= EMBEDDING_MATCH_THRESHOLD) {
    return embMatchAny;
  }

  // 3) Ingredient fallback — продолжает работать по lowerText (любые языки)
  const ingredientMatch = await matchByIngredients({
    lowerText,
    restaurantId,
  });


  if (ingredientMatch) {
    return ingredientMatch;
  }

  if (embMatchAny) {
    return {
      menu_item_id: embMatchAny.menu_item_id || null,
      confidence: embMatchAny.confidence || 0,
      source: 'embedding_below_threshold',
    };
  }

  return {
    menu_item_id: null,
    confidence: 0,
    source: 'not_found',
  };
}


// Обёртка для совместимости, если вдруг где-то уже вызывается semanticMatch
export async function semanticMatch(text, context = {}) {
  const { restaurantId, locale } = context;
  const match = await matchDishMentionToMenu({
    mentionText: text,
    locale,
    restaurantId,
  });

  return {
    text,
    match,
  };
}

// вверху файла уже есть import { translateToEnglish } from './translationService.js';
// ниже основных экспортов добавь:

/**
 * suggestMenuByText
 *
 * Используется для подсказок блюд над инпутом.
 * Возвращает top-K блюд по косинусному сходству, отфильтрованных по порогу.
 *
 * @param {string} text        — текст запроса (любой язык)
 * @param {string} locale      — язык (можно meta.language или null)
 * @param {string} restaurantId
 * @param {number} limit
 */
export async function suggestMenuByText({ text, locale, restaurantId, limit = 6 }) {
  const original = String(text ?? '');
  const trimmed = original.trim();
  if (!trimmed || !restaurantId) return [];

  // 1) Переводим запрос в EN — так же, как для основного semantic matching
  let textForEmbeddings = trimmed;
  const sourceLang = locale; // хинт для translateToEnglish

  try {
    textForEmbeddings = await translateToEnglish(trimmed, sourceLang);
  } catch (err) {
    console.error('[semanticMatcher] suggestMenuByText translateToEnglish error', err);
    textForEmbeddings = trimmed;
  }

  // 2) Эмбеддинг запроса
  const mentionEmbedding = await getTextEmbedding(textForEmbeddings);

  // 3) Грузим все эмбеддинги меню (EN-only)
  const { rows } = await loadMenuEmbeddings(restaurantId, 'en');

  if (!rows.length) {
    console.log('[suggestMenuByText] no embeddings for restaurant', restaurantId);
    return [];
  }

  const scored = [];

  for (const row of rows) {
    const vec = Array.isArray(row.embedding)
      ? row.embedding
      : row.embedding && Array.isArray(row.embedding.data)
      ? row.embedding.data
      : row.embedding && Array.isArray(row.embedding.values)
      ? row.embedding.values
      : null;

    if (!vec) continue;

    const score = cosineSimilarity(mentionEmbedding, vec);
    if (!Number.isFinite(score)) continue;

    scored.push({
      menu_item_id: row.menu_item_id,
      item_code: row.item_code,
      name_en: row.name_en,
      score,
    });
  }

  if (!scored.length) {
    return [];
  }

  // sort по убыванию
  scored.sort((a, b) => b.score - a.score);

  const topScore = scored[0].score;

  // Если вообще нет приличного совпадения — ничего не показываем
  // (полностью случайные подсказки нам не нужны)
  if (!Number.isFinite(topScore) || topScore < 0.25) {
    console.log('[suggestMenuByText] topScore too low, skip suggestions:', {
      query: trimmed,
      translated: textForEmbeddings,
      topScore,
    });
    return [];
  }

  // Динамический порог: берём max из:
  // - "глобальный" нижний порог (типа 0.4)
  // - доля от topScore, чтобы не тащить совсем хвост
  const dynamicThreshold = Math.max(
    SUGGEST_EMBEDDING_THRESHOLD || 0.4,
    topScore * 0.6
  );

  const filtered = scored.filter((m) => m.score >= dynamicThreshold);

  if (!filtered.length) {
    console.log('[suggestMenuByText] no items above dynamic threshold:', {
      query: trimmed,
      translated: textForEmbeddings,
      topScore,
      dynamicThreshold,
    });
    return [];
  }

  const finalList = filtered.slice(0, limit);

  // Лог для отладки
  console.log('[suggestMenuByText] suggestions:', {
    query: trimmed,
    translated: textForEmbeddings,
    topScore,
    dynamicThreshold,
    items: finalList.map((i) => ({
      code: i.item_code,
      name_en: i.name_en,
      score: i.score,
    })),
  });

  return finalList;
}




