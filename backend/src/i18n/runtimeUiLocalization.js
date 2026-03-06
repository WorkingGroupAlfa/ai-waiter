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

const translationCache = new Map();

async function translateTextRuntime(text, lang) {
  const original = asText(text);
  if (!original) return '';

  const cacheKey = `${lang}::${original}`;
  if (translationCache.has(cacheKey)) return translationCache.get(cacheKey);

  let translated = original;
  try {
    translated = asText(await translateText(original, lang, null)) || original;
  } catch (err) {
    console.error('[runtimeUiLocalization] translateTextRuntime failed', err);
    translated = original;
  }

  translationCache.set(cacheKey, translated);
  return translated;
}

function patchDisplayNames({ orderDraft, upsell, recommendations, customCategories }) {
  if (orderDraft && Array.isArray(orderDraft.items)) {
    orderDraft.items = orderDraft.items.map((it) => ({
      ...it,
      display_name: asText(it.display_name || it.name || it.code),
    }));
  }
  if (upsell && Array.isArray(upsell.items)) {
    upsell.items = upsell.items.map((it) => ({
      ...it,
      display_name: asText(it.display_name || it.name || it.code),
    }));
  }
  if (Array.isArray(recommendations)) {
    recommendations = recommendations.map((it) => ({
      ...it,
      display_name: asText(it.display_name || it.name || it.code || it.item_code),
    }));
  }
  return { orderDraft, upsell, recommendations, customCategories };
}

export async function localizeUiPayloadBatch({
  targetLanguage,
  replyText,
  orderDraft = null,
  upsell = null,
  recommendations = null,
  customCategories = [],
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

  const entries = [];
  const add = (kind, index, text) => {
    const value = asText(text);
    if (!value) return;
    entries.push({ kind, index, text: value });
  };

  add('reply', -1, localized.replyText);
  (localized.orderDraft?.items || []).forEach((it, i) => add('order_item', i, it?.name));
  (localized.upsell?.items || []).forEach((it, i) => add('upsell_item', i, it?.name));
  (Array.isArray(localized.recommendations) ? localized.recommendations : []).forEach((it, i) =>
    add('recommendation_item', i, it?.name)
  );
  localized.customCategories.forEach((name, i) => add('custom_category', i, name));

  if (entries.length === 0) {
    return patchDisplayNames(localized);
  }

  try {
    const uniqueTexts = Array.from(new Set(entries.map((e) => e.text)));
    const translatedPairs = await Promise.all(
      uniqueTexts.map(async (src) => [src, await translateTextRuntime(src, lang)])
    );
    const translatedByText = new Map(translatedPairs);

    entries.forEach((entry) => {
      const translated = asText(translatedByText.get(entry.text)) || entry.text;

      if (entry.kind === 'reply') {
        localized.replyText = translated;
      } else if (entry.kind === 'order_item' && localized.orderDraft?.items?.[entry.index]) {
        const it = localized.orderDraft.items[entry.index];
        it.raw_name = asText(it.name || it.code);
        it.name = translated;
        it.display_name = translated;
      } else if (entry.kind === 'upsell_item' && localized.upsell?.items?.[entry.index]) {
        const it = localized.upsell.items[entry.index];
        it.raw_name = asText(it.name || it.code);
        it.name = translated;
        it.display_name = translated;
      } else if (
        entry.kind === 'recommendation_item' &&
        Array.isArray(localized.recommendations) &&
        localized.recommendations[entry.index]
      ) {
        const it = localized.recommendations[entry.index];
        it.raw_name = asText(it.name || it.code || it.item_code);
        it.name = translated;
        it.display_name = translated;
      } else if (entry.kind === 'custom_category' && localized.customCategories[entry.index] != null) {
        localized.customCategories[entry.index] = translated;
      }
    });
  } catch (err) {
    console.error('[runtimeUiLocalization] batch localization failed', err);
  }

  return patchDisplayNames(localized);
}
