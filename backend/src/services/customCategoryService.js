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
  'хочу',
  'покажи',
  'что у вас есть',
  'що у вас є',
  'хочу щось',
  'дай',
  'можно',
  'можна',
];

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

  const rawText = String(text || '').toLowerCase();
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

  return findCustomCategoryByMention(restaurantId, rawText);
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

  return (items || []).map((it) => ({
    code: it.item_code,
    name: it.name || it.item_code,
    unitPrice: it.price != null ? Number(it.price) : null,
    imageUrl: it.image_url || null,
  }));
}

