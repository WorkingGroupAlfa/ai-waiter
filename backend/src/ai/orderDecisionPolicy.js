// src/ai/orderDecisionPolicy.js
// Safety policy for deciding when AI can mutate cart vs suggest/clarify.

export const DEFAULT_AUTO_ADD_CONFIDENCE = Number(
  process.env.AI_AUTO_ADD_CONFIDENCE_THRESHOLD || 0.65
);
export const DEFAULT_VERY_HIGH_EXACT_CONFIDENCE = Number(
  process.env.AI_AUTO_ADD_EXACT_THRESHOLD || 0.65
);

const EXPLICIT_ORDER_PATTERNS = [
  /\b(add|order|i'll take|i will take|give me|bring me|can i get|can i have|i want)\b/i,
  /(^|\s)(хочу|мне|давай|я буду|закаж|заказать|замов|додай|додати|принеси)(\s|$)/i,
];

const EXACT_MATCH_SOURCES = new Set([
  'name_exact',
  'name_fuzzy',
  'name_fuzzy_drink',
  'ai_synonyms_db',
  'deterministic_scoring',
  'deterministic_exact',
  'item_code_exact',
  'alias_exact',
]);

function isExplicitOrderAction(text) {
  const src = String(text || '').trim();
  if (!src) return false;
  return EXPLICIT_ORDER_PATTERNS.some((re) => re.test(src));
}

export function decideOrderMutationPolicy({
  resolvedIntent,
  text,
  nluItems = [],
  clarificationNeeded = false,
  queryUnderstanding = null,
  threshold = DEFAULT_AUTO_ADD_CONFIDENCE,
  exactThreshold = DEFAULT_VERY_HIGH_EXACT_CONFIDENCE,
}) {
  const intent = String(resolvedIntent || '').toLowerCase();
  if (intent !== 'order' && intent !== 'add_to_order') {
    return {
      mode: 'suggest_list',
      reason: 'non_order_intent',
      explicitOrderAction: false,
      eligibleItems: [],
      exactItemIds: [],
    };
  }

  const explicitOrderAction = isExplicitOrderAction(text);
  const concepts = Array.isArray(queryUnderstanding?.concepts)
    ? queryUnderstanding.concepts
    : [];
  const pool = Array.isArray(nluItems) ? nluItems : [];

  const eligibleItems = pool.filter((item) => {
    const conf = Number(item?.matchConfidence || 0);
    return item?.menu_item_id && Number.isFinite(conf) && conf >= threshold;
  });

  const exactCandidates = pool.filter((item) => {
    const conf = Number(item?.matchConfidence || 0);
    const src = String(item?.matchSource || '').trim().toLowerCase();
    const exactBySource = EXACT_MATCH_SOURCES.has(src);
    const exactByFlag = Boolean(item?.isExactMatch);
    return (
      item?.menu_item_id &&
      Number.isFinite(conf) &&
      conf >= exactThreshold &&
      (exactBySource || exactByFlag)
    );
  });

  if (exactCandidates.length === 1) {
    return {
      mode: 'add_exact',
      reason: explicitOrderAction ? 'exact_match_fast_path' : 'exact_match_direct_mention',
      explicitOrderAction,
      eligibleItems,
      exactItemIds: [exactCandidates[0].menu_item_id],
    };
  }

  if (!explicitOrderAction) {
    return {
      mode: 'suggest_list',
      reason: 'not_explicit_order_action',
      explicitOrderAction,
      eligibleItems,
      exactItemIds: [],
    };
  }

  if (clarificationNeeded) {
    return {
      mode: 'suggest_list',
      reason: 'clarification_needed',
      explicitOrderAction,
      eligibleItems,
      exactItemIds: [],
    };
  }

  if (concepts.length > 0 || eligibleItems.length > 1) {
    return {
      mode: 'suggest_list',
      reason: concepts.length > 0 ? 'category_or_preference_query' : 'multiple_candidates',
      explicitOrderAction,
      eligibleItems,
      exactItemIds: [],
    };
  }

  return {
    mode: concepts.length > 0 ? 'suggest_list' : 'ask_clarify',
    reason: concepts.length > 0 ? 'category_or_oov_query' : 'no_high_confidence_items',
    explicitOrderAction,
    eligibleItems,
    exactItemIds: [],
  };
}
