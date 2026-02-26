// src/ai/recommendationService.js
// Фасад для recommendation/upsell логики (Upsell 2.0).
// Здесь живут высокоуровневые функции, которые использует Dialog Manager,
// а под капотом можно вызывать существующие service-/model-слои.

// --- imports из service-/model-слоя ---
import { getRelatedMenuItems as getRelatedMenuItemsService } from '../services/recoService.js';
import { checkAllergensForItems } from '../services/allergyService.js';
// Пока не используется, но оставляем на будущее (детализированные меню)
import { getActiveMenuItemsByCodes } from '../models/menuModel.js';
import { env } from '../config/env.js';

import { getRuleBasedUpsellCandidates, getCooccurUpsellCandidates } from '../services/upsellCandidateService.js';




// Тип candidate, который мы возвращаем наружу:
// {
//   type: 'ingredient_pairing' | 'behavioral' | 'ml_next_order' | 'upsell_v1',
//   itemCode: string | null,
//   itemName: string | null,
//   menuItemId?: string,
//   reason?: string,
//   restaurantId?: string,
//   reason_code?: string,
//   source?: string,
//   text?: string | null,
//   score?: number,
// }

// NEW: Unified features builder (safe, local to this module)
// Canonical flat features builder (Step 6). Single source of truth.
// NOTE: we also expose a legacy nested shape derived from it for backward compatibility.
function buildUpsellFeatures({ language, emotion, orderItems, timeCtx, weather, reason_code }) {
  const items = (orderItems ?? [])
    .map((x) => x?.item_code ?? x?.itemCode)
    .filter(Boolean);

  return {
    language: language ?? null,
    emotion: emotion ?? null,
    items,
    time_context: timeCtx ?? null,
    weather: weather ?? null,
    reason_code: reason_code || null,
  };
}

// Legacy nested features derived from canonical flat (for backward compatibility with logs/scripts)
function buildUpsellFeaturesLegacy({ session, deviceId, orderSnapshot, features }) {
  return {
    meta: { language: features?.language ?? null, emotion: features?.emotion ?? null },
    context: { time: features?.time_context ?? null, weather: features?.weather ?? null },
    ids: {
      restaurant_id: session?.restaurant_id ?? null,
      session_id: session?.id ?? null,
      device_id: deviceId ?? session?.device_id ?? null,
    },
    order: { snapshot: orderSnapshot ?? null },
    reason_code: features?.reason_code ?? null,
    items: Array.isArray(features?.items) ? features.items : null,
  };
}

// --- STEP 4: Safe NLG (intent + slots)
// IMPORTANT: reason_code/source/cooccur are for analytics only.
// User-facing text MUST be built via TrustTextBuilder using message_intent + message_slots.
function mapCandidateToMessage(candidate) {
  const type = (candidate?.type || '').toString().toLowerCase();

  // IMPORTANT: in this module we store structured metadata in `source_meta`
  // (because `source` is a legacy string in many places).
  const meta = candidate?.source_meta || candidate?.source_obj || candidate?.cooccur || candidate?.source || null;

  // Derive rule_type when available (DB rules)
  const ruleType = (meta?.rule_type || meta?.ruleType || '').toString().toLowerCase();

  // Default slots (safe minimal)
  const slots = {
    base_item_code: meta?.a_item_code || meta?.trigger_item_code || null,
    category_id: meta?.trigger_category_id || null,
    tag: meta?.trigger_tag || null,

    upsell_item_code: candidate?.itemCode ?? candidate?.item_code ?? null,
    upsell_item_name: candidate?.itemName ?? candidate?.item_name ?? null,
  };

  // Mapping required by spec
  if (type === 'cooccur') {
    return { message_intent: 'popular_pairing', message_slots: slots };
  }

  if (type === 'rule') {
    // manual rules -> pairing_suggestion; category rules -> category_pairing
    if (ruleType === 'category_to_item') {
      return { message_intent: 'category_pairing', message_slots: slots };
    }
    return { message_intent: 'pairing_suggestion', message_slots: slots };
  }

  // Sensible defaults
  if (type === 'ingredient_pairing') {
    return { message_intent: 'pairing_suggestion', message_slots: slots };
  }

  if (type === 'behavioral') {
    return { message_intent: 'usual_pick', message_slots: slots };
  }

  if (type === 'upsell_v1') {
    return { message_intent: 'pairing_suggestion', message_slots: slots };
  }

  return { message_intent: 'pairing_suggestion', message_slots: slots };
}



function normalizeAllergies(allergies) {
  if (!Array.isArray(allergies)) return [];
  return allergies
    .map((a) => (a ? String(a).toLowerCase().trim() : null))
    .filter(Boolean);
}

function getOrderedCodes(order) {
  return new Set(
    (order?.items || [])
      .map((it) => it.item_code || it.itemCode)
      .filter((c) => typeof c === 'string' && c.length > 0)
  );
}

export async function getIngredientBasedUpsell(orderItems, menuContext = {}) {
  const { restaurantId } = menuContext;
  if (!restaurantId || !Array.isArray(orderItems) || orderItems.length === 0) {
    return [];
  }

  const baseCodes = Array.from(
    new Set(
      orderItems
        .map((it) => it.item_code)
        .filter((c) => typeof c === 'string' && c.length > 0)
    )
  );

  if (baseCodes.length === 0) {
    return [];
  }

  const related = await getRelatedMenuItemsService(restaurantId, baseCodes, 3);
  if (!Array.isArray(related) || related.length === 0) {
    return [];
  }

  return related.map((row) => ({
    type: 'ingredient_pairing',
    itemCode: row.item_code,
    itemName: row.name_en || row.name_ua || row.item_code,
    menuItemId: row.id,
    restaurantId,
    reason: 'ingredient_based_pairing',
  }));
}

export async function getBehavioralUpsell(deviceMemory, currentOrder) {
  if (!deviceMemory || !currentOrder) return [];

  const restaurantId = currentOrder.restaurant_id;
  if (!restaurantId) return [];

  const favorites = Array.isArray(deviceMemory.favoriteItems)
    ? deviceMemory.favoriteItems
    : [];
  if (favorites.length === 0) return [];

  const disliked = new Set(
    Array.isArray(deviceMemory.dislikedItems)
      ? deviceMemory.dislikedItems.map(String)
      : []
  );

  const currentCodes = new Set(
    (currentOrder.items || [])
      .map((it) => it.item_code)
      .filter((c) => typeof c === 'string' && c.length > 0)
  );

  const candidates = [];

  for (const favId of favorites) {
    if (!favId) continue;
    const favIdStr = String(favId);
    if (disliked.has(favIdStr)) continue;

    candidates.push({
      type: 'behavioral',
      itemCode: null,
      itemName: null,
      menuItemId: favIdStr,
      restaurantId,
      reason: 'favorite_item_for_device',
    });
  }

  return candidates.filter(
    (c) => !c.itemCode || !currentCodes.has(c.itemCode)
  );
}

export async function filterDietSafe(upsellCandidates, allergies) {
  if (!Array.isArray(upsellCandidates) || upsellCandidates.length === 0) {
    return [];
  }

  const normalizedAllergies = normalizeAllergies(allergies);
  if (normalizedAllergies.length === 0) {
    return upsellCandidates;
  }

  const restaurantId = upsellCandidates[0].restaurantId;
  if (!restaurantId) {
    return upsellCandidates;
  }

  const itemCodes = upsellCandidates
    .map((c) => c.itemCode)
    .filter((c) => typeof c === 'string' && c.length > 0);

  if (itemCodes.length === 0) {
    return upsellCandidates;
  }

  const check = await checkAllergensForItems(
    restaurantId,
    itemCodes,
    normalizedAllergies
  );

  const unsafeCodes = new Set(
    (check || [])
      .filter((row) => row && row.item_code && row.is_safe === false)
      .map((row) => row.item_code)
  );

  if (unsafeCodes.size === 0) {
    return upsellCandidates;
  }

  return upsellCandidates.filter(
    (c) => !c.itemCode || !unsafeCodes.has(c.itemCode)
  );
}

export async function getMLNextOrderSuggestions(deviceId, context = {}) {
  void deviceId;
  void context;
  return [];
}

// --- Backward-compatibility re-exports ---

export const getRelatedMenuItems = getRelatedMenuItemsService;

export async function getChatUpsellSuggestion({
  order,
  session,
  deviceId,
  deviceMemory,
  allergies = [],
  // ✅ поддерживаем оба имени: новый limitTopN и старый limit
  limitTopN = null,
  limit = 5,
  context = {},
}) {
  const effectiveLimit =
    Number.isFinite(Number(limitTopN)) && Number(limitTopN) > 0
      ? Number(limitTopN)
      : (Number.isFinite(Number(limit)) && Number(limit) > 0 ? Number(limit) : 5);
  if (!order || !session?.restaurant_id) return null;

  const orderedCodes = getOrderedCodes(order);

  // --- 1) Candidate generation (same sources as before) ---
  // --- 1) Candidate generation ---
  const candidates = [];

  // A) DB rules (MAIN source)
  const ruleCandidates = await getRuleBasedUpsellCandidates({
    order,
    session,
    channel: context?.channel || 'chat',
    now: new Date(),
  });

  const cooccurCandidates = await getCooccurUpsellCandidates({
  order,
  session,
  topMPerA: 3, // M на каждый item в заказе
});


  for (const rc of ruleCandidates) {
  const cand = {
    type: 'rule',
    itemCode: rc.itemCode,
    itemName: null,
    text: null,

    // legacy analytics string (ok)
    source: `upsell_rule:${rc.source?.id}`,

    // NEW: structured meta for safe NLG (do NOT stringify it)
    source_meta: {
      type: 'upsell_rule',
      id: rc.source?.id ?? null,
      rule_type: rc.source?.rule_type ?? null,
      trigger_item_code: rc.source?.trigger_item_code ?? null,
      trigger_category_id: rc.source?.trigger_category_id ?? null,
      trigger_tag: rc.source?.trigger_tag ?? null,
    },

    reason_code: rc.reason_code || 'rule_based',
    base_weight: rc.base_weight ?? 0.6,
    priority: rc.priority ?? 0,
    rule_id: rc.source?.id ?? null,
  };

  const msg = mapCandidateToMessage(cand);
  cand.message_intent = msg.message_intent;
  cand.message_slots = msg.message_slots;

  candidates.push(cand);
}


  for (const cc of cooccurCandidates) {
  const cand = {
    type: 'cooccur',
    itemCode: cc.itemCode,
    itemName: null,
    text: null,

    // legacy analytics string
    source: `cooccur:${cc.source?.a_item_code || ''}->${cc.source?.b_item_code || cc.itemCode}`,

    // structured meta for safe NLG
    source_meta: {
      type: 'cooccur',
      a_item_code: cc.source?.a_item_code ?? null,
      b_item_code: cc.source?.b_item_code ?? null,
      support: cc.source?.support ?? null,
      confidence: cc.source?.confidence ?? null,
      lift: cc.source?.lift ?? null,
    },

    reason_code: cc.reason_code || 'cooccur',
    base_weight: cc.base_weight ?? 0.5,
    priority: cc.priority ?? 0,

    // keep old field if something reads it
    cooccur: cc.source || null,
  };

  const msg = mapCandidateToMessage(cand);
  cand.message_intent = msg.message_intent;
  cand.message_slots = msg.message_slots;

  candidates.push(cand);
}


  // C) Ingredient-based related items (keep as extra source)




  // B) Ingredient-based related items
  const related = await getIngredientBasedUpsell(order.items || [], {
    restaurantId: session.restaurant_id,
  });

  const safe = await filterDietSafe(related, allergies || []);
  for (const c of safe) {
    if (c?.itemCode && orderedCodes.has(c.itemCode)) continue;
    const cand = {
  type: c.type,
  itemCode: c.itemCode,
  itemName: c.itemName || c.itemCode,
  text: null,
  source: c.reason || 'related_items',
  reason_code: c.reason || 'ingredient_based_pairing',

  // optional structured meta (not required, but keeps slots shape stable)
  source_meta: { type: 'ingredient_pairing' },
};

const msg = mapCandidateToMessage(cand);
cand.message_intent = msg.message_intent;
cand.message_slots = msg.message_slots;

candidates.push(cand);

  }

  // C) Behavioral (favorite items)
  const beh = await getBehavioralUpsell(deviceMemory, order);
  for (const c of beh) {
    if (!c) continue;
    const cand = {
  type: c.type,
  itemCode: c.itemCode,
  itemName: c.itemName,
  menuItemId: c.menuItemId,
  text: null,
  source: c.reason || 'favorite_item_for_device',
  reason_code: c.reason || 'favorite_item_for_device',
  source_meta: { type: 'behavioral' },
};

const msg = mapCandidateToMessage(cand);
cand.message_intent = msg.message_intent;
cand.message_slots = msg.message_slots;

candidates.push(cand);
  }

  if (!candidates.length) return null;

    // Enrich itemName for candidates that only have itemCode (e.g. DB rules)
  const needNames = candidates
    .filter(c => c && !c.itemName && c.itemCode)
    .map(c => c.itemCode);

  if (needNames.length) {
    const menuRows = await getActiveMenuItemsByCodes(session.restaurant_id, Array.from(new Set(needNames)));
    const byCode = new Map((menuRows || []).map(r => [r.item_code, r]));
    for (const c of candidates) {
      if (!c.itemName && c.itemCode && byCode.has(c.itemCode)) {
        const r = byCode.get(c.itemCode);
        c.itemName = r?.name_en || r?.name_ua || c.itemCode;
      }
    }
    // STEP 4: Keep message_slots in sync after enrichment (safe NLG)
for (const c of candidates) {
  if (c?.message_slots && (!c.message_slots.upsell_item_name || c.message_slots.upsell_item_name === c.itemCode) && c.itemName) {
    c.message_slots.upsell_item_name = c.itemName;
  }
}

  }


  // --- 2) Attach score (heuristic model as ML scoring 1.0) ---
  function clamp01(x) {
    const n = Number(x);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
  }

function scoreCandidate(c) {
  let s = 0.3;

  if (c.type === 'upsell_v1') s = 0.75;
  else if (c.type === 'ingredient_pairing') s = 0.6;
  else if (c.type === 'behavioral') s = 0.55;
  else if ((c.type === 'rule' || c.type === 'cooccur') && c.base_weight !== undefined && c.base_weight !== null) {
    const bw = Number(c.base_weight);
    if (Number.isFinite(bw)) s = clamp01(bw);

    // priority: mild boost
    const pr = Number(c.priority ?? 0);
    if (Number.isFinite(pr) && pr !== 0) {
      s = clamp01(s + Math.max(-0.2, Math.min(0.2, pr * 0.01)));
    }
  }

  // Light context adjustments
  const emotion = (context?.emotion || '').toString().toLowerCase();
  if (emotion === 'angry' || emotion === 'upset' || emotion === 'frustrated') {
    s -= 0.08;
  }

  const hour = context?.time_ctx?.hour;
  if (Number.isFinite(hour)) {
    if (hour >= 22 || hour <= 6) s -= 0.05;
  }

  return clamp01(s);
}


  const scored = candidates
    .map((c) => ({ ...c, score: scoreCandidate(c) }))
    .sort((a, b) => (b.score || 0) - (a.score || 0));

      if (process.env.DEBUG_UPSELL === '1') {
    console.log('[Upsell] candidates_scored', {
      restaurant_id: session.restaurant_id,
      ordered: Array.from(orderedCodes),
      epsilon: context?.epsilon ?? null,
      top_preview: scored.slice(0, 5).map(c => ({ type: c.type, code: c.itemCode ?? c.item_code, score: c.score, reason_code: c.reason_code, source: c.source }))
    });
  }

  // --- 3) ε-greedy pick (controlled exploration) ---
// --- 3) TOP-N (controlled exposure) + ε-greedy pick inside TOP ---
const topN = Math.max(1, Math.min(Number(effectiveLimit), scored.length));
const topList = scored.slice(0, topN);

const epsilon = clamp01(context?.epsilon ?? env.UPSELL_EPSILON ?? 0.1);
const doExplore = Math.random() < epsilon;

let picked;
if (doExplore && topList.length > 1) {
  // explore within TOP-N (excluding the #1)
  const poolList = topList.slice(1);
  picked = poolList[Math.floor(Math.random() * poolList.length)];
} else {
  picked = topList[0];
}


  if (!picked) return null;

  if (process.env.DEBUG_UPSELL === '1') {
    console.log('[Upsell] picked', {
      doExplore, epsilon,
      picked: { type: picked?.type, code: picked?.itemCode ?? picked?.item_code, score: picked?.score, reason_code: picked?.reason_code, source: picked?.source }
    });
  }

  // --- TOP-N + picked (structured) ---

const picked_struct = picked
  ? {
      type: picked.type ?? null,
      item_code: picked.itemCode ?? picked.item_code ?? null,
      item_name: picked.itemName ?? picked.itemCode ?? null,
      score: picked.score ?? null,
      reason_code: picked.reason_code ?? null,
      source: picked.source ?? null,

      // STEP 4 Safe NLG
      message_intent: picked.message_intent ?? null,
      message_slots: picked.message_slots ?? null,
    }
  : null;


  // --- ML meta (structured) ---
  const ml = {
    strategy: 'ml_bandit',
    model_version: 'heuristic_v1',
    epsilon,
    picked_by: doExplore ? 'explore' : 'exploit',
  };

  // --- unified features ---
// --- unified features (canonical flat) ---
const reasonCodeForFeatures = picked_struct?.reason_code ?? 'pairing_with_item';
const timeCtx = context?.time_ctx ?? context?.time_context ?? context?.timeCtx ?? null;

// order items for features: prefer snapshot if provided, else current order
const orderItemsForFeatures = context?.order_snapshot?.items ?? order?.items ?? [];

const features = buildUpsellFeatures({
  language: context?.language ?? null,
  emotion: context?.emotion ?? null,
  orderItems: orderItemsForFeatures,
  timeCtx,
  weather: context?.weather ?? null,
  reason_code: reasonCodeForFeatures,
});

// legacy nested (derived)
const features_v1 = buildUpsellFeaturesLegacy({
  session,
  deviceId,
  orderSnapshot: context?.order_snapshot ?? null,
  features,
});


  // --- canonical strategy (Step 6 “по красоте”) ---
  const strategy = {
    name: 'ml_bandit',
    epsilon,
    picked_by: doExplore ? 'explore' : 'exploit',
    model_version: 'heuristic_v1',
  };

  // --- canonical top (Step 6) ---
const top = topList.map((c) => ({
  type: c.type ?? null,
  item_code: c.itemCode ?? c.item_code ?? null,
  item_name: c.itemName ?? c.itemCode ?? null,
  score: c.score ?? null,
  reason_code: c.reason_code ?? null,
  source: c.source ?? null,

  // STEP 4 Safe NLG
  message_intent: c.message_intent ?? null,
  message_slots: c.message_slots ?? null,
}));


  // --- canonical picked (Step 6) ---
  const pickedPack = picked_struct
    ? { ...picked_struct, score: picked_struct.score ?? picked?.score ?? null }
    : null;

  // --- unified return (canonical + legacy for compatibility) ---
return {
  // ✅ Step 6 canonical contract
  picked: pickedPack,
  top,
  strategy,   // { name, epsilon, picked_by, model_version }
  features,   // canonical flat features

  // ✅ Compatibility: previous “single upsell” fields
  type: picked?.type ?? null,
  itemCode: picked?.itemCode ?? null,
  itemName: picked?.itemName ?? picked?.itemCode ?? null,
  text: picked?.text ?? null,
  source: picked?.source || picked?.reason_code || 'candidate',
  score: picked?.score ?? null,
  reason_code: pickedPack?.reason_code ?? 'pairing_with_item',

  // ✅ Compatibility: top candidates (old names)
  candidates_top: top,
  top_candidates: top,

  // ✅ Compatibility: ML meta (older consumers)
  ml,          // { strategy, model_version, epsilon, picked_by }
  features_v1, // nested legacy features derived from canonical features

  // Optional: flattened strategy fields WITHOUT clobbering canonical `strategy`
  strategy_name: strategy.name,
  model_version: strategy.model_version,
  epsilon: strategy.epsilon,
  picked_by: strategy.picked_by,
};



}
