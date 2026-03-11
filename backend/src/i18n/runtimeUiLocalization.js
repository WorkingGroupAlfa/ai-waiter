import { translateText } from '../ai/translationService.js';

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

function patchDisplayNames({ replyText, orderDraft, upsell, recommendations, customCategories }) {
  if (orderDraft && Array.isArray(orderDraft.items)) {
    orderDraft.items = orderDraft.items.map((it) => ({
      ...it,
      display_name: shouldProtectItemName(it)
        ? getItemName(it)
        : asText(it.display_name || it.name || it.code),
    }));
  }
  if (upsell && Array.isArray(upsell.items)) {
    upsell.items = upsell.items.map((it) => ({
      ...it,
      display_name: shouldProtectItemName(it)
        ? getItemName(it)
        : asText(it.display_name || it.name || it.code),
    }));
  }
  if (Array.isArray(recommendations)) {
    recommendations = recommendations.map((it) => ({
      ...it,
      display_name: shouldProtectItemName(it)
        ? getItemName(it)
        : asText(it.display_name || it.name || it.code || it.item_code),
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
  const protectedTerms = collectProtectedTerms(localized);

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
  (localized.orderDraft?.items || []).forEach((it, i) => {
    if (!shouldProtectItemName(it)) add('order_item', i, it?.name);
  });
  (localized.upsell?.items || []).forEach((it, i) => {
    if (!shouldProtectItemName(it)) add('upsell_item', i, it?.name);
  });
  (Array.isArray(localized.recommendations) ? localized.recommendations : []).forEach((it, i) =>
    !shouldProtectItemName(it) ? add('recommendation_item', i, it?.name) : null
  );
  localized.customCategories.forEach((name, i) => add('custom_category', i, name));

  if (entries.length === 0) {
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
      } else if (entry.kind === 'order_item' && localized.orderDraft?.items?.[entry.index]) {
        const it = localized.orderDraft.items[entry.index];
        it.raw_name = getItemName(it);
        it.name = translated;
        it.display_name = translated;
      } else if (entry.kind === 'upsell_item' && localized.upsell?.items?.[entry.index]) {
        const it = localized.upsell.items[entry.index];
        it.raw_name = getItemName(it);
        it.name = translated;
        it.display_name = translated;
      } else if (
        entry.kind === 'recommendation_item' &&
        Array.isArray(localized.recommendations) &&
        localized.recommendations[entry.index]
      ) {
        const it = localized.recommendations[entry.index];
        it.raw_name = getItemName(it);
        it.name = translated;
        it.display_name = translated;
      } else if (entry.kind === 'custom_category' && localized.customCategories[entry.index] != null) {
        localized.customCategories[entry.index] = translated;
      }
    });

    // Keep protected menu names in original form.
    (localized.orderDraft?.items || []).forEach((it) => {
      if (!shouldProtectItemName(it)) return;
      const raw = getItemName(it);
      it.raw_name = raw;
      it.name = raw;
      it.display_name = raw;
    });
    (localized.upsell?.items || []).forEach((it) => {
      if (!shouldProtectItemName(it)) return;
      const raw = getItemName(it);
      it.raw_name = raw;
      it.name = raw;
      it.display_name = raw;
    });
    (Array.isArray(localized.recommendations) ? localized.recommendations : []).forEach((it) => {
      if (!shouldProtectItemName(it)) return;
      const raw = getItemName(it);
      it.raw_name = raw;
      it.name = raw;
      it.display_name = raw;
    });
  } catch (err) {
    console.error('[runtimeUiLocalization] batch localization failed', err);
  }

  return patchDisplayNames(localized);
}

