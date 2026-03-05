// src/ai/dishSearchEngine.js
// Deterministic multilingual dish retrieval and ranking.

import { query } from '../db.js';
import {
  buildQueryUnderstanding,
  getConceptConfig,
  normalizeQueryText,
  tokenizeNormalized,
} from './queryUnderstanding.js';

const INDEX_TTL_MS = Number(process.env.DISH_INDEX_TTL_MS || 120000);
const SYN_TTL_MS = Number(process.env.DISH_SYNONYM_TTL_MS || 120000);
const MATCH_DEBUG = process.env.AI_MATCH_DEBUG === '1';

const indexCache = new Map(); // restaurantId -> { exp, items }
const synonymCache = new Map(); // restaurantId -> { exp, rows }

function uniqueTokens(values) {
  const out = new Set();
  for (const value of values) {
    const normalized = normalizeQueryText(value);
    if (!normalized) continue;
    for (const token of tokenizeNormalized(normalized)) {
      out.add(token);
    }
  }
  return Array.from(out);
}

function parseIngredients(item) {
  const fromJoin = Array.isArray(item.ingredients) ? item.ingredients : [];
  const fromJson = Array.isArray(item.ingredients_json) ? item.ingredients_json : [];
  return [...fromJoin, ...fromJson]
    .map((x) => String(x || '').trim())
    .filter(Boolean);
}

function normalizeStringSet(values) {
  return new Set(
    (Array.isArray(values) ? values : [])
      .map((x) => normalizeQueryText(x))
      .filter(Boolean)
  );
}

function isCategoryLikeValueMatch(itemSet, allowedValues) {
  for (const value of allowedValues) {
    const norm = normalizeQueryText(value);
    if (!norm) continue;
    if (itemSet.has(norm)) return true;
    if (Array.from(itemSet).some((x) => x.includes(norm))) return true;
  }
  return false;
}

async function loadSynonyms(restaurantId) {
  const key = String(restaurantId);
  const now = Date.now();
  const cached = synonymCache.get(key);
  if (cached && cached.exp > now) return cached.rows;

  const { rows } = await query(
    `
    SELECT phrase, canonical, locale
    FROM ai_synonyms
    WHERE restaurant_id = $1
    `,
    [restaurantId]
  );

  const normalized = (rows || [])
    .map((row) => ({
      phrase: normalizeQueryText(row.phrase),
      canonical: String(row.canonical || '').trim(),
      locale: String(row.locale || '').trim().toLowerCase() || null,
    }))
    .filter((row) => row.phrase && row.canonical);

  synonymCache.set(key, { exp: now + SYN_TTL_MS, rows: normalized });
  return normalized;
}

async function loadMenuIndex(restaurantId) {
  const key = String(restaurantId);
  const now = Date.now();
  const cached = indexCache.get(key);
  if (cached && cached.exp > now) return cached.items;

  const { rows } = await query(
    `
    SELECT
      m.id,
      m.item_code,
      m.name_en,
      m.name_ua,
      m.description_en,
      m.description_ua,
      m.category,
      m.tags,
      m.ingredients AS ingredients_json,
      COALESCE(
        (
          SELECT json_agg(i.name)
          FROM menu_item_ingredients mi
          JOIN ingredients i ON i.id = mi.ingredient_id
          WHERE mi.menu_item_id = m.id
        ),
        '[]'::json
      ) AS ingredients,
      COALESCE(
        (
          SELECT p.url
          FROM menu_item_photos p
          WHERE p.menu_item_id = m.id
          ORDER BY p.sort_order ASC, p.created_at ASC
          LIMIT 1
        ),
        NULL
      ) AS image_url
    FROM menu_items m
    WHERE m.restaurant_id = $1
      AND m.is_active = TRUE
    `,
    [restaurantId]
  );

  const synonyms = await loadSynonyms(restaurantId);
  const synonymsByCode = new Map();
  for (const row of synonyms) {
    if (!synonymsByCode.has(row.canonical)) {
      synonymsByCode.set(row.canonical, []);
    }
    synonymsByCode.get(row.canonical).push(row.phrase);
  }

  const indexed = (rows || []).map((item) => {
    const category = normalizeQueryText(item.category);
    const tags = Array.isArray(item.tags) ? item.tags.map((x) => String(x || '').trim()).filter(Boolean) : [];
    const ingredients = parseIngredients(item);
    const itemSynonyms = synonymsByCode.get(String(item.item_code || '').trim()) || [];

    const searchTokens = uniqueTokens([
      item.name_en,
      item.name_ua,
      item.description_en,
      item.description_ua,
      category,
      ...tags,
      ...ingredients,
      ...itemSynonyms,
      String(item.item_code || ''),
    ]);

    return {
      id: item.id,
      item_code: item.item_code,
      name_en: item.name_en,
      name_local: item.name_ua,
      category,
      tags,
      ingredients,
      synonyms: itemSynonyms,
      image_url: item.image_url || null,
      search_tokens: searchTokens,
      tokenSet: new Set(searchTokens),
      tagSet: normalizeStringSet(tags),
      ingredientSet: normalizeStringSet(ingredients),
      categorySet: normalizeStringSet([category]),
    };
  });

  indexCache.set(key, { exp: now + INDEX_TTL_MS, items: indexed });
  return indexed;
}

function calculateScore({ queryTokens, strictConcepts, preferenceConcepts, item }) {
  let tokenOverlap = 0;
  let ingredientMatch = 0;
  let tagMatch = 0;
  let categoryMatch = 0;
  let conceptMatch = 0;

  for (const token of queryTokens) {
    if (item.tokenSet.has(token)) {
      tokenOverlap += 1;
    }
    if (item.ingredientSet.has(token)) {
      ingredientMatch += 1;
    }
    if (item.tagSet.has(token)) {
      tagMatch += 1;
    }
    if (item.categorySet.has(token)) {
      categoryMatch += 1;
    }
  }

  for (const conceptName of strictConcepts) {
    const cfg = getConceptConfig(conceptName);
    if (!cfg) continue;
    const categoryHit = isCategoryLikeValueMatch(item.categorySet, cfg.allowCategories || []);
    const tagHit = isCategoryLikeValueMatch(item.tagSet, cfg.allowTags || []);
    const ingredientHit = isCategoryLikeValueMatch(item.ingredientSet, cfg.allowIngredients || []);
    if (categoryHit || tagHit || ingredientHit) {
      conceptMatch += 1;
      if (categoryHit) categoryMatch += 1;
      if (tagHit) tagMatch += 1;
      if (ingredientHit) ingredientMatch += 1;
    }
  }

  for (const conceptName of preferenceConcepts) {
    const cfg = getConceptConfig(conceptName);
    if (!cfg) continue;
    const tagHit = isCategoryLikeValueMatch(item.tagSet, cfg.allowTags || []);
    const ingredientHit = isCategoryLikeValueMatch(item.ingredientSet, cfg.allowIngredients || []);
    if (tagHit || ingredientHit) {
      conceptMatch += 1;
      if (tagHit) tagMatch += 1;
      if (ingredientHit) ingredientMatch += 1;
    }
  }

  const score =
    tokenOverlap * 3 +
    categoryMatch * 5 +
    tagMatch * 2 +
    ingredientMatch * 1 +
    conceptMatch * 4;

  return {
    score,
    tokenOverlap,
    categoryMatch,
    tagMatch,
    ingredientMatch,
    conceptMatch,
  };
}

function buildStrictConcepts(concepts) {
  return concepts.filter((conceptName) => getConceptConfig(conceptName)?.strict);
}

function buildPreferenceConcepts(concepts) {
  return concepts.filter((conceptName) => !getConceptConfig(conceptName)?.strict);
}

function itemMatchesStrictConcept(item, conceptName) {
  const cfg = getConceptConfig(conceptName);
  if (!cfg) return false;
  const categoryHit = isCategoryLikeValueMatch(item.categorySet, cfg.allowCategories || []);
  const tagHit = isCategoryLikeValueMatch(item.tagSet, cfg.allowTags || []);
  const ingredientHit = isCategoryLikeValueMatch(item.ingredientSet, cfg.allowIngredients || []);
  const tokenHit = (cfg.requiredTokens || []).some((token) => item.tokenSet.has(token));
  return categoryHit || tagHit || ingredientHit || tokenHit;
}

function passesStrictFiltering(item, strictConcepts) {
  if (!strictConcepts.length) return true;
  return strictConcepts.every((conceptName) => itemMatchesStrictConcept(item, conceptName));
}

function mapResultRow(item, scoreInfo) {
  return {
    menu_item_id: item.id,
    item_code: item.item_code,
    name_en: item.name_en || null,
    name_local: item.name_local || null,
    image_url: item.image_url || null,
    score: scoreInfo.score,
    score_breakdown: {
      token_overlap: scoreInfo.tokenOverlap,
      category_match: scoreInfo.categoryMatch,
      tag_match: scoreInfo.tagMatch,
      ingredient_match: scoreInfo.ingredientMatch,
      concept_match: scoreInfo.conceptMatch,
    },
  };
}

export function rankDishCandidatesFromIndex({
  queryText,
  locale = null,
  indexItems = [],
  limit = 6,
}) {
  const understanding = buildQueryUnderstanding(queryText, { localeHint: locale });
  const strictConcepts = buildStrictConcepts(understanding.concepts || []);
  const preferenceConcepts = buildPreferenceConcepts(understanding.concepts || []);
  const queryTokens = understanding.tokens || [];

  const strictCandidates = indexItems.filter((item) => passesStrictFiltering(item, strictConcepts));
  if (strictConcepts.length > 0 && strictCandidates.length === 0) {
    return { understanding, strictConcepts, results: [], blockedByStrictFilter: true };
  }

  const scored = [];
  for (const item of strictCandidates) {
    const scoreInfo = calculateScore({
      queryTokens,
      strictConcepts,
      preferenceConcepts,
      item,
    });
    if (scoreInfo.score <= 0) continue;
    scored.push(mapResultRow(item, scoreInfo));
  }

  scored.sort((a, b) => b.score - a.score);
  const minScore = strictConcepts.length > 0 ? 5 : 3;
  return {
    understanding,
    strictConcepts,
    blockedByStrictFilter: false,
    results: scored.filter((row) => row.score >= minScore).slice(0, limit),
  };
}

export function invalidateDishSearchCache(restaurantId) {
  if (!restaurantId) return;
  const key = String(restaurantId);
  indexCache.delete(key);
  synonymCache.delete(key);
}

export async function findDishCandidates({
  text,
  locale = null,
  restaurantId,
  limit = 6,
}) {
  if (!restaurantId) return { understanding: null, strictConcepts: [], results: [], blockedByStrictFilter: false };

  const understanding = buildQueryUnderstanding(text, { localeHint: locale });
  const index = await loadMenuIndex(restaurantId);
  if (!index.length) {
    return { understanding, strictConcepts: [], results: [], blockedByStrictFilter: false };
  }

  const ranked = rankDishCandidatesFromIndex({
    queryText: text,
    locale,
    indexItems: index,
    limit,
  });

  if (MATCH_DEBUG) {
    console.log('[AI_MATCH_DEBUG][findDishCandidates]', {
      restaurantId,
      text,
      detected_language: ranked?.understanding?.language || null,
      intent: ranked?.understanding?.intent || null,
      concepts: ranked?.understanding?.concepts || [],
      strictConcepts: ranked?.strictConcepts || [],
      blockedByStrictFilter: Boolean(ranked?.blockedByStrictFilter),
      topCandidates: (ranked?.results || []).slice(0, 5).map((r) => ({
        item_code: r.item_code,
        score: r.score,
        score_breakdown: r.score_breakdown,
      })),
    });
  }

  return ranked;
}

export async function matchSingleDishDeterministic({
  mentionText,
  locale = null,
  restaurantId,
}) {
  const search = await findDishCandidates({
    text: mentionText,
    locale,
    restaurantId,
    limit: 1,
  });

  if (!search.results.length) {
    return {
      match: null,
      strictConcepts: search.strictConcepts || [],
      blockedByStrictFilter: Boolean(search.blockedByStrictFilter),
      understanding: search.understanding || null,
    };
  }

  const best = search.results[0];
  const confidence = Math.max(0, Math.min(0.99, best.score / 20));

  return {
    match: {
      menu_item_id: best.menu_item_id,
      confidence,
      source: 'deterministic_scoring',
      score: best.score,
      score_breakdown: best.score_breakdown,
    },
    strictConcepts: search.strictConcepts || [],
    blockedByStrictFilter: false,
    understanding: search.understanding || null,
  };
}
