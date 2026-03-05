// src/ai/queryUnderstanding.js
// Deterministic multilingual query understanding for dish/category search.

const DISH_CONCEPTS = {
  noodles: {
    strict: true,
    terms: [
      'noodle',
      'noodles',
      '\u043b\u0430\u043f\u0448\u0430',
      '\u043b\u043e\u043a\u0448\u0438\u043d\u0430',
      '\u043b\u043e\u043a\u0448\u0438\u043d\u0443',
      '\u0440\u0430\u043c\u0435\u043d',
      'ramen',
      '\u0443\u0434\u043e\u043d',
      'udon',
    ],
    requiredTokens: [
      'noodl',
      '\u043b\u0430\u043f\u0448',
      '\u043b\u043e\u043a\u0448\u0438\u043d',
      'ramen',
      '\u0440\u0430\u043c\u0435\u043d',
      'udon',
      '\u0443\u0434\u043e\u043d',
    ],
    allowTags: ['noodles', 'noodle', 'ramen', 'udon'],
    allowCategories: ['noodles', 'ramen', 'udon', 'soup', 'main', 'main dish'],
  },
  nigiri: {
    strict: true,
    terms: ['nigiri', '\u043d\u0456\u0433\u0456\u0440\u0456', '\u043d\u0438\u0433\u0438\u0440\u0438'],
    requiredTokens: ['nigiri', '\u043d\u0456\u0433\u0456\u0440', '\u043d\u0438\u0433\u0438\u0440'],
    allowTags: ['nigiri', 'sushi'],
    allowCategories: ['nigiri', 'sushi'],
  },
  sushi: {
    strict: true,
    terms: ['sushi', '\u0441\u0443\u0448\u0456', '\u0441\u0443\u0448\u0438', '\u0440\u043e\u043b\u0438', '\u0440\u043e\u043b\u043b\u044b', '\u0440\u043e\u043b'],
    requiredTokens: ['sushi', '\u0441\u0443\u0448', '\u0440\u043e\u043b'],
    allowTags: ['sushi', 'roll', 'rolls', 'maki'],
    allowCategories: ['sushi', 'rolls'],
  },
  sashimi: {
    strict: true,
    terms: ['sashimi', '\u0441\u0430\u0448\u0438\u043c\u0456', '\u0441\u0430\u0448\u0438\u043c\u0438'],
    requiredTokens: ['sashimi', '\u0441\u0430\u0448\u0438\u043c'],
    allowTags: ['sashimi', 'sushi'],
    allowCategories: ['sashimi', 'sushi'],
  },
  gunkan: {
    strict: true,
    terms: ['gunkan', '\u0433\u0443\u043d\u043a\u0430\u043d'],
    requiredTokens: ['gunkan', '\u0433\u0443\u043d\u043a\u0430\u043d'],
    allowTags: ['gunkan', 'sushi'],
    allowCategories: ['gunkan', 'sushi'],
  },
  temaki: {
    strict: true,
    terms: [
      'temaki',
      '\u0442\u0435\u043c\u0430\u043a\u0456',
      '\u0442\u0435\u043c\u0430\u043a\u0438',
      'hand roll',
      'handroll',
      '\u0445\u0435\u043d\u0434 \u0440\u043e\u043b',
      '\u0445\u0435\u043d\u0434\u0440\u043e\u043b',
    ],
    requiredTokens: ['temaki', '\u0442\u0435\u043c\u0430\u043a', 'handroll', '\u0445\u0435\u043d\u0434\u0440\u043e\u043b'],
    allowTags: ['temaki', 'handroll', 'sushi'],
    allowCategories: ['temaki', 'sushi'],
  },
  soup: {
    strict: true,
    terms: ['soup', 'soups', '\u0441\u0443\u043f', '\u0441\u0443\u043f\u0438', '\u0441\u0443\u043f\u044b', 'miso soup', '\u043c\u0456\u0441\u043e \u0441\u0443\u043f'],
    requiredTokens: ['soup', '\u0441\u0443\u043f'],
    allowTags: ['soup', 'soups'],
    allowCategories: ['soup', 'soups'],
  },
  salad: {
    strict: true,
    terms: ['salad', 'salads', '\u0441\u0430\u043b\u0430\u0442', '\u0441\u0430\u043b\u0430\u0442\u0438', '\u0441\u0430\u043b\u0430\u0442\u044b'],
    requiredTokens: ['salad', '\u0441\u0430\u043b\u0430\u0442'],
    allowTags: ['salad', 'salads', 'light'],
    allowCategories: ['salad', 'salads'],
  },
  dessert: {
    strict: true,
    terms: [
      'dessert',
      'desserts',
      '\u0434\u0435\u0441\u0435\u0440\u0442',
      '\u0434\u0435\u0441\u0435\u0440\u0442\u0438',
      '\u0434\u0435\u0441\u0435\u0440\u0442\u044b',
      'sorbet',
      '\u043c\u043e\u0440\u043e\u0437\u0438\u0432\u043e',
      '\u043c\u043e\u0440\u043e\u0436\u0435\u043d\u043e\u0435',
    ],
    requiredTokens: ['dessert', '\u0434\u0435\u0441\u0435\u0440\u0442', 'sorbet', '\u043c\u043e\u0440\u043e\u0437\u0438\u0432', '\u043c\u043e\u0440\u043e\u0436\u0435\u043d'],
    allowTags: ['dessert', 'sweet'],
    allowCategories: ['dessert', 'desserts'],
  },
  drink: {
    strict: true,
    terms: [
      'drink',
      'drinks',
      '\u043d\u0430\u043f\u0456\u0439',
      '\u043d\u0430\u043f\u043e\u0457',
      '\u043d\u0430\u043f\u0438\u0442\u043e\u043a',
      '\u043d\u0430\u043f\u0438\u0442\u043a\u0438',
      'beverage',
      'cola',
      'coke',
    ],
    requiredTokens: ['drink', '\u043d\u0430\u043f', 'beverage', 'cola', 'coke'],
    allowTags: ['drink', 'beverage'],
    allowCategories: ['drink', 'drinks'],
  },
  spicy: {
    strict: false,
    terms: [
      'spicy',
      '\u0433\u043e\u0441\u0442\u0440\u0438\u0439',
      '\u0433\u043e\u0441\u0442\u0440\u043e',
      '\u043e\u0441\u0442\u0440\u044b\u0439',
      '\u043e\u0441\u0442\u0440\u043e',
      '\u043f\u0456\u043a\u0430\u043d\u0442\u043d\u0438\u0439',
      '\u043f\u0438\u043a\u0430\u043d\u0442',
    ],
    requiredTokens: ['spicy', '\u0433\u043e\u0441\u0442\u0440', '\u043e\u0441\u0442\u0440', '\u043f\u0456\u043a\u0430\u043d\u0442', '\u043f\u0438\u043a\u0430\u043d\u0442'],
    allowTags: ['spicy', 'hot'],
    allowCategories: [],
  },
};

const ORDER_VERBS = [
  '\u0445\u043e\u0447\u0443',
  '\u043c\u043e\u0436\u043d\u0430',
  '\u0437\u0430\u043a\u0430\u0436',
  '\u0437\u0430\u043a\u0430\u0437\u0430\u0442\u044c',
  '\u0437\u0430\u043c\u043e\u0432',
  'please bring',
  'i want',
  'can i have',
  'get me',
  'add to order',
];

const RECOMMENDATION_VERBS = [
  'recommend',
  'suggest',
  'what do you have',
  'show menu',
  '\u043f\u043e\u0440\u0430\u0434\u044c',
  '\u043f\u043e\u0440\u0435\u043a\u043e\u043c\u0435\u043d\u0434\u0443\u0439',
  '\u0449\u043e \u0454',
  '\u043f\u043e\u043a\u0430\u0436\u0438 \u043c\u0435\u043d\u044e',
  '\u0447\u0442\u043e \u0435\u0441\u0442\u044c',
];

export { DISH_CONCEPTS };

export function detectQueryLanguage(text, localeHint = null) {
  const src = String(text || '').trim();
  if (!src) return String(localeHint || 'unknown').toLowerCase();

  const hasLatin = /[a-z]/i.test(src);
  const hasCyr = /[\u0430-\u044f\u0451\u0456\u0457\u0454\u0491\u044b\u044d\u044a]/i.test(src);
  const hasUkMarkers = /[\u0456\u0457\u0454\u0491]/i.test(src);
  const hasRuMarkers = /[\u044b\u044d\u044a\u0451]/i.test(src);

  if (hasLatin && hasCyr) return 'mixed';
  if (hasLatin) return 'en';
  if (hasCyr) {
    if (hasUkMarkers && !hasRuMarkers) return 'uk';
    if (hasRuMarkers && !hasUkMarkers) return 'ru';
    return String(localeHint || 'uk').toLowerCase().startsWith('ru') ? 'ru' : 'uk';
  }

  const hint = String(localeHint || '').toLowerCase();
  if (/^[a-z]{2}/.test(hint)) return hint.slice(0, 2);
  return 'unknown';
}

export function normalizeQueryText(text) {
  return String(text || '')
    .toLowerCase()
    .replaceAll('\u0451', '\u0435')
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stemToken(token) {
  let t = String(token || '').toLowerCase();
  if (!t) return '';

  const suffixes = [
    '\u0438\u044f\u043c\u0438',
    '\u044f\u043c\u0438',
    '\u0430\u043c\u0438',
    '\u043e\u0433\u043e',
    '\u0435\u043c\u0443',
    '\u043e\u043c\u0443',
    '\u0438\u043c\u0438',
    '\u0438\u0439',
    '\u044b\u0439',
    '\u043e\u0439',
    '\u0430\u044f',
    '\u044f\u044f',
    '\u043e\u0435',
    '\u0435\u0435',
    '\u044b\u0435',
    '\u0438\u0435',
    '\u043e\u0432',
    '\u0435\u0432',
    '\u0435\u0439',
    '\u0430\u043c',
    '\u044f\u043c',
    '\u0430\u0445',
    '\u044f\u0445',
    '\u0430',
    '\u044f',
    '\u0443',
    '\u044e',
    '\u044b',
    '\u0438',
    '\u0435',
    '\u043e',
    'ing',
    'ings',
    'ed',
    'es',
    's',
  ];

  for (const suffix of suffixes) {
    if (t.length > suffix.length + 2 && t.endsWith(suffix)) {
      t = t.slice(0, -suffix.length);
      break;
    }
  }
  return t;
}

export function tokenizeNormalized(normalizedText) {
  if (!normalizedText) return [];
  return normalizedText
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .map(stemToken)
    .filter(Boolean);
}

export function extractConcepts(normalizedText, tokens = []) {
  const concepts = new Set();
  const tokenSet = new Set(tokens);

  for (const [name, cfg] of Object.entries(DISH_CONCEPTS)) {
    const phraseHit = cfg.terms.some((term) => normalizedText.includes(normalizeQueryText(term)));
    const tokenHit = cfg.requiredTokens.some((k) => tokenSet.has(stemToken(k)));
    if (phraseHit || tokenHit) {
      concepts.add(name);
    }
  }
  return Array.from(concepts);
}

export function classifyQueryIntent(normalizedText, concepts = []) {
  if (!normalizedText) return 'unknown';
  if (ORDER_VERBS.some((w) => normalizedText.includes(w))) return 'order_action';
  if (RECOMMENDATION_VERBS.some((w) => normalizedText.includes(w))) return 'recommendation';
  if (concepts.length > 0) return 'category_search';
  return 'dish_search';
}

export function buildQueryUnderstanding(text, { localeHint = null } = {}) {
  const language = detectQueryLanguage(text, localeHint);
  const normalized = normalizeQueryText(text);
  const tokens = tokenizeNormalized(normalized);
  const concepts = extractConcepts(normalized, tokens);
  const intent = classifyQueryIntent(normalized, concepts);

  return {
    original: String(text || ''),
    language,
    normalized,
    tokens,
    tokenSet: new Set(tokens),
    concepts,
    intent,
  };
}

export function getConceptConfig(conceptName) {
  return DISH_CONCEPTS[conceptName] || null;
}

