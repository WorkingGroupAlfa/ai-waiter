import {
  listCustomCategories,
  createCustomCategory,
  updateCustomCategory,
  deleteCustomCategory,
  getMenuItemsByCustomCategory,
  matchCustomCategoryFromRows,
} from '../models/customCategoryModel.js';
import { buildQueryUnderstanding } from '../ai/queryUnderstanding.js';
import { translateToEnglish } from '../ai/translationService.js';

const SPECIFIC_QUALIFIER_RE = /\b(with|from|con|de|из|с|з)\s+[\p{L}\p{N}]{3,}/iu;

function normalizeText(v) {
  return String(v || '')
    .normalize('NFKC')
    .toLowerCase()
    .replaceAll('ё', 'е')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC')
    .replace(/[’'`´]+/g, '')
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function buildLookupTexts(text, localeHint = null) {
  const rawText = normalizeText(text);
  const out = [];
  if (rawText) out.push(rawText);

  let translatedText = '';
  try {
    translatedText = normalizeText(
      await translateToEnglish(String(text || ''), localeHint || null)
    );
  } catch (_) {
    translatedText = '';
  }

  if (translatedText && !out.includes(translatedText)) {
    out.push(translatedText);
  }

  return out;
}

export function pickRequestedCustomCategory({
  categories = [],
  text,
  translatedText = '',
  nlu = null,
  queryUnderstanding = null,
} = {}) {
  const lookupTexts = Array.from(
    new Set([normalizeText(text), normalizeText(translatedText)].filter(Boolean))
  );
  if (!lookupTexts.length || !Array.isArray(categories) || categories.length === 0) {
    return null;
  }

  const intent = String(nlu?.intent || '').toLowerCase();
  const intentLooksLikeDiscovery =
    intent === 'ask_menu' ||
    intent === 'unknown' ||
    intent === 'order' ||
    intent === 'add_to_order';

  if (!intentLooksLikeDiscovery) {
    return null;
  }

  const understanding =
    queryUnderstanding ||
    buildQueryUnderstanding(text, {
      localeHint: nlu?.language || nlu?.meta?.language || null,
    });
  const isConceptDriven =
    Array.isArray(understanding?.concepts) && understanding.concepts.length > 0;
  const hasDiscoveryCue = lookupTexts.some((candidate) =>
    /\b(show|recommend|suggest|want|can i get|can i have|do you have|what do you have|есть|покажи|хочу|можно|что у вас есть|що є|що у вас є)\b/iu.test(candidate)
  );
  const looksLikeCategoryRequest =
    isConceptDriven || understanding?.intent === 'category_search' || hasDiscoveryCue;

  const requestedCategory = lookupTexts
    .map((candidate) => matchCustomCategoryFromRows(categories, candidate))
    .find(Boolean);

  if (!requestedCategory) return null;

  const hasResolvedSpecificItem = Array.isArray(nlu?.items)
    ? nlu.items.some((it) => it?.menu_item_id)
    : false;
  const hasStrongSpecificItem = Array.isArray(nlu?.items)
    ? nlu.items.some(
        (it) =>
          it?.menu_item_id &&
          Number.isFinite(Number(it?.matchConfidence)) &&
          Number(it.matchConfidence) >= 0.9
      )
    : false;

  const strongestSpecificItem = Array.isArray(nlu?.items)
    ? [...nlu.items]
        .filter((it) => it?.menu_item_id)
        .sort((a, b) => Number(b?.matchConfidence || 0) - Number(a?.matchConfidence || 0))[0]
    : null;
  const specificItemRawText = normalizeText(strongestSpecificItem?.rawText || '');
  const specificItemLooksLong = specificItemRawText.split(' ').filter(Boolean).length >= 2;

  if (
    hasResolvedSpecificItem &&
    (intent === 'order' || intent === 'add_to_order') &&
    lookupTexts.some((candidate) => SPECIFIC_QUALIFIER_RE.test(candidate))
  ) {
    return null;
  }

  if (
    hasStrongSpecificItem &&
    !hasDiscoveryCue &&
    specificItemLooksLong &&
    (intent === 'order' || intent === 'add_to_order')
  ) {
    return null;
  }

  return requestedCategory;
}

export async function listMenuCustomCategories(restaurantId, options = {}) {
  return listCustomCategories(restaurantId, options);
}

export async function createMenuCustomCategory(payload) {
  return createCustomCategory(payload);
}

export async function updateMenuCustomCategory(id, patch) {
  return updateCustomCategory(id, patch);
}

export async function removeMenuCustomCategory(id) {
  return deleteCustomCategory(id);
}

export async function findRequestedCustomCategory({
  restaurantId,
  text,
  nlu,
  queryUnderstanding = null,
  locale = null,
} = {}) {
  if (!restaurantId || !text) return null;

  const categories = await listCustomCategories(restaurantId, { onlyActive: true });
  if (!Array.isArray(categories) || categories.length === 0) {
    return null;
  }

  const lookupTexts = await buildLookupTexts(
    text,
    locale || nlu?.language || nlu?.meta?.language || null
  );

  return pickRequestedCustomCategory({
    categories,
    text: lookupTexts[0] || text,
    translatedText: lookupTexts[1] || '',
    nlu,
    queryUnderstanding,
  });
}

export async function getCustomCategoryRecommendations({
  restaurantId,
  categoryId,
  limit = 12,
} = {}) {
  const items = await getMenuItemsByCustomCategory({
    restaurantId,
    categoryId,
    limit,
  });

  return (items || [])
    .map((it) => ({
      code: it.item_code,
      name: it.name || it.item_code,
      unitPrice: it.price != null ? Number(it.price) : null,
      imageUrl: it.image_url || null,
      protect_name_from_translation: Boolean(it.protect_name_from_translation),
    }))
    .filter((it) => Boolean(it.code));
}
