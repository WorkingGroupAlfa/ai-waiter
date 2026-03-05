// src/ai/orderDecisionPolicy.js
// Safety policy for deciding when AI can mutate cart vs only suggest.

export const DEFAULT_AUTO_ADD_CONFIDENCE = Number(
  process.env.AI_AUTO_ADD_CONFIDENCE_THRESHOLD || 0.84
);

const EXPLICIT_ORDER_PATTERNS = [
  /\b(add|order|i'll take|i will take|give me|bring me|can i get|can i have)\b/i,
  /\b(додай|додати|замов|хочу замовити|закажи|заказать|принеси)\b/i,
];

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
}) {
  const intent = String(resolvedIntent || '').toLowerCase();
  if (intent !== 'order' && intent !== 'add_to_order') {
    return { mode: 'suggest', reason: 'non_order_intent', explicitOrderAction: false, eligibleItems: [] };
  }

  const explicitOrderAction = isExplicitOrderAction(text);
  const strictOrCategoryConcepts = Array.isArray(queryUnderstanding?.concepts)
    ? queryUnderstanding.concepts
    : [];

  const eligibleItems = (Array.isArray(nluItems) ? nluItems : []).filter((item) => {
    const conf = Number(item?.matchConfidence || 0);
    return item?.menu_item_id && Number.isFinite(conf) && conf >= threshold;
  });

  if (!explicitOrderAction) {
    return { mode: 'suggest', reason: 'not_explicit_order_action', explicitOrderAction, eligibleItems };
  }

  if (clarificationNeeded) {
    return { mode: 'suggest', reason: 'clarification_needed', explicitOrderAction, eligibleItems };
  }

  if (eligibleItems.length === 0) {
    return {
      mode: 'suggest',
      reason: strictOrCategoryConcepts.length > 0 ? 'category_or_oov_query' : 'no_high_confidence_items',
      explicitOrderAction,
      eligibleItems,
    };
  }

  return { mode: 'add', reason: 'high_confidence_and_explicit_order', explicitOrderAction, eligibleItems };
}

