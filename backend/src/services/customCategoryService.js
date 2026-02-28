import {
  listCustomCategories,
  createCustomCategory,
  updateCustomCategory,
  deleteCustomCategory,
  getMenuItemsByCustomCategory,
  findCustomCategoryByMention,
} from '../models/customCategoryModel.js';

const CATEGORY_REQUEST_PHRASES = [
  'want',
  'show',
  'what do you have',
  'i want',
  'please',
  'can i get',
  'хочу',
  'покажи',
  'что есть',
  'что у вас есть',
  'що у вас є',
  'можно',
  'можна',
  'дай',
];

const SPECIFIC_QUALIFIER_RE = /\b(with|с|з)\s+[\p{L}\p{N}]{3,}/iu;

function normalizeText(v) {
  return String(v || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
} = {}) {
  if (!restaurantId || !text) return null;

  const rawText = normalizeText(text);
  const hasRequestPhrase = CATEGORY_REQUEST_PHRASES.some((p) =>
    rawText.includes(p)
  );

  const intent = String(nlu?.intent || '').toLowerCase();
  const intentLooksLikeDiscovery =
    intent === 'ask_menu' ||
    intent === 'order' ||
    intent === 'add_to_order' ||
    intent === 'unknown';

  if (!hasRequestPhrase && !intentLooksLikeDiscovery) {
    return null;
  }

  const requestedCategory = await findCustomCategoryByMention(
    restaurantId,
    rawText
  );
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
  if (
    hasResolvedSpecificItem &&
    (intent === 'order' || intent === 'add_to_order') &&
    SPECIFIC_QUALIFIER_RE.test(rawText)
  ) {
    return null;
  }

  if (
    hasStrongSpecificItem &&
    !hasRequestPhrase &&
    (intent === 'order' || intent === 'add_to_order')
  ) {
    return null;
  }

  return requestedCategory;
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
    }))
    .filter((it) => Boolean(it.code));
}
