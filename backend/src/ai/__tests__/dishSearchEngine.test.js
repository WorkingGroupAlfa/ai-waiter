import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildQueryUnderstanding,
  normalizeQueryText,
  tokenizeNormalized,
} from '../queryUnderstanding.js';
import { rankDishCandidatesFromIndex } from '../dishSearchEngine.js';

function buildIndexItem({
  id,
  item_code,
  name_en,
  name_local,
  category,
  tags = [],
  ingredients = [],
  synonyms = [],
}) {
  const tokens = new Set();
  const pushTokens = (value) => {
    const normalized = normalizeQueryText(value);
    for (const token of tokenizeNormalized(normalized)) {
      tokens.add(token);
    }
  };

  [name_en, name_local, category, ...tags, ...ingredients, ...synonyms, item_code].forEach(pushTokens);

  const normalizedTags = new Set(tags.map((x) => normalizeQueryText(x)).filter(Boolean));
  const normalizedIngredients = new Set(
    ingredients.map((x) => normalizeQueryText(x)).filter(Boolean)
  );
  const normalizedCategory = new Set([normalizeQueryText(category)].filter(Boolean));

  return {
    id,
    item_code,
    name_en,
    name_local,
    category: normalizeQueryText(category),
    tags,
    ingredients,
    synonyms,
    search_tokens: Array.from(tokens),
    tokenSet: tokens,
    tagSet: normalizedTags,
    ingredientSet: normalizedIngredients,
    categorySet: normalizedCategory,
    image_url: null,
  };
}

const SAMPLE_INDEX = [
  buildIndexItem({
    id: '1',
    item_code: 'CHICKEN_RAMEN',
    name_en: 'Chicken Ramen',
    name_local: '\u0420\u0430\u043c\u0435\u043d \u0437 \u043a\u0443\u0440\u043a\u043e\u044e',
    category: 'ramen',
    tags: ['noodles', 'soup'],
    ingredients: ['chicken', 'noodles'],
  }),
  buildIndexItem({
    id: '2',
    item_code: 'SPICY_UDON',
    name_en: 'Spicy Udon',
    name_local: '\u0413\u043e\u0441\u0442\u0440\u0438\u0439 \u0443\u0434\u043e\u043d',
    category: 'udon',
    tags: ['noodles', 'spicy'],
    ingredients: ['udon', 'chili'],
  }),
  buildIndexItem({
    id: '3',
    item_code: 'TUNA_NIGIRI',
    name_en: 'Tuna Nigiri',
    name_local: '\u0422\u0443\u043d\u0435\u0446\u044c \u043d\u0456\u0433\u0456\u0440\u0456',
    category: 'nigiri',
    tags: ['sushi', 'fish'],
    ingredients: ['tuna', 'rice'],
  }),
  buildIndexItem({
    id: '4',
    item_code: 'SALMON_SUSHI_SET',
    name_en: 'Salmon Sushi Set',
    name_local: '\u0421\u0443\u0448\u0456 \u0437 \u043b\u043e\u0441\u043e\u0441\u0435\u043c',
    category: 'sushi',
    tags: ['sushi', 'rolls'],
    ingredients: ['salmon', 'rice'],
  }),
  buildIndexItem({
    id: '5',
    item_code: 'BEEF_STEAK',
    name_en: 'Beef Steak',
    name_local: '\u0421\u0442\u0435\u0439\u043a \u0437 \u044f\u043b\u043e\u0432\u0438\u0447\u0438\u043d\u0438',
    category: 'main',
    tags: ['meat', 'main'],
    ingredients: ['beef', 'pepper'],
  }),
  buildIndexItem({
    id: '6',
    item_code: 'EDAMAME',
    name_en: 'Edamame',
    name_local: '\u0415\u0434\u0430\u043c\u0430\u043c\u0435',
    category: 'hot starters',
    tags: ['vegan', 'starter'],
    ingredients: ['soybeans', 'salt'],
  }),
];

test('query understanding maps EN/RU/UK noodles to same concept', () => {
  const en = buildQueryUnderstanding('noodles', { localeHint: 'en' });
  const ru = buildQueryUnderstanding('\u043b\u0430\u043f\u0448\u0430', { localeHint: 'ru' });
  const uk = buildQueryUnderstanding('\u043b\u043e\u043a\u0448\u0438\u043d\u0430', { localeHint: 'uk' });

  assert.ok(en.concepts.includes('noodles'));
  assert.ok(ru.concepts.includes('noodles'));
  assert.ok(uk.concepts.includes('noodles'));
});

test('noodles query returns noodle dishes and excludes nigiri', () => {
  const result = rankDishCandidatesFromIndex({
    queryText: 'noodles',
    locale: 'en',
    indexItems: SAMPLE_INDEX,
    limit: 5,
  });

  assert.ok(result.results.length >= 2);
  assert.equal(result.results.some((x) => x.item_code === 'TUNA_NIGIRI'), false);
  assert.equal(result.results[0].item_code, 'CHICKEN_RAMEN');
});

test('ukrainian nigiri query returns nigiri only', () => {
  const result = rankDishCandidatesFromIndex({
    queryText: '\u043d\u0456\u0433\u0456\u0440\u0456',
    locale: 'uk',
    indexItems: SAMPLE_INDEX,
    limit: 5,
  });

  assert.ok(result.results.length >= 1);
  assert.equal(result.results[0].item_code, 'TUNA_NIGIRI');
  assert.equal(result.results.some((x) => x.item_code === 'CHICKEN_RAMEN'), false);
});

test('salmon sushi query prefers salmon sushi variants', () => {
  const result = rankDishCandidatesFromIndex({
    queryText: 'salmon sushi',
    locale: 'en',
    indexItems: SAMPLE_INDEX,
    limit: 5,
  });

  assert.ok(result.results.length >= 1);
  assert.equal(result.results[0].item_code, 'SALMON_SUSHI_SET');
});

test('spicy query prefers spicy tagged dish', () => {
  const result = rankDishCandidatesFromIndex({
    queryText: 'something spicy',
    locale: 'en',
    indexItems: SAMPLE_INDEX,
    limit: 5,
  });

  assert.ok(result.results.length >= 1);
  assert.equal(result.results[0].item_code, 'SPICY_UDON');
});

test('burger concept is strict and returns no unrelated matches when absent', () => {
  const result = rankDishCandidatesFromIndex({
    queryText: 'burger',
    locale: 'en',
    indexItems: SAMPLE_INDEX,
    limit: 5,
  });

  assert.equal(result.blockedByStrictFilter, true);
  assert.equal(result.results.length, 0);
});

test('meat dishes query returns meat dishes and excludes vegetarian starters', () => {
  const result = rankDishCandidatesFromIndex({
    queryText: 'Do you have meat dishes?',
    locale: 'en',
    indexItems: SAMPLE_INDEX,
    limit: 5,
  });

  assert.ok(result.results.length >= 1);
  assert.equal(result.results.some((x) => x.item_code === 'BEEF_STEAK'), true);
  assert.equal(result.results.some((x) => x.item_code === 'EDAMAME'), false);
});
