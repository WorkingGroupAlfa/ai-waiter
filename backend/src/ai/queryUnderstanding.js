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
  meat: {
    strict: false,
    terms: [
      'meat',
      'meaty',
      '\u043c\u044f\u0441\u043e',
      '\u043c\u044f\u0441\u043d\u043e\u0435',
      '\u043c\u2019\u044f\u0441\u043d\u0435',
      "\u043c'\u044f\u0441\u043e",
      '\u043c\u2019\u044f\u0441\u043e',
      'beef',
      'chicken',
      'duck',
      'pork',
      'lamb',
    ],
    requiredTokens: ['meat', '\u043c\u044f\u0441', '\u043c\u044f\u0441\u043d', "\u043c'\u044f\u0441", 'beef', 'chicken', 'duck', 'pork', 'lamb'],
    allowTags: ['meat', 'beef', 'chicken', 'duck', 'pork', 'lamb'],
    allowCategories: ['main', 'hot dishes', 'grill'],
    allowIngredients: ['beef', 'chicken', 'duck', 'pork', 'lamb', '\u044f\u043b\u043e\u0432\u0438\u0447', '\u043a\u0443\u0440', '\u043a\u0430\u0447\u043a', '\u0441\u0432\u0438\u043d', '\u0431\u0430\u0440\u0430\u043d'],
  },
  chicken: {
    strict: false,
    terms: [
      'chicken',
      '\u043a\u0443\u0440\u0438\u0446\u0430',
      '\u043a\u0443\u0440\u0438\u0446\u0435\u0439',
      '\u043a\u0443\u0440\u043a\u0443',
      '\u043a\u0443\u0440\u043a\u0430',
      '\u043a\u0443\u0440\u043a\u043e\u044e',
    ],
    requiredTokens: ['chicken', '\u043a\u0443\u0440', '\u043a\u0443\u0440\u0438\u0446', '\u043a\u0443\u0440\u043a'],
    allowTags: ['chicken', 'meat', 'main'],
    allowCategories: ['main', 'hot dishes', 'grill'],
    allowIngredients: ['chicken', '\u043a\u0443\u0440\u0438\u0446\u0430', '\u043a\u0443\u0440\u043a\u0430', '\u043a\u0443\u0440\u044f\u0447', '\u043a\u0443\u0440\u0438\u043d'],
  },
  shrimp: {
    strict: false,
    terms: [
      'shrimp',
      'prawn',
      '\u043a\u0440\u0435\u0432\u0435\u0442',
      '\u043a\u0440\u0435\u0432\u0435\u0442\u043a',
      '\u867e',
      't\u00f4m',
    ],
    requiredTokens: ['shrimp', 'prawn', '\u043a\u0440\u0435\u0432\u0435\u0442', '\u867e', 'tom'],
    allowTags: ['shrimp', 'prawn', 'seafood'],
    allowCategories: ['seafood', 'sushi', 'main'],
    allowIngredients: ['shrimp', 'prawn', '\u043a\u0440\u0435\u0432\u0435\u0442', '\u0442\u0438\u0433\u0440\u043e\u0432', 'ebi', '\u867e', 't\u00f4m'],
  },
  tuna: {
    strict: false,
    terms: ['tuna', '\u0442\u0443\u043d\u0435\u0446', '\u0442\u0443\u043d\u0435\u0446\u044c', '\u9c94\u9c7c', 'c\u00e1 ng\u1eeb'],
    requiredTokens: ['tuna', '\u0442\u0443\u043d\u0435\u0446', '\u9c94\u9c7c', 'cangu'],
    allowTags: ['tuna', 'fish', 'sushi'],
    allowCategories: ['sushi', 'sashimi', 'nigiri'],
    allowIngredients: ['tuna', '\u0442\u0443\u043d\u0435\u0446', '\u0442\u0443\u043d\u0435\u0446\u044c', 'maguro', '\u9c94\u9c7c', 'c\u00e1 ng\u1eeb'],
  },
  salmon: {
    strict: false,
    terms: ['salmon', '\u043b\u043e\u0441\u043e\u0441', '\u4e09\u6587\u9c7c', 'c\u00e1 h\u1ed3i'],
    requiredTokens: ['salmon', '\u043b\u043e\u0441\u043e\u0441', '\u4e09\u6587\u9c7c', 'cahoi'],
    allowTags: ['salmon', 'fish', 'sushi'],
    allowCategories: ['sushi', 'sashimi', 'nigiri'],
    allowIngredients: ['salmon', '\u043b\u043e\u0441\u043e\u0441', '\u0441\u044c\u043e\u043c\u0433', '\u4e09\u6587\u9c7c', 'c\u00e1 h\u1ed3i'],
  },
  crab: {
    strict: false,
    terms: ['crab', '\u043a\u0440\u0430\u0431', '\u87f9', 'cua'],
    requiredTokens: ['crab', '\u043a\u0440\u0430\u0431', '\u87f9', 'cua'],
    allowTags: ['crab', 'seafood', 'sushi'],
    allowCategories: ['seafood', 'sushi', 'main'],
    allowIngredients: ['crab', '\u043a\u0440\u0430\u0431', '\u043a\u0440\u0430\u0431\u043e\u0432', 'kani', '\u87f9', 'cua'],
  },
  beef: {
    strict: false,
    terms: ['beef', '\u0433\u043e\u0432\u044f\u0434\u0438\u043d\u0430', '\u044f\u043b\u043e\u0432\u0438\u0447', '\u725b\u8089', 'b\u00f2'],
    requiredTokens: ['beef', '\u0433\u043e\u0432\u044f\u0434', '\u044f\u043b\u043e\u0432\u0438\u0447', '\u725b\u8089', 'bo'],
    allowTags: ['beef', 'meat', 'main'],
    allowCategories: ['main', 'hot dishes', 'grill'],
    allowIngredients: ['beef', '\u0433\u043e\u0432\u044f\u0434\u0438\u043d\u0430', '\u044f\u043b\u043e\u0432\u0438\u0447\u0438\u043d\u0430', '\u725b\u8089', 'b\u00f2'],
  },
  veal: {
    strict: false,
    terms: ['veal', '\u0442\u0435\u043b\u044f\u0442\u0438\u043d\u0430', '\u0442\u0435\u043b\u044f\u0442\u0438\u043d\u0430', 'b\u00ea'],
    requiredTokens: ['veal', '\u0442\u0435\u043b\u044f\u0442', 'be'],
    allowTags: ['veal', 'meat', 'main'],
    allowCategories: ['main', 'hot dishes', 'grill'],
    allowIngredients: ['veal', '\u0442\u0435\u043b\u044f\u0442\u0438\u043d\u0430', '\u0442\u0435\u043b\u044f\u0442\u0438\u043d\u0430', 'b\u00ea'],
  },
  duck: {
    strict: false,
    terms: ['duck', '\u0443\u0442\u043a\u0430', '\u043a\u0430\u0447\u043a\u0430', '\u9e2d\u8089', 'v\u1ecbt'],
    requiredTokens: ['duck', '\u0443\u0442\u043a', '\u043a\u0430\u0447\u043a', '\u9e2d\u8089', 'vit'],
    allowTags: ['duck', 'meat', 'main'],
    allowCategories: ['main', 'hot dishes', 'grill'],
    allowIngredients: ['duck', '\u0443\u0442\u043a\u0430', '\u043a\u0430\u0447\u043a\u0430', '\u9e2d\u8089', 'v\u1ecbt'],
  },
  tequila: {
    strict: false,
    terms: [
      'tequila',
      '\u0442\u0435\u043a\u0438\u043b\u0430',
      '\u0442\u0435\u043a\u0456\u043b\u0430',
    ],
    requiredTokens: ['tequila', '\u0442\u0435\u043a\u0456\u043b', '\u0442\u0435\u043a\u0438\u043b'],
    allowTags: ['tequila', 'drink', 'alcohol'],
    allowCategories: ['tequila', 'drink', 'drinks', 'bar'],
    allowIngredients: ['tequila'],
  },
  burger: {
    strict: true,
    terms: ['burger', 'burgers', '\u0431\u0443\u0440\u0433\u0435\u0440', '\u0431\u0443\u0440\u0433\u0435\u0440\u0438'],
    requiredTokens: ['burger', '\u0431\u0443\u0440\u0433\u0435\u0440'],
    allowTags: ['burger', 'burgers'],
    allowCategories: ['burger', 'burgers'],
    allowIngredients: ['burger', 'beef patty', 'bun'],
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
  '\u043c\u043d\u0435',
  '\u0434\u0430\u0432\u0430\u0439',
  '\u044f \u0431\u0443\u0434\u0443',
  '\u043c\u043e\u0436\u043d\u0430',
  '\u0437\u0430\u043a\u0430\u0436',
  '\u0437\u0430\u043a\u0430\u0437\u0430\u0442\u044c',
  '\u0437\u0430\u043c\u043e\u0432',
  '\u0437\u0430\u043c\u043e\u0432\u043b\u044f\u044e',
  '\u0437\u0430\u043c\u043e\u0432\u0438\u0442\u0438',
  'please bring',
  'i want',
  "i'll take",
  'ill take',
  'i will take',
  'give me',
  'order me',
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

  const hint = String(localeHint || '').toLowerCase();
  const hint2 = /^[a-z]{2}/.test(hint) ? hint.slice(0, 2) : '';

  const hasLatin = /[a-z]/i.test(src);
  const hasCyr = /[\u0430-\u044f\u0451\u0456\u0457\u0454\u0491\u044b\u044d\u044a]/i.test(src);
  const hasUkMarkers = /[\u0456\u0457\u0454\u0491]/i.test(src);
  const hasRuMarkers = /[\u044b\u044d\u044a\u0451]/i.test(src);
  const hasHan = /\p{Script=Han}/u.test(src);
  const hasHiragana = /\p{Script=Hiragana}/u.test(src);
  const hasKatakana = /\p{Script=Katakana}/u.test(src);
  const hasHangul = /\p{Script=Hangul}/u.test(src);
  const hasArabic = /\p{Script=Arabic}/u.test(src);
  const hasHebrew = /\p{Script=Hebrew}/u.test(src);
  const hasDevanagari = /\p{Script=Devanagari}/u.test(src);
  const hasThai = /\p{Script=Thai}/u.test(src);
  const hasGreek = /\p{Script=Greek}/u.test(src);

  const scriptHits = [
    hasLatin,
    hasCyr,
    hasHan || hasHiragana || hasKatakana,
    hasHangul,
    hasArabic,
    hasHebrew,
    hasDevanagari,
    hasThai,
    hasGreek,
  ].filter(Boolean).length;

  if (scriptHits > 1) return 'mixed';
  if (hasLatin) return 'en';
  if (hasCyr) {
    if (hasUkMarkers && !hasRuMarkers) return 'uk';
    if (hasRuMarkers && !hasUkMarkers) return 'ru';
    return hint.startsWith('ru') ? 'ru' : 'uk';
  }
  if (hasHiragana || hasKatakana) return 'ja';
  if (hasHan) return hint2 || 'zh';
  if (hasHangul) return 'ko';
  if (hasArabic) return hint2 || 'ar';
  if (hasHebrew) return hint2 || 'he';
  if (hasDevanagari) return hint2 || 'hi';
  if (hasThai) return hint2 || 'th';
  if (hasGreek) return hint2 || 'el';

  if (hint2) return hint2;
  return 'unknown';
}

export function normalizeQueryText(text) {
  const normalized = String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replaceAll('\u0451', '\u0435')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC')
    .replace(/[’'`´]+/g, '')
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized;
}

function stemToken(token) {
  let t = String(token || '').toLowerCase();
  if (!t) return '';

  const cyrSuffixes = [
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
  ];
  const latinSuffixes = ['ingly', 'edly', 'ing', 'ed', 'es', 's'];
  const hasCyr = /[\u0400-\u04ff]/.test(t);
  const hasLatin = /[a-z]/.test(t);
  const suffixes = hasCyr ? cyrSuffixes : hasLatin ? latinSuffixes : [];

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
  const parts = normalizedText
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
    .map(stemToken);

  const out = new Set(parts.filter(Boolean));
  const compact = normalizedText.replace(/\s+/g, '');
  const hasCJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(compact);
  if (hasCJK && compact.length >= 2) {
    for (let i = 0; i < compact.length - 1; i += 1) {
      const bi = compact.slice(i, i + 2);
      if (bi.length === 2) out.add(bi);
    }
  }

  return Array.from(out);
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
