import test from 'node:test';
import assert from 'node:assert/strict';

import { buildQueryUnderstanding } from '../../ai/queryUnderstanding.js';
import { pickRequestedCustomCategory } from '../customCategoryService.js';

const SAMPLE_CATEGORIES = [
  {
    id: 'cat-tequila',
    slug: 'tequila',
    name_ua: 'Текіла',
    name_en: 'Tequila',
    aliases: ['tequila', 'текіла', 'текила'],
  },
  {
    id: 'cat-main',
    slug: 'main-dishes',
    name_ua: 'Основні страви',
    name_en: 'Main dishes',
    aliases: ['main dishes', 'main course', 'основные блюда', 'основні страви'],
  },
];

test('"хочу текилу" resolves to tequila custom category', () => {
  const result = pickRequestedCustomCategory({
    categories: SAMPLE_CATEGORIES,
    text: 'хочу текилу',
    nlu: { intent: 'order', items: [] },
    queryUnderstanding: buildQueryUnderstanding('хочу текилу', { localeHint: 'ru' }),
  });

  assert.equal(result?.id, 'cat-tequila');
});

test('"do you have tequila" resolves to tequila custom category', () => {
  const result = pickRequestedCustomCategory({
    categories: SAMPLE_CATEGORIES,
    text: 'do you have tequila',
    nlu: { intent: 'ask_menu', items: [] },
    queryUnderstanding: buildQueryUnderstanding('do you have tequila', { localeHint: 'en' }),
  });

  assert.equal(result?.id, 'cat-tequila');
});

test('same category request works with translated lookup from another supported language', () => {
  const result = pickRequestedCustomCategory({
    categories: SAMPLE_CATEGORIES,
    text: 'quiero tequila',
    translatedText: 'i want tequila',
    nlu: { intent: 'unknown', items: [] },
    queryUnderstanding: buildQueryUnderstanding('quiero tequila', { localeHint: 'es' }),
  });

  assert.equal(result?.id, 'cat-tequila');
});

test('exact tequila item request is not hijacked by tequila custom category', () => {
  const result = pickRequestedCustomCategory({
    categories: SAMPLE_CATEGORIES,
    text: 'Tequila Sunrise',
    nlu: {
      intent: 'order',
      items: [
        {
          rawText: 'Tequila Sunrise',
          menu_item_id: 'menu-77',
          matchConfidence: 0.97,
        },
      ],
    },
    queryUnderstanding: buildQueryUnderstanding('Tequila Sunrise', { localeHint: 'en' }),
  });

  assert.equal(result, null);
});
