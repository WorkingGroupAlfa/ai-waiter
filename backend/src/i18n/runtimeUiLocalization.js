import { translateFromEnglish, translateToEnglish } from '../ai/translationService.js';

function normalizeLang(lang) {
  const raw = String(lang || 'en').trim().toLowerCase();
  const base = raw.split('-')[0];
  if (base === 'ua') return 'uk';
  return base || 'en';
}

function asText(v) {
  return String(v ?? '').trim();
}

function buildBatch(entries) {
  return entries
    .map((e, idx) => `[[[K${idx}]]]\n${e.text}`)
    .join('\n');
}

function parseBatch(batchText, count) {
  const result = new Map();
  const raw = String(batchText || '');
  const re = /\[\[\[K(\d+)\]\]\]\s*\n?([\s\S]*?)(?=(?:\n\[\[\[K\d+\]\]\])|$)/g;
  let m;
  while ((m = re.exec(raw)) !== null) {
    const idx = Number(m[1]);
    if (!Number.isInteger(idx)) continue;
    result.set(idx, asText(m[2]));
  }
  for (let i = 0; i < count; i += 1) {
    if (!result.has(i)) result.set(i, '');
  }
  return result;
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
    const sourceBatch = buildBatch(entries);
    const enBatch = await translateToEnglish(sourceBatch, null);
    const englishBatch = enBatch || sourceBatch;
    const targetBatch =
      lang === 'en'
        ? englishBatch
        : await translateFromEnglish(englishBatch, lang);
    const parsed = parseBatch(targetBatch, entries.length);

    entries.forEach((entry, idx) => {
      const translated = asText(parsed.get(idx)) || entry.text;

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
