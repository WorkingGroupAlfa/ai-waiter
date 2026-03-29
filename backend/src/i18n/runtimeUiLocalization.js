import { translateMenuItemName, translateText } from '../ai/translationService.js';

function normalizeLang(lang) {
  const raw = String(lang || 'en').trim().toLowerCase();
  const base = raw.split('-')[0];
  if (base === 'ua') return 'uk';
  return base || 'en';
}

function asText(v) {
  return String(v ?? '').trim();
}

function shouldProtectItemName(item) {
  if (!item || typeof item !== 'object') return false;
  return item.protect_name_from_translation === true || item.protectNameFromTranslation === true;
}

function shouldForceUkrainianDisplayName(lang) {
  return lang === 'ru' || lang === 'uk';
}

function getItemName(item) {
  return asText(item?.raw_name || item?.name || item?.display_name || item?.code || item?.item_code);
}

function normalizeProtectedTerms(terms = []) {
  return Array.from(
    new Set((terms || []).map((term) => asText(term)).filter(Boolean))
  ).sort((a, b) => b.length - a.length);
}

function collectProtectedTerms({ orderDraft, upsell, recommendations }) {
  const terms = [];
  const addIfProtected = (item) => {
    if (!shouldProtectItemName(item)) return;
    const name = getItemName(item);
    if (name) terms.push(name);
  };

  (orderDraft?.items || []).forEach(addIfProtected);
  (upsell?.items || []).forEach(addIfProtected);
  (Array.isArray(recommendations) ? recommendations : []).forEach(addIfProtected);

  return normalizeProtectedTerms(terms);
}

function maskProtectedTerms(text, protectedTerms = []) {
  const original = asText(text);
  const terms = normalizeProtectedTerms(protectedTerms);
  if (!original || terms.length === 0) {
    return { text: original, replacements: [] };
  }

  let masked = original;
  const replacements = [];

  terms.forEach((term, index) => {
    if (!masked.includes(term)) return;
    const token = `__AI_WAITER_PROPER_NAME_${index}__`;
    masked = masked.split(term).join(token);
    replacements.push({ token, term });
  });

  return { text: masked, replacements };
}

function unmaskProtectedTerms(text, replacements = []) {
  let restored = asText(text);
  replacements.forEach(({ token, term }) => {
    restored = restored.split(token).join(term);
  });
  return restored;
}

const translationCache = new Map();
const menuNameTranslationCache = new Map();

async function translateTextRuntime(text, lang, protectedTerms = [], translateTextFn = translateText) {
  const original = asText(text);
  if (!original) return '';

  const normalizedTerms = normalizeProtectedTerms(protectedTerms);
  const cacheKey = `${lang}::${normalizedTerms.join('\u0001')}::${original}`;
  if (translationCache.has(cacheKey)) return translationCache.get(cacheKey);

  let translated = original;
  try {
    const masked = maskProtectedTerms(original, normalizedTerms);
    translated = asText(await translateTextFn(masked.text, lang, null)) || original;
    translated = unmaskProtectedTerms(translated, masked.replacements) || original;
  } catch (err) {
    console.error('[runtimeUiLocalization] translateTextRuntime failed', err);
    translated = original;
  }

  translationCache.set(cacheKey, translated);
  return translated;
}

async function translateMenuItemNameRuntime(
  text,
  lang,
  translateMenuItemNameFn = translateMenuItemName
) {
  const original = asText(text);
  if (!original) return '';

  const cacheKey = `${lang}::menu-name::${original}`;
  if (menuNameTranslationCache.has(cacheKey)) return menuNameTranslationCache.get(cacheKey);

  let translated = original;
  try {
    translated = asText(await translateMenuItemNameFn(original, lang, null)) || original;
  } catch (err) {
    console.error('[runtimeUiLocalization] translateMenuItemNameRuntime failed', err);
    translated = original;
  }

  menuNameTranslationCache.set(cacheKey, translated);
  return translated;
}

function collectMenuItemRefs({ orderDraft, upsell, recommendations }) {
  const refs = [];
  const pushRefs = (kind, items = []) => {
    items.forEach((item, index) => {
      if (!item || typeof item !== 'object') return;
      const rawName = getItemName(item);
      if (!rawName) return;
      refs.push({ kind, index, item, rawName });
    });
  };

  pushRefs('order_item', orderDraft?.items || []);
  pushRefs('upsell_item', upsell?.items || []);
  pushRefs('recommendation_item', Array.isArray(recommendations) ? recommendations : []);

  return refs;
}

function replaceMenuNamesInText(text, replacements = []) {
  let out = asText(text);
  replacements.forEach(({ original, localized }) => {
    if (!original || !localized || original === localized || !out.includes(original)) return;
    out = out.split(original).join(localized);
  });
  return out;
}

function patchDisplayNames({ replyText, orderDraft, upsell, recommendations, customCategories }) {
  if (orderDraft && Array.isArray(orderDraft.items)) {
    orderDraft.items = orderDraft.items.map((it) => ({
      ...it,
      display_name: asText(it.display_name || it.name || it.raw_name || it.code),
    }));
  }
  if (upsell && Array.isArray(upsell.items)) {
    upsell.items = upsell.items.map((it) => ({
      ...it,
      display_name: asText(it.display_name || it.name || it.raw_name || it.code),
    }));
  }
  if (Array.isArray(recommendations)) {
    recommendations = recommendations.map((it) => ({
      ...it,
      display_name: asText(it.display_name || it.name || it.raw_name || it.code || it.item_code),
    }));
  }
  return { replyText, orderDraft, upsell, recommendations, customCategories };
}

export async function localizeUiPayloadBatch({
  targetLanguage,
  replyText,
  orderDraft = null,
  upsell = null,
  recommendations = null,
  customCategories = [],
  translateTextFn = translateText,
  translateMenuItemNameFn = translateMenuItemName,
} = {}) {
  const lang = normalizeLang(targetLanguage);
  const localized = {
    replyText: asText(replyText),
    orderDraft: orderDraft
      ? { ...orderDraft, items: Array.isArray(orderDraft.items) ? [...orderDraft.items] : [] }
      : null,
    upsell: upsell
      ? { ...upsell, items: Array.isArray(upsell.items) ? [...upsell.items] : [] }
      : null,
    recommendations: Array.isArray(recommendations) ? [...recommendations] : recommendations,
    customCategories: Array.isArray(customCategories) ? [...customCategories] : [],
  };
  const menuItemRefs = collectMenuItemRefs(localized);
  const menuNamePairs = await Promise.all(
    menuItemRefs.map(async (ref) => {
      const protectedName = shouldProtectItemName(ref.item);
      const forceUa = shouldForceUkrainianDisplayName(lang) && !protectedName;
      const ukrainianName = asText(ref.item?.name_ua || ref.item?.nameUa || '');

      const localizedName = protectedName
        ? ref.rawName
        : forceUa
          ? ukrainianName || ref.rawName
          : await translateMenuItemNameRuntime(ref.rawName, lang, translateMenuItemNameFn);
      return {
        ...ref,
        localizedName: asText(localizedName) || ref.rawName,
      };
    })
  );
  const protectedTerms = normalizeProtectedTerms([
    ...collectProtectedTerms(localized),
    ...menuNamePairs.map((pair) => pair.rawName),
  ]);
  const menuNameReplacements = normalizeProtectedTerms(menuNamePairs.map((pair) => pair.rawName)).map(
    (original) => {
      const pair = menuNamePairs.find((entry) => entry.rawName === original);
      return {
        original,
        localized: pair?.localizedName || original,
      };
    }
  );

  const entries = [];
  const add = (kind, index, text, terms = []) => {
    const value = asText(text);
    if (!value) return;
    entries.push({
      kind,
      index,
      text: value,
      protectedTerms: normalizeProtectedTerms(terms),
    });
  };

  add('reply', -1, localized.replyText, protectedTerms);
  add('upsell_text', -1, localized.upsell?.text, protectedTerms);
  localized.customCategories.forEach((name, i) => add('custom_category', i, name));

  menuNamePairs.forEach((entry) => {
    if (entry.kind === 'order_item' && localized.orderDraft?.items?.[entry.index]) {
      const it = localized.orderDraft.items[entry.index];
      it.raw_name = entry.rawName;
      it.name = entry.localizedName;
      it.display_name = entry.localizedName;
    } else if (entry.kind === 'upsell_item' && localized.upsell?.items?.[entry.index]) {
      const it = localized.upsell.items[entry.index];
      it.raw_name = entry.rawName;
      it.name = entry.localizedName;
      it.display_name = entry.localizedName;
    } else if (
      entry.kind === 'recommendation_item' &&
      Array.isArray(localized.recommendations) &&
      localized.recommendations[entry.index]
    ) {
      const it = localized.recommendations[entry.index];
      it.raw_name = entry.rawName;
      it.name = entry.localizedName;
      it.display_name = entry.localizedName;
    }
  });

  if (entries.length === 0) {
    localized.replyText = replaceMenuNamesInText(localized.replyText, menuNameReplacements);
    if (localized.upsell) {
      localized.upsell.text = replaceMenuNamesInText(localized.upsell.text, menuNameReplacements);
    }
    return patchDisplayNames(localized);
  }

  try {
    const uniqueEntries = Array.from(
      new Map(
        entries.map((entry) => [
          `${entry.text}::${entry.protectedTerms.join('\u0001')}`,
          entry,
        ])
      ).values()
    );
    const translatedPairs = await Promise.all(
      uniqueEntries.map(async (entry) => [
        `${entry.text}::${entry.protectedTerms.join('\u0001')}`,
        await translateTextRuntime(entry.text, lang, entry.protectedTerms, translateTextFn),
      ])
    );
    const translatedByText = new Map(translatedPairs);

    entries.forEach((entry) => {
      const translated = asText(
        translatedByText.get(`${entry.text}::${entry.protectedTerms.join('\u0001')}`)
      ) || entry.text;

      if (entry.kind === 'reply') {
        localized.replyText = translated;
      } else if (entry.kind === 'upsell_text' && localized.upsell) {
        localized.upsell.text = translated;
      } else if (entry.kind === 'custom_category' && localized.customCategories[entry.index] != null) {
        localized.customCategories[entry.index] = translated;
      }
    });
  } catch (err) {
    console.error('[runtimeUiLocalization] batch localization failed', err);
  }

  localized.replyText = replaceMenuNamesInText(localized.replyText, menuNameReplacements);
  if (localized.upsell) {
    localized.upsell.text = replaceMenuNamesInText(localized.upsell.text, menuNameReplacements);
  }

  return patchDisplayNames(localized);
}

