// src/ai/dialogManager.js
// Р¤Р°СЃР°Рґ РЅР°Рґ РІСЃРµР№ Р»РѕРіРёРєРѕР№ РѕР±СЂР°Р±РѕС‚РєРё СЃРѕРѕР±С‰РµРЅРёР№:
// text -> NLU -> ContextResolver -> OrderMutation + upsell + allergy + СЌРјРѕС†РёРё.
import { respondInLanguage } from './nlgService.js';
import { getMenuItemsBasicByCodes, getMenuItemWithDetailsById } from '../models/menuModel.js';


import { getRestaurantSettings } from '../models/restaurantSettingsModel.js';
import { getWeatherForRestaurant } from '../services/weatherService.js';
import { fetchMenuItemsWithDetails, suggestMenuItems } from '../services/menuService.js';

import { build as buildUpsellTextEn } from './trustTextBuilder.js';

import { computeTimeContext, DEFAULT_DAYPARTS } from '../services/restaurantSettingsService.js';

import { loadPersona } from '../services/aiPersonaService.js';
import { insertPerformanceMetric } from '../models/performanceMetricsModel.js';

import { parseUserInput, parseUserMessage as legacyParseUserMessage } from './nluService.js';
import {
  buildQueryUnderstanding,
  getConceptConfig,
  normalizeQueryText,
  tokenizeNormalized,
} from './queryUnderstanding.js';
import { decideOrderMutationPolicy } from './orderDecisionPolicy.js';
import {
  dedupeByCode,
  buildOrderDraftForResponseSafe,
  buildOrderReplyTextSafe,
} from './dialogResponseUtils.js';
import { resolveReferences } from './contextResolver.js';
import {
  loadSessionMemory,
  loadDeviceMemory,
  getMediumTermContext,
  updateDeviceMemory,
} from './memoryService.js';
import {
  handleModifyOrderFromNLU,
  getOrCreateDraftOrderForSession,
  addDishItemsToOrder,
  recalcOrderTotal,
  getOrderWithItemsForChat,
} from '../services/orderChatService.js';

import { logEvent } from '../services/eventService.js';
import {
  getLastUpsellForSession,
  setLastUpsellForSession,
  clearLastUpsellForSession,
  getDialogState,
  upsertDialogState,
} from '../services/dialogStateService.js';
import { getChatUpsellSuggestion } from './recommendationService.js';
import {
  getDeviceProfile,
  getDeviceAllergies,
  updateDeviceAllergies,
} from '../services/deviceProfileService.js';
import { checkAllergensForItems } from '../services/allergyService.js';

import {
  addItemToOrder,
  updateItemQuantity,
  updateItemModifiers,
  removeItemFromOrder,
} from '../services/orderMutationService.js';
import {
  getCurrentActiveOrderForSession,
  submitOrderForSession,
} from '../services/orderService.js';
import { sendOrderToStaff } from '../services/telegramService.js';
import { getSessionByToken, touchSession } from '../services/sessionService.js';
import {
  findRequestedCustomCategory,
  getCustomCategoryRecommendations,
} from '../services/customCategoryService.js';
import { localizeUiPayloadBatch } from '../i18n/runtimeUiLocalization.js';

// --- UI bundle: how many upsell items to show (2-3 depending on order size) ---
function desiredUpsellUiCount(order = null) {
  const distinct = new Set(
    (order?.items || [])
      .map((it) => it?.item_code || it?.itemCode || it?.code)
      .filter(Boolean)
  );
    const n = distinct.size;

  // Heuristic:
  //  - small order (<=2 distinct items): show 1
  //  - medium (3-4): show 2
  //  - large (5+): show 3
  if (n >= 5) return 3;
  if (n >= 3) return 2;
  return 1;
}

// --- UI bundle: filter candidates for display without changing scoring/picking ---
function buildUiUpsellCandidates({ upsellPack, order, maxCount = 1 } = {}) {
  const ordered = new Set(
    (order?.items || []).map((it) => it?.item_code || it?.itemCode).filter(Boolean)
  );

  const allergyCandidates = upsellPack?.features_v1?.allergy?.candidates;
  const isSafe = (code) => {
    if (!code) return true;
    if (!Array.isArray(allergyCandidates)) return true;
    const row = allergyCandidates.find((r) => r?.item_code === code);
    return row ? row?.is_safe !== false : true;
  };
  const out = [];
  const pushIfOk = (c) => {
    const code = c?.item_code || c?.itemCode || c?.code;
    if (!code) return;
    if (ordered.has(code)) return;
    if (!isSafe(code)) return;
    if (out.some((x) => (x?.item_code || x?.itemCode || x?.code) === code)) return;
    out.push(c);
  };

  // 1) primary picked stays first (do not change bandit choice)
  pushIfOk(upsellPack?.picked || null);

  // 2) add next best from TOP list (already ranked) until maxCount
  const top = upsellPack?.top || upsellPack?.top_candidates || upsellPack?.candidates_top || [];
  if (Array.isArray(top)) {
    for (const c of top) {
      if (out.length >= maxCount) break;
      pushIfOk(c);
    }
  }

  return out.slice(0, Math.max(1, maxCount));
}

// --- Step 7: "ironclad" normalization for strategy fields (keep analytics stable) ---
// --- Step 7: "ironclad" normalization for strategy fields (keep analytics stable) ---
function normalizeMlMeta(mlLike = null) {
  // 1) If someone passed just "strategy name" as a string
  if (typeof mlLike === 'string' && mlLike.trim()) {
    return {
      strategy: mlLike.trim(),
      model_version: 'none',
      epsilon: null,
      picked_by: null,
    };
  }

  // 2) Support: { strategy: "ml_bandit" } AND { name: "ml_bandit" }
  //    AND nested: { strategy: { name: "ml_bandit", ... } }
  const strategyFromString =
    typeof mlLike?.strategy === 'string' && mlLike.strategy.trim()
      ? mlLike.strategy.trim()
      : null;

  const strategyFromName =
    typeof mlLike?.name === 'string' && mlLike.name.trim()
      ? mlLike.name.trim()
      : null;

  const strategyFromNested =
    typeof mlLike?.strategy?.name === 'string' && mlLike.strategy.name.trim()
      ? mlLike.strategy.name.trim()
      : null;

  const rawStrategy = strategyFromString || strategyFromName || strategyFromNested || null;

  // 3) model_version variants
  const model_version =
    (typeof mlLike?.model_version === 'string' && mlLike.model_version.trim()
      ? mlLike.model_version.trim()
      : null) ||
    (typeof mlLike?.modelVersion === 'string' && mlLike.modelVersion.trim()
      ? mlLike.modelVersion.trim()
      : null) ||
    (typeof mlLike?.strategy?.model_version === 'string' && mlLike.strategy.model_version.trim()
      ? mlLike.strategy.model_version.trim()
      : null) ||
    (typeof mlLike?.strategy?.modelVersion === 'string' && mlLike.strategy.modelVersion.trim()
      ? mlLike.strategy.modelVersion.trim()
      : null) ||
    null;

  // 4) epsilon
  const epsNum = Number(mlLike?.epsilon ?? mlLike?.strategy?.epsilon);
  const epsilon = Number.isFinite(epsNum) ? epsNum : null;

  // 5) picked_by variants
  const picked_by =
    (typeof mlLike?.picked_by === 'string' && mlLike.picked_by.trim()
      ? mlLike.picked_by.trim()
      : null) ||
    (typeof mlLike?.pickedBy === 'string' && mlLike.pickedBy.trim()
      ? mlLike.pickedBy.trim()
      : null) ||
    (typeof mlLike?.strategy?.picked_by === 'string' && mlLike.strategy.picked_by.trim()
      ? mlLike.strategy.picked_by.trim()
      : null) ||
    (typeof mlLike?.strategy?.pickedBy === 'string' && mlLike.strategy.pickedBy.trim()
      ? mlLike.strategy.pickedBy.trim()
      : null) ||
    null;

  return {
    strategy: rawStrategy || 'rule_based',
    model_version: model_version || 'none',
    epsilon,
    picked_by,
  };
}





async function runNLU({
  text,
  session,
  deviceProfile,
  order,
  sessionMemory,
  deviceMemory,
  mediumTermContext,
  clientLanguage = null,
}) {
  const normalizedText = (text || '').toString().trim();

  const baseResult = {
    intent: 'empty',
    items: [],
    meta: {
      emotion: 'neutral',
      language: 'unknown',
      clarificationNeeded: false,
    },
    language: 'unknown',
  };

  if (!normalizedText) {
    return baseResult;
  }

  // РћРїСЂРµРґРµР»СЏРµРј restaurantId: СЃРЅР°С‡Р°Р»Р° РёР· Р·Р°РєР°Р·Р°, РїРѕС‚РѕРј РёР· СЃРµСЃСЃРёРё
  const restaurantId = order?.restaurant_id || session?.restaurant_id || null;

  // --- РџС‹С‚Р°РµРјСЃСЏ РёСЃРїРѕР»СЊР·РѕРІР°С‚СЊ РќРћР’Р«Р™ NLU ---
  try {
    const nlu = await parseUserInput({
      text: normalizedText,
      // СЏР·С‹Рє РјРѕР¶РЅРѕ Р±СЂР°С‚СЊ РёР· РїСЂРѕС„РёР»СЏ, РµСЃР»Рё РѕРЅ РµСЃС‚СЊ
      locale: clientLanguage || deviceProfile?.preferred_locale || deviceProfile?.language || null,

      // РљР РРўРР§РќРћ: РїСЂРѕР±СЂР°СЃС‹РІР°РµРј restaurantId РІРѕ РІСЃРµС… РІРёРґР°С…,
      // С‡С‚РѕР±С‹ parseUserInput/semanticMatcher С‚РѕС‡РЅРѕ РµРіРѕ СѓРІРёРґРµР»Рё
      restaurantId,
      restaurant_id: restaurantId, // РЅР° СЃР»СѓС‡Р°Р№, РµСЃР»Рё РІРЅСѓС‚СЂРё Р¶РґСѓС‚ snake_case

      sessionContext: {
        restaurantId, // Рё СЃСЋРґР° С‚РѕР¶Рµ, РµСЃР»Рё Р»РѕРіРёРєР° СЃРјРѕС‚СЂРёС‚ РІ sessionContext
        session,
        deviceProfile,
        order,
        memory: {
          sessionMemory,
          deviceMemory,
          mediumTermContext,
        },
      },
    });

    if (process.env.DEBUG_NLU === '1') {
      console.log('[NLU:new]', {
       text: normalizedText,
        clientLanguage,
        restaurantId,
        intent: nlu?.intent,
        language: nlu?.language ?? nlu?.meta?.language,
        items_len: Array.isArray(nlu?.items) ? nlu.items.length : null,
      });
    }

    return {
      ...nlu,
  // вњ… РІСЃРµРіРґР° РЅРѕСЂРјР°Р»РёР·СѓРµРј РёР· РЅРѕРІРѕРіРѕ NLU
  emotion: nlu.emotion ?? nlu.meta?.emotion ?? 'neutral',
  language: nlu.language ?? nlu.meta?.language ?? 'unknown',
  clarificationNeeded:
    nlu.clarificationNeeded ?? nlu.meta?.clarificationNeeded ?? false,
    };
  } catch (err) {
    console.error('[DialogManager] New NLU failed, fallback to legacy:', err);
  }

  // --- Р¤РѕР»Р±РµРє: legacy NLU, РєР°Рє СЂР°Р±РѕС‚Р°Р»Рѕ РґРѕ СЌС‚РѕРіРѕ ---
    const legacy = await legacyParseUserMessage(normalizedText, {
    session,
    deviceProfile,
    order,
    memory: {
      sessionMemory,
      deviceMemory,
      mediumTermContext,
    },
  });

    if (process.env.DEBUG_NLU === '1') {
    console.log('[NLU:legacy]', {
      text: normalizedText,
      clientLanguage,
      restaurantId,
      intent: legacy?.intent,
      language: legacy?.language ?? legacy?.meta?.language,
      dishes_len: Array.isArray(legacy?.entities?.dishes) ? legacy.entities.dishes.length : null,
    });
  }

  const out = legacy || baseResult;

  // РќРѕСЂРјР°Р»РёР·СѓРµРј legacy в†’ РµРґРёРЅС‹Р№ РєРѕРЅС‚СЂР°РєС‚ (РєР°Рє Сѓ РЅРѕРІРѕРіРѕ NLU)
  const emotion = out?.emotion ?? out?.meta?.emotion ?? 'neutral';
  const language = out?.language ?? out?.meta?.language ?? 'unknown';
  const clarificationNeeded =
    out?.clarificationNeeded ?? out?.meta?.clarificationNeeded ?? false;

  return {
    ...out,
    emotion,
    language,
    clarificationNeeded,
    meta: {
      ...(out?.meta || {}),
      emotion,
      language,
      clarificationNeeded,
    },
  };
}


/**
 * РџСЂР°РІРёР»Р° РІС‹Р±РѕСЂР° СЏР·С‹РєР° РѕС‚РІРµС‚Р°:
 * 1) СЏР·С‹Рє РїРѕ С‚РµРєСЃС‚Сѓ (NLU meta.language / nlu.language)
 * 2) СЏР·С‹Рє РёР· РґРѕР»РіРѕСЃСЂРѕС‡РЅРѕР№ РїР°РјСЏС‚Рё СѓСЃС‚СЂРѕР№СЃС‚РІР° (deviceMemory.languagePreferences.primary)
 * 3) clientLanguage (UI hint) вЂ” С‚РѕР»СЊРєРѕ РєР°Рє РїРѕСЃР»РµРґРЅРёР№ fallback
 * 4) 'en'
 */
function chooseLanguage(nlu, deviceMemory, clientLanguage = null) {
  // 1) РљР°РЅРґРёРґР°С‚ РёР· NLU (РіР»Р°РІРЅС‹Р№)
  let candidate = null;

  const nluLangRaw =
    nlu?.meta?.language ||
    nlu?.language ||
    null;

  if (typeof nluLangRaw === 'string' && nluLangRaw.trim()) {
    const norm = nluLangRaw.trim().toLowerCase();
    if (norm !== 'unknown' && norm !== 'mixed') {
      candidate = norm.split('-')[0];
    }
  }

  // 2) РЇР·С‹Рє РёР· РґРѕР»РіРѕСЃСЂРѕС‡РЅРѕР№ РїР°РјСЏС‚Рё СѓСЃС‚СЂРѕР№СЃС‚РІР°
  if (!candidate) {
    const pref = deviceMemory?.languagePreferences?.primary;
    if (typeof pref === 'string' && pref.trim()) {
      candidate = pref.trim().toLowerCase().split('-')[0];
    }
  }

  // 3) UI hint (clientLanguage) вЂ” С‚РѕР»СЊРєРѕ РµСЃР»Рё РІРѕРѕР±С‰Рµ РЅРёС‡РµРіРѕ РЅРµ РёР·РІРµСЃС‚РЅРѕ
  if (!candidate && typeof clientLanguage === 'string' && clientLanguage.trim()) {
    const norm = clientLanguage.trim().toLowerCase();
    if (norm !== 'unknown' && norm !== 'mixed') {
      candidate = norm.split('-')[0];
    }
  }

  return candidate || 'en';
}



/**
 * Heuristic: user asks if a specific item exists in menu ("Do you have kombucha?", "Сѓ РІР°СЃ РµСЃС‚СЊ ...?")
 * We treat it as availability question to show a different text and do category-first suggestions.
 */
function isAvailabilityQuestion(text) {
  const t = String(text || '').trim().toLowerCase();

  // RU
  if (/(^|\s)(Сѓ\s+РІР°СЃ\s+РµСЃС‚СЊ|РµСЃС‚СЊ\s+Р»Рё|РёРјРµРµС‚СЃСЏ|РІ\s+РЅР°Р»РёС‡РёРё)(\s|$)/i.test(t)) return true;

  // UA
  if (/(^|\s)(Сѓ\s+РІР°СЃ\s+С”|С‡Рё\s+С”|С”\s+РІ\s+РјРµРЅСЋ|РјР°С”С‚Рµ)(\s|$)/i.test(t)) return true;

  // EN
  if (/(^|\s)(do\s+you\s+have|have\s+you\s+got|is\s+there|do\s+you\s+serve)(\s|$)/i.test(t)) return true;

  // generic question form
  if (t.endsWith('?') && /(РµСЃС‚СЊ|С”|have)\b/i.test(t)) return true;

  return false;
}

/**
 * Category hint for availability questions.
 * We DO NOT change menuService; instead we pass a hint word so menuService's "tags-first" path activates.
 * Returned values intentionally match existing PREF_KEYWORDS words: 'drink', 'dessert', 'snack', 'main', 'light'.
 */
function detectAvailabilityCategoryHint(text) {
  const t = String(text || '').trim().toLowerCase();

  // Drinks
  if (/(РєРѕРјР±СѓС‡|kombuch|РЅР°РїРёС‚|drink|beverage|cola|coke|Р»РёРјРѕРЅР°Рґ|lemonade|С‡Р°Р№|tea|РєРѕС„Рµ|coffee|water|juice|СЃРѕРє)/i.test(t)) {
    return 'drink';
  }

  // Desserts / sweet
  if (/(РґРµСЃРµСЂС‚|dessert|sweet|cake|С‚РѕСЂС‚|РјРѕСЂРѕР·РёРІ|ice\s*cream|РјРѕС‚Рё|mochi)/i.test(t)) {
    return 'dessert';
  }

  // Snacks
  if (/(Р·Р°РєСѓСЃРє|snack|Р°РїРїРµС‚Р°Р№Р·РµСЂ|appetizer|popcorn|РїРѕРїРєРѕСЂРЅ|fries|РєР°СЂС‚РѕС€Рє)/i.test(t)) {
    return 'snack';
  }

  // Main dishes
  if (/(РѕСЃРЅРѕРІРЅ|main\s*dish|main|steak|СЃС‚РµР№Рє|roll|СЂРѕР»Р»|СЂРѕР»Р»С‹|ramen|СЂР°РјРµРЅ|udon|СѓРґРѕРЅ|sushi|СЃСѓС€Рё|soup|СЃСѓРї|noodl|Р»Р°РїС€)/i.test(t)) {
    return 'main';
  }

  // Light
  if (/(Р»РµРіРє|light|salad|СЃР°Р»Р°С‚)/i.test(t)) {
    return 'light';
  }

  return null;
}

function detectConceptHintWords(queryUnderstanding) {
  const concepts = Array.isArray(queryUnderstanding?.concepts)
    ? queryUnderstanding.concepts
    : [];
  const out = new Set();

  for (const concept of concepts) {
    const cfg = getConceptConfig(concept);
    if (!cfg) continue;
    if (concept === 'tequila') out.add('tequila');
    if (concept === 'chicken') out.add('chicken');
    if (concept === 'meat') out.add('meat');
    if (concept === 'noodles') out.add('noodles');
    if (concept === 'burger') out.add('burger');
    for (const t of cfg.requiredTokens || []) {
      if (String(t || '').length >= 4) out.add(String(t));
    }
  }

  return Array.from(out);
}

const INGREDIENT_CONCEPTS = new Set([
  'chicken',
  'meat',
  'shrimp',
  'tuna',
  'salmon',
  'crab',
  'beef',
  'veal',
  'duck',
]);

function pickPrimaryConcept(understanding) {
  const concepts = Array.isArray(understanding?.concepts) ? understanding.concepts : [];
  if (!concepts.length) return null;
  for (const concept of concepts) {
    if (INGREDIENT_CONCEPTS.has(concept)) return concept;
  }
  return concepts[0] || null;
}

function conceptLabel(concept) {
  const map = {
    chicken: 'chicken',
    meat: 'meat',
    shrimp: 'shrimp',
    tuna: 'tuna',
    salmon: 'salmon',
    crab: 'crab',
    beef: 'beef',
    veal: 'veal',
    duck: 'duck',
    soup: 'soups',
    sushi: 'sushi',
    sashimi: 'sashimi',
    nigiri: 'nigiri',
    gunkan: 'gunkan',
    temaki: 'temaki',
    noodles: 'noodles',
    burger: 'burgers',
    drink: 'drinks',
    salad: 'salads',
    dessert: 'desserts',
    spicy: 'spicy options',
    tequila: 'tequila options',
  };
  return map[concept] || concept;
}

function buildSuggestIntroText(understanding, hasSuggestions) {
  const primary = pickPrimaryConcept(understanding);
  if (!primary) {
    return hasSuggestions
      ? 'Here are a few ideas. Tap + to add items to your cart (you can add more than one).'
      : "I couldn't find matching items right now.";
  }

  const label = conceptLabel(primary);
  if (!hasSuggestions) {
    return `I couldn't find items for "${label}" right now.`;
  }
  return `Here are items with ${label}:`;
}

function inferDishStyleFromDetails(mi) {
  const hay = normalizeQueryText(
    `${mi?.name_en || ''} ${mi?.name_ua || ''} ${mi?.description_en || ''} ${mi?.description_ua || ''} ${
      Array.isArray(mi?.ingredients) ? mi.ingredients.join(' ') : ''
    } ${Array.isArray(mi?.tags) ? mi.tags.join(' ') : ''} ${mi?.category || ''}`
  );
  return {
    spicy: /\bspicy|chili|hot|pepper\b|гостр|остр|пікант/.test(hay),
    meat: /\b(beef|chicken|duck|pork|veal|lamb|meat)\b|мяс|м’яс|м'яс|кур|кач|утк|ялович|теля/.test(hay),
    seafood: /\b(crab|shrimp|prawn|tuna|salmon|eel|squid|octopus|seafood)\b|краб|кревет|тун|лосос|угор|морепродукт/.test(
      hay
    ),
  };
}

function buildDishExplainTextEn(mi, userText = '') {
  const name = mi?.name_en || mi?.name_ua || mi?.item_code || 'This dish';
  const desc = mi?.description_en || mi?.description_ua || '';
  const ingredients = Array.isArray(mi?.ingredients) ? mi.ingredients.filter(Boolean) : [];
  const category = String(mi?.category || '').trim();
  const style = inferDishStyleFromDetails(mi);
  const q = normalizeQueryText(userText);

  if (/\b(spicy|остр|гостр|пікант)\b/.test(q)) {
    return style.spicy
      ? `${name} is likely spicy or has a noticeable kick.`
      : `${name} is usually not spicy.`;
  }
  if (/\b(мяс|мясн|м'яс|м’яс|meat|meaty)\b/.test(q)) {
    return style.meat
      ? `${name} is a meat-based dish.`
      : `${name} is not primarily meat-based.`;
  }
  if (/\b(what is|что это|що це|about|describe|вкус|taste)\b/.test(q)) {
    let text = `**${name}**`;
    if (desc) text += `\n${desc}`;
    else if (category) text += `\nIt belongs to ${category} category.`;
    if (ingredients.length) text += `\n\nIngredients: ${ingredients.slice(0, 8).join(', ')}`;
    return text;
  }

  let fallback = `**${name}**`;
  if (desc) fallback += `\n${desc}`;
  if (!desc && category) fallback += `\nCategory: ${category}.`;
  if (ingredients.length) fallback += `\n\nIngredients: ${ingredients.slice(0, 8).join(', ')}`;
  return fallback;
}

function isConversationalDishQuestion(text) {
  const t = normalizeQueryText(text);
  if (!t) return false;
  return /(расскажи|опиши|что такое|what is|tell me about|describe|на вкус|taste|это остро|is it spicy|это мяс|is it meat)/i.test(
    t
  );
}

async function resolveItemDetailsForConversation({
  session,
  language,
  normalizedText,
  nlu,
  dialogState,
}) {
  const fromNlu = Array.isArray(nlu?.items) ? nlu.items.find((it) => it?.menu_item_id) : null;
  if (fromNlu?.menu_item_id) {
    return getMenuItemWithDetailsById(fromNlu.menu_item_id);
  }

  const focusedId = dialogState?.last_focused_menu_item_id || dialogState?.lastFocusedMenuItemId || null;
  if (focusedId) {
    const focused = await getMenuItemWithDetailsById(focusedId);
    if (focused && focused.is_active !== false) return focused;
  }

  const suggested = await suggestMenuItems(session.restaurant_id, {
    query: normalizedText,
    locale: language,
    limit: 1,
  });
  const top = Array.isArray(suggested) ? suggested[0] : null;
  const code = top?.item_code || top?.code || null;
  if (!code) return null;

  const detailed = await fetchMenuItemsWithDetails(session.restaurant_id, { onlyActive: true });
  return (detailed || []).find((row) => row?.item_code === code) || null;
}

async function buildRecommendationsFromSuggestions(suggestions = [], limit = 4) {
  return dedupeByCode(
    (Array.isArray(suggestions) ? suggestions : [])
      .slice(0, limit)
      .map((s) => ({
        code: s.item_code || s.code,
        name: s.name || s.name_en || s.name_local || s.item_code || s.code,
        unitPrice: s.price != null ? Number(s.price) : null,
        imageUrl: s.image_url || s.imageUrl || null,
      }))
      .filter((s) => Boolean(s.code))
  );
}

function scoreSuggestionTextOverlap(rec, queryTokens = [], hintWords = []) {
  const text = normalizeQueryText(`${rec?.name || ''} ${rec?.code || ''}`);
  const itemTokens = new Set(tokenizeNormalized(text));
  let score = 0;
  for (const t of queryTokens) if (itemTokens.has(t)) score += 1;
  for (const h of hintWords) {
    const norm = normalizeQueryText(h);
    if (!norm) continue;
    if (text.includes(norm)) score += 2;
  }
  return score;
}

async function getQueryRecommendations({
  session,
  language,
  normalizedText,
  queryUnderstanding,
  suggestionLimit = 4,
  availabilityQ = false,
  availabilityHint = null,
}) {
  let suggestions = [];
  if (availabilityQ && availabilityHint) {
    suggestions = await suggestMenuItems(session.restaurant_id, {
      query: `${availabilityHint} ${normalizedText}`.trim(),
      locale: language,
      limit: suggestionLimit,
    });
  }

  if (!suggestions || suggestions.length === 0) {
    const conceptHints = detectConceptHintWords(queryUnderstanding);
    for (const hint of conceptHints) {
      const rows = await suggestMenuItems(session.restaurant_id, {
        query: hint,
        locale: language,
        limit: suggestionLimit,
      });
      if (Array.isArray(rows) && rows.length > 0) {
        suggestions = [...(suggestions || []), ...rows];
      }
    }
  }

  if (!suggestions || suggestions.length === 0) {
    suggestions = await suggestMenuItems(session.restaurant_id, {
      query: normalizedText,
      locale: language,
      limit: suggestionLimit,
    });
  }

  let recs = await buildRecommendationsFromSuggestions(suggestions, suggestionLimit * 3);

  const concepts = Array.isArray(queryUnderstanding?.concepts) ? queryUnderstanding.concepts : [];
  const queryTokens = Array.isArray(queryUnderstanding?.tokens) ? queryUnderstanding.tokens : [];
  const hintWords = detectConceptHintWords(queryUnderstanding);
  const conceptDriven = concepts.length > 0;

  if (conceptDriven && recs.length > 0) {
    const scored = recs.map((r) => ({
      ...r,
      _overlap: scoreSuggestionTextOverlap(r, queryTokens, hintWords),
    }));
    const anyPositive = scored.some((x) => x._overlap > 0);
    if (anyPositive) {
      recs = scored
        .filter((x) => x._overlap > 0)
        .sort((a, b) => b._overlap - a._overlap)
        .map(({ _overlap, ...row }) => row);
    }
  }

  return recs.slice(0, suggestionLimit);
}

function buildNoAddFallbackText(understanding, hasSuggestions) {
  const concepts = Array.isArray(understanding?.concepts) ? understanding.concepts : [];
  if (concepts.includes('burger')) {
    return hasSuggestions
      ? "We don't have burgers. Here are the closest options."
      : "We don't have burgers on the menu right now.";
  }
  if (concepts.includes('noodles')) {
    return hasSuggestions
      ? 'I found noodle-related options for you.'
      : "We don't have noodle dishes right now.";
  }
  if (concepts.includes('meat')) {
    return hasSuggestions
      ? 'Here are meat dishes you may like.'
      : "I couldn't find meat dishes right now. Tell me which meat you prefer: beef, chicken, duck, or pork.";
  }
  if (concepts.includes('chicken')) {
    return hasSuggestions
      ? 'Here are chicken dishes you may like.'
      : "I couldn't find chicken dishes right now.";
  }
  if (concepts.includes('tequila')) {
    return hasSuggestions
      ? 'Here are tequila options.'
      : "I couldn't find tequila options right now.";
  }
  if (concepts.includes('shrimp')) {
    return hasSuggestions
      ? 'Here are dishes with shrimp.'
      : "I couldn't find dishes with shrimp right now.";
  }
  if (concepts.includes('crab')) {
    return hasSuggestions
      ? 'Here are dishes with crab.'
      : "I couldn't find dishes with crab right now.";
  }
  if (concepts.includes('salmon')) {
    return hasSuggestions
      ? 'Here are dishes with salmon.'
      : "I couldn't find dishes with salmon right now.";
  }
  if (concepts.includes('tuna')) {
    return hasSuggestions
      ? 'Here are dishes with tuna.'
      : "I couldn't find dishes with tuna right now.";
  }
  return hasSuggestions
    ? "I couldn't safely add an exact item yet, but here are the closest options."
    : "I couldn't detect an exact dish. Please specify the exact menu item you want to add.";
}

function prettifyCategorySlug(slug) {
  const text = String(slug || '')
    .replace(/[_-]+/g, ' ')
    .trim();
  if (!text) return '';
  return text
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function pickCategoryLabelForLanguage(category, language) {
  const lang = String(language || '').toLowerCase();
  const nameEn = String(category?.name_en || '').trim();
  const nameUa = String(category?.name_ua || '').trim();
  const slugPretty = prettifyCategorySlug(category?.slug);

  if (lang.startsWith('uk') || lang.startsWith('ua')) {
    return nameUa || nameEn || slugPretty || 'this category';
  }
  return nameEn || slugPretty || nameUa || 'this category';
}




/**
 * Р’С‹С‚Р°СЃРєРёРІР°РµРј Р°Р»Р»РµСЂРіРёРё РёР· СЂРµР·СѓР»СЊС‚Р°С‚Р° NLU (РЅРѕРІС‹Р№ С„РѕСЂРјР°С‚ items.*.allergensRisk + СЃС‚Р°СЂС‹Р№ entities.allergies).
 */
function extractAllergiesFromNLU(nlu) {
  if (!nlu) return [];

  // РќРѕРІС‹Р№ С„РѕСЂРјР°С‚: items[].allergensRisk
  if (Array.isArray(nlu.items)) {
    const set = new Set();
    for (const it of nlu.items) {
      if (Array.isArray(it.allergensRisk)) {
        for (const a of it.allergensRisk) {
          if (a) set.add(String(a).toLowerCase());
        }
      }
    }
    if (set.size > 0) {
      return Array.from(set);
    }
  }

  // РЎС‚Р°СЂС‹Р№ С„РѕСЂРјР°С‚
  if (nlu.entities && Array.isArray(nlu.entities.allergies)) {
    return nlu.entities.allergies.map((a) => String(a || '').toLowerCase());
  }

  return [];
}



/**
 * РЎС‚СЂРѕРёРј С‚РµРєСЃС‚ РѕС‚РІРµС‚Р° СЃ СЂРµР·СЋРјРµ Р·Р°РєР°Р·Р°
 */
/**
 * РЎС‚СЂРѕРёРј С‚РµРєСЃС‚ РѕС‚РІРµС‚Р° СЃ СЂРµР·СЋРјРµ Р·Р°РєР°Р·Р° (EN-only).
 * РџРµСЂРµРІРѕРґРѕРј Р·Р°РЅРёРјР°РµС‚СЃСЏ NLG-СЃР»РѕР№.
 */
function buildOrderReplyText(order) {
  return buildOrderReplyTextSafe(order);
}

/**
 * РЈРїР°РєРѕРІС‹РІР°РµРј Р·Р°РєР°Р· РІ СѓРґРѕР±РЅС‹Р№ С„РѕСЂРјР°С‚ РґР»СЏ С„СЂРѕРЅС‚Р° (РєР°СЂС‚РѕС‡РєРё Р·Р°РєР°Р·Р°).
 */
function buildOrderDraftForResponse(order) {
  return buildOrderDraftForResponseSafe(order);
}

/**
 * Build allergy warning for current order (EN-only, translated later by NLG layer).
 */
async function buildAllergyWarningForOrder(session, nlu, order, deviceMemory) {
  if (!order || !Array.isArray(order.items) || order.items.length === 0) return '';

  const restaurantId = session?.restaurant_id;
  if (!restaurantId) return '';

  const itemCodes = Array.from(
    new Set(
      order.items
        .map((it) => it.item_code)
        .filter((code) => typeof code === 'string' && code.length > 0)
    )
  );
  if (itemCodes.length === 0) return '';

  const baseAllergies =
    deviceMemory && Array.isArray(deviceMemory.allergies)
      ? deviceMemory.allergies
      : session?.device_id
      ? await getDeviceAllergies(session.device_id)
      : [];

  const nluAllergies = extractAllergiesFromNLU(nlu);
  const mergedAllergies = Array.from(new Set([...(baseAllergies || []), ...nluAllergies]));
  if (mergedAllergies.length === 0) return '';

  const check = await checkAllergensForItems(restaurantId, itemCodes, mergedAllergies);
  const dangerous = (check || []).filter((item) => item?.is_safe === false);
  if (dangerous.length === 0) return '';

  const itemNames = dangerous.map((d) => d.name_en || d.item_code).filter(Boolean);
  const allergensMentioned = Array.from(
    new Set(
      dangerous
        .flatMap((d) => (Array.isArray(d.matched_allergens) ? d.matched_allergens : []))
        .filter(Boolean)
    )
  );

  if (!itemNames.length || !allergensMentioned.length) return '';

  return (
    '\n\n⚠️ *Allergy warning*\n' +
    `Your order contains items that may include your allergens (${allergensMentioned.join(', ')}): ${itemNames.join(', ')}.\n` +
    'If this is critical for you, please double-check with the waiter.'
  );
}


/**
 * Р“Р»Р°РІРЅР°СЏ С‚РѕС‡РєР° РІС…РѕРґР°: РѕР±СЂР°Р±РѕС‚РєР° СЃРѕРѕР±С‰РµРЅРёСЏ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ.
 *
 * @param {object} params
 * @param {string} params.text
 * @param {object} params.session
 * @param {object} [params.deviceProfile]
 * @param {object} [params.order]        вЂ” С‚РµРєСѓС‰РёР№ С‡РµСЂРЅРѕРІРѕР№ Р·Р°РєР°Р· (РµСЃР»Рё РµСЃС‚СЊ)
 * @param {string} [params.deviceId]
 */



export async function processUserMessage({ 
  text, 
  session, 
  deviceProfile, 
  order, 
  deviceId, 
  clientLanguage = null, 
}) {
  const normalizedText = (text || '').toString().trim();
  if (!normalizedText) {
    return {
      nlu: null,
      handled: false,
      reply: null,
      order,
    };
  }

  const effectiveDeviceId = deviceId ?? session?.device_id ?? null;

  // 0) Multi-tier memory
  const [sessionMemory, deviceMemory, mediumTermContext] = await Promise.all([
    loadSessionMemory(session.id),
    effectiveDeviceId ? loadDeviceMemory(effectiveDeviceId) : Promise.resolve(null),
    effectiveDeviceId
      ? getMediumTermContext(effectiveDeviceId, { windowDays: 3, limit: 10 })
      : Promise.resolve({ orders: [] }),
  ]);

  // 1) NLU (РЅРѕРІС‹Р№ + С„РѕР»Р±РµРє РЅР° legacy) + РјРµС‚СЂРёРєРё + РјСЏРіРєРёР№ fallback
  let nlu = null;
  const nluStart = Date.now();

  try {
    nlu = await runNLU({
      text: normalizedText,
      session,
      deviceProfile,
      order,
      sessionMemory,
      deviceMemory,
      mediumTermContext,
      clientLanguage,
    });

    await insertPerformanceMetric({
      metricName: 'nlu.run',
      scope: 'chat', // РґР»СЏ РіРѕР»РѕСЃРѕРІРѕРіРѕ Р°СЃСЃРёСЃС‚РµРЅС‚Р° РјС‹ Р»РѕРіРёСЂСѓРµРј РѕС‚РґРµР»СЊРЅРѕ
      durationMs: Date.now() - nluStart,
      labels: {
        source: 'chat',
        has_error: false,
      },
      meta: {
        has_text: !!normalizedText,
        session_id: session?.id || null,
        restaurant_id: session?.restaurant_id || null,
      },
    });
  } catch (err) {
    console.error('[DialogManager] NLU fatal error:', err);

    await insertPerformanceMetric({
      metricName: 'nlu.run',
      scope: 'chat',
      durationMs: Date.now() - nluStart,
      labels: {
        source: 'chat',
        has_error: true,
        reason: 'NLU_EXCEPTION',
      },
      meta: {
        errorMessage: err?.message || String(err),
        session_id: session?.id || null,
        restaurant_id: session?.restaurant_id || null,
      },
    });

    const baseTextEn =
  'Sorry, I cannot process your request right now. Please call a live waiter.';

const language = chooseLanguage(null, deviceMemory ?? null, clientLanguage);
 // РµСЃР»Рё nlu Р·РґРµСЃСЊ РЅРµС‚ вЂ” РјРѕР¶РЅРѕ РѕС‚РґРµР»СЊРЅРѕ Р·Р°РґРµС„РѕР»С‚РёС‚СЊ 'en'

const reply = await respondInLanguage({
  baseTextEn,
  targetLanguage: language,
});

return {
  nlu: null,
  handled: true,
  reply,
  order,
};

  }



  if (!nlu || !nlu.intent || nlu.intent === 'empty') {
    const language = chooseLanguage(nlu, deviceMemory ?? null, clientLanguage);
    const baseTextEn =
      'I didn’t fully understand your request yet. Could you phrase it more simply? For example: “I want a lemonade”, “Recommend a dessert” or “I’m allergic to nuts”.';
    const reply = await respondInLanguage({
      baseTextEn,
      targetLanguage: language,
    });

    return {
      nlu,
      handled: false,
      reply,
      order,
    };
  }

    const language = chooseLanguage(nlu, deviceMemory ?? null, clientLanguage);
  nlu.meta = { ...(nlu.meta || {}), response_language: language };
  nlu.response_language = language;

  // РћР±РЅРѕРІР»СЏРµРј language_preferences РІ long-term РїР°РјСЏС‚Рё, РµСЃР»Рё РіРѕСЃС‚СЊ РїРµСЂРµРєР»СЋС‡РёР» СЏР·С‹Рє
  const primaryLang = language;
  if (effectiveDeviceId && primaryLang && deviceMemory) {
    const prevLang = deviceMemory.languagePreferences?.primary;
    if (!prevLang || prevLang !== primaryLang) {
      await updateDeviceMemory(effectiveDeviceId, {
        language: primaryLang,
        touchLastVisit: true,
      });
      deviceMemory.languagePreferences = {
        ...(deviceMemory.languagePreferences || {}),
        primary: primaryLang,
      };
    }
  }


  // 2) Р“РѕС‚РѕРІРёРј Р·Р°РєР°Р· РґР»СЏ СЂРµР·РѕР»СЊРІРµСЂР°: РµСЃР»Рё РЅРµС‚ items вЂ” РїРѕРґРіСЂСѓР¶Р°РµРј РёС… РёР· Р‘Р”
  let orderForResolver = order;
  try {
    if (
      orderForResolver &&
      (!Array.isArray(orderForResolver.items) || orderForResolver.items.length === 0)
    ) {
      orderForResolver = await getOrderWithItemsForChat(orderForResolver.id);
    }
  } catch (e) {
    console.error(
      '[DialogManager] Failed to load order with items for resolver',
      e
    );
  }

  // 3) Р—Р°РіСЂСѓР¶Р°РµРј dialog_state Рё СЂРµР·РѕР»РІРёРј РєРѕРЅС‚РµРєСЃС‚РЅС‹Рµ СЃСЃС‹Р»РєРё
  const dialogState = await getDialogState(session.id);

  const resolved = resolveReferences({
    nluResult: { ...nlu, rawText: normalizedText },
    dialogState,
    currentOrder: orderForResolver,
  });

  const resolvedIntent = resolved.intent || nlu.intent;
  const queryUnderstanding = buildQueryUnderstanding(normalizedText, {
    localeHint: language,
  });

  if (process.env.AI_MATCH_DEBUG === '1') {
    console.log('[AI_MATCH_DEBUG][dialog:nlu]', {
      text: normalizedText,
      detected_language: queryUnderstanding.language,
      detected_intent: resolvedIntent,
      concepts: queryUnderstanding.concepts,
      nlu_clarification_needed: Boolean(
        nlu?.clarificationNeeded ?? nlu?.meta?.clarificationNeeded
      ),
    });
  }

    // вњ… Р•СЃР»Рё РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ РїРѕС€С‘Р» РґР°Р»СЊС€Рµ (РЅРµ confirm/reject upsell) вЂ” РЅРµ РїРѕРєР°Р·С‹РІР°РµРј СЃС‚Р°СЂС‹Р№ upsell СЃРЅРѕРІР°
  if (resolvedIntent !== 'confirm' && resolvedIntent !== 'confirm_upsell' && resolvedIntent !== 'reject_upsell') {
    try {
      await clearLastUpsellForSession(session.id);
    } catch (e) {
      console.error('[DialogManager] Failed to clear last upsell', e);
    }
  }


  // СЃРѕС…СЂР°РЅСЏРµРј РЅРѕРІС‹Р№ С„РѕРєСѓСЃ (contextPatch) РІ dialog_state
  if (resolved && resolved.contextPatch) {
    await upsertDialogState(session.id, resolved.contextPatch);
  }

  // Р›РѕРіРёСЂСѓРµРј СЌРјРѕС†РёРё, РµСЃР»Рё NLU РёС… РЅР°С€С‘Р»
  if (nlu.emotion) {
    await logEvent(
      'emotion_detected',
      { session, deviceId: deviceId ?? session.device_id },
      {
        emotion: nlu.emotion,
        text: normalizedText,
      }
    );
  }

  let reply = '';
  let orderForResponse = order || null;

  // рџ”№ UI-Р°РїСЃРµР» РґР»СЏ С‚РµРєСѓС‰РµРіРѕ СЃРѕРѕР±С‰РµРЅРёСЏ (РїРѕ СѓРјРѕР»С‡Р°РЅРёСЋ РЅРµС‚)
  let uiUpsell = null;

  try {
    const requestedCategory = await findRequestedCustomCategory({
      restaurantId: session?.restaurant_id,
      text: normalizedText,
      nlu: { ...nlu, intent: resolvedIntent },
    });

    if (requestedCategory) {
      const recommendationsRaw = await getCustomCategoryRecommendations({
        restaurantId: session?.restaurant_id,
        categoryId: requestedCategory.id,
        limit: 12,
      });
      const recommendations = dedupeByCode(
        (recommendationsRaw || []).filter((it) => Boolean(it?.code))
      );

      const categoryLabel = pickCategoryLabelForLanguage(
        requestedCategory,
        language
      );

      const baseTextEn = recommendations.length
        ? `Here's what we have in ${categoryLabel}:`
        : `We don't have items in ${categoryLabel} yet.`;

      const reply = await respondInLanguage({
        baseTextEn,
        targetLanguage: language,
      });

      return {
        nlu,
        handled: true,
        reply,
        order: orderForResponse,
        recommendations,
        customCategories: [categoryLabel],
      };
    }
  } catch (err) {
    console.error('[DialogManager] custom category resolution failed', err);
  }

  // 4) РћР±СЂР°Р±РѕС‚РєР° РёРЅС‚РµРЅС‚РѕРІ (С‡РµСЂРµР· resolvedIntent)
  switch (resolvedIntent) {
    case 'greeting': {
  const baseTextEn =
    "Hi! I'm your AI waiter. I can help with the menu, take your order or suggest something tasty. What would you like?";

  const reply = await respondInLanguage({
    baseTextEn,
    targetLanguage: language,
  });

  return { nlu, handled: true, reply, order: orderForResponse };
}


case 'help': {
  const baseTextEn =
    'I can help you: explain the menu, take your order, add dishes to your current bill, consider allergies and preferences. Just type what you want.';

  const reply = await respondInLanguage({
    baseTextEn,
    targetLanguage: language,
  });

  return { nlu, handled: true, reply, order: orderForResponse };
}

case 'ask_menu': {
  // ask_menu: recommendations OR info about a specific dish
  const firstResolved = Array.isArray(nlu?.items)
    ? nlu.items.find((it) => it && it.menu_item_id)
    : null;
  const conversationalMode = isConversationalDishQuestion(normalizedText);

  // 1) Specific dish: provide description + ingredients/allergens + CTA
  if (firstResolved?.menu_item_id || conversationalMode) {
    const mi = firstResolved?.menu_item_id
      ? await getMenuItemWithDetailsById(firstResolved.menu_item_id)
      : await resolveItemDetailsForConversation({
          session,
          language,
          normalizedText,
          nlu,
          dialogState,
        });

    if (mi && mi.is_active !== false) {
      const allergens = Array.isArray(mi.allergens)
        ? mi.allergens.map((a) => (a?.name ? a.name : a?.code)).filter(Boolean)
        : [];
      let baseTextEn = buildDishExplainTextEn(mi, normalizedText);
      if (!conversationalMode) {
        if (allergens.length) {
          baseTextEn += `\nAllergens: ${allergens.join(', ')}`;
        }
        baseTextEn += `\n\nWant to add it to your order?`;
      }

      const reply = await respondInLanguage({
        baseTextEn,
        targetLanguage: language,
      });

      return { nlu, handled: true, reply, order: orderForResponse };
    }
  }

  // 2) Recommendation / menu exploration: use existing semantic suggestion service
    // 2) Recommendation / menu exploration: use existing semantic suggestion service
  const availabilityQ = isAvailabilityQuestion(normalizedText);
  const hasConcepts = Array.isArray(queryUnderstanding?.concepts) && queryUnderstanding.concepts.length > 0;
  const availabilityHint =
    availabilityQ && !hasConcepts ? detectAvailabilityCategoryHint(normalizedText) : null;

  const suggestionLimit = 4;
  const recommendations = await getQueryRecommendations({
    session,
    language,
    normalizedText,
    queryUnderstanding,
    suggestionLimit,
    availabilityQ,
    availabilityHint,
  });

if (!recommendations || recommendations.length === 0) {
    const baseTextEn = buildNoAddFallbackText(queryUnderstanding, false);
    const reply = await respondInLanguage({
      baseTextEn,
      targetLanguage: language,
    });
    return { nlu, handled: true, reply, order: orderForResponse };
  }

  const baseTextEn = availabilityQ
    ? buildNoAddFallbackText(queryUnderstanding, true)
    : buildSuggestIntroText(queryUnderstanding, true);

  const reply = await respondInLanguage({
    baseTextEn,
    targetLanguage: language,
  });

  // вњ… Return recommendations separately (frontend renders cards + plus buttons)
  return { nlu, handled: true, reply, order: orderForResponse, recommendations };
}

case 'smalltalk': {
  const baseTextEn =
    "I'm here рџЉ Tell me what you feel like (spicy, salty, sweet, drink, dessert) or just name a dish вЂ” I can recommend and take the order.";
  const reply = await respondInLanguage({
    baseTextEn,
    targetLanguage: language,
  });
  return { nlu, handled: true, reply, order: orderForResponse };
}

case 'farewell': {
  const baseTextEn = 'No worries вЂ” see you soon!';
  const reply = await respondInLanguage({
    baseTextEn,
    targetLanguage: language,
  });
  return { nlu, handled: true, reply, order: orderForResponse };
}


case 'allergy_info': {
  const nluAllergies = extractAllergiesFromNLU(nlu);

  if (nluAllergies.length > 0 && effectiveDeviceId) {
    const baseAllergies = Array.isArray(deviceMemory?.allergies)
      ? deviceMemory.allergies
      : [];
    const mergedAllergies = Array.from(
      new Set([...(baseAllergies || []), ...nluAllergies])
    );

    await updateDeviceMemory(effectiveDeviceId, {
      allergies: mergedAllergies,
      touchLastVisit: true,
    });

    await updateDeviceAllergies(
      session.device_id ?? effectiveDeviceId,
      mergedAllergies
    );

    deviceMemory.allergies = mergedAllergies;
  }

  let baseTextEn;

  if (nluAllergies.length > 0) {
    baseTextEn =
      "Got it. I've noted that you have allergies to: " +
      nluAllergies.join(', ') +
      '.\n' +
      'I will try not to recommend anything that may contain them. ' +
      'Still, for critical cases, please double-check with the live waiter.';
  } else {
    baseTextEn =
      "You mentioned allergies. I'll keep that in mind, but for now I donвЂ™t have a full allergen map for all dishes.\n" +
      'For anything critical, please double-check with the waiter.';
  }

  const reply = await respondInLanguage({
    baseTextEn,
    targetLanguage: language,
  });

  return { nlu, handled: true, reply, order: orderForResponse };
}


    case 'order':
    case 'add_to_order': {
      const actions = resolved?.actions || [];
      const mutationPolicy = decideOrderMutationPolicy({
        resolvedIntent,
        text: normalizedText,
        nluItems: Array.isArray(nlu?.items) ? nlu.items : [],
        clarificationNeeded:
          nlu?.clarificationNeeded ?? nlu?.meta?.clarificationNeeded ?? false,
        queryUnderstanding,
      });

      if (process.env.AI_MATCH_DEBUG === '1') {
        console.log('[AI_MATCH_DEBUG][dialog:mutation_decision]', {
          text: normalizedText,
          detected_language: queryUnderstanding.language,
          detected_intent: resolvedIntent,
          policy_mode: mutationPolicy.mode,
          reason: mutationPolicy.reason,
          explicit_order_action: mutationPolicy.explicitOrderAction,
          eligible_items: (mutationPolicy.eligibleItems || []).map((it) => ({
            rawText: it.rawText || null,
            menu_item_id: it.menu_item_id || null,
            matchConfidence: Number(it.matchConfidence || 0),
          })),
        });
      }

      let updatedOrder;
      let addedItems = [];

      if (mutationPolicy.mode === 'add_exact' && actions.length) {
        if (!order || !order.id) {
          const draft = await getOrCreateDraftOrderForSession(session);
          orderForResponse = draft;
        }

        const orderId = (orderForResponse || order).id;

        let fullBefore = orderForResolver || orderForResponse || order;
        if (!fullBefore || !Array.isArray(fullBefore.items)) {
          fullBefore = await getOrderWithItemsForChat(orderId);
        }

        const beforeIds = new Set(
          (fullBefore.items || []).map((it) => it.id)
        );

        const allowedExactIds = new Set(
          Array.isArray(mutationPolicy?.exactItemIds) ? mutationPolicy.exactItemIds : []
        );

        for (const act of actions) {
          if (!act || act.type !== 'add_item') continue;

          const { menuItemId, quantity, modifiers } = act.payload || {};
          if (!menuItemId) continue;
          if (!allowedExactIds.has(menuItemId)) {
            continue;
          }

          await addItemToOrder(orderId, menuItemId, {
            quantity:
              Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
            modifiers: modifiers || {},
          });
        }

        await recalcOrderTotal(orderId);
        updatedOrder = await getOrderWithItemsForChat(orderId);

        const itemsAfter = updatedOrder.items || [];
        addedItems = itemsAfter.filter((it) => !beforeIds.has(it.id));

        orderForResponse = updatedOrder;
      }

      if (!updatedOrder || !addedItems || addedItems.length === 0) {
        const suggestionLimit = 4;
        const recommendations = await getQueryRecommendations({
          session,
          language,
          normalizedText,
          queryUnderstanding,
          suggestionLimit,
          availabilityQ: false,
          availabilityHint: null,
        });

        if (process.env.AI_MATCH_DEBUG === '1') {
          console.log('[AI_MATCH_DEBUG][dialog:add_or_suggest]', {
            decision: mutationPolicy.mode === 'ask_clarify' ? 'ASK_CLARIFY' : 'SUGGEST_LIST',
            reason: mutationPolicy.reason,
            topCandidates: recommendations.slice(0, 5).map((r) => ({
              code: r.code,
              name: r.name,
            })),
          });
        }

        const baseTextEn =
          mutationPolicy.mode === 'ask_clarify' && recommendations.length === 0
            ? "Please name the exact menu item you want to add."
            : recommendations.length > 0
            ? buildSuggestIntroText(queryUnderstanding, true)
            : buildNoAddFallbackText(queryUnderstanding, false);

        const reply = await respondInLanguage({
          baseTextEn,
          targetLanguage: language,
        });

        return {
          nlu,
          handled: true,
          reply,
          order: orderForResponse,
          recommendations: recommendations.length ? recommendations : null,
        };
      }

      let baseTextEn = buildOrderReplyText(updatedOrder);

      

      // 3) Upsell EN-only
// 3) Context for upsell (timezone/weather/persona)
let settings = null;
try {
  settings = await getRestaurantSettings(session.restaurant_id);
} catch (e) {
  console.error('[DialogManager] getRestaurantSettings failed:', e);
  settings = null;
}

const timeCtx = computeTimeContext(new Date(), settings?.timezone || null, settings?.dayparts || DEFAULT_DAYPARTS);
const weatherEnabled = Boolean(settings?.weather_enabled);
const hasCoords = settings && Number.isFinite(Number(settings.lat)) && Number.isFinite(Number(settings.lon));
let weather = null;
if (weatherEnabled && hasCoords) {

  try {
    weather = await getWeatherForRestaurant({
      lat: Number(settings.lat),
      lon: Number(settings.lon),
      ttlSeconds:
        Number.isFinite(Number(settings?.weather_cache_ttl_seconds))
          ? Number(settings.weather_cache_ttl_seconds)
          : 600,
    });
  } catch (e) {
    console.error('[DialogManager] Weather fetch failed, continue without weather:', e);
    weather = null;
  }
}

let persona = null;
try {
  persona = await loadPersona(session.restaurant_id);
} catch (e) {
  console.error('[DialogManager] loadPersona failed:', e);
  persona = null;
}
const emotionVal = nlu.emotion ?? nlu.meta?.emotion ?? 'neutral';
// 3) Upsell EN-only
const upsellPack = await getChatUpsellSuggestion({
  order: updatedOrder,
  session,
  deviceId,
  deviceMemory,
  allergies: deviceMemory?.allergies || [],
  limitTopN: 3, // вњ… top-N candidates stored + exploration pool
  context: { time_ctx: timeCtx, weather, emotion: emotionVal, language, epsilon: settings?.upsell_default_epsilon },
});

const upsell = upsellPack?.picked || null;
const upsellCode = upsell?.item_code || null;
// --- Step 8: precise skip reasons (before deciding to show upsell) ---
const lastUpsellState = await getLastUpsellForSession(session.id);
const positionInFlow = (lastUpsellState?.last_upsell_position || 0) + 1;
const MAX_UPSELL_PER_SESSION =
  Number.isFinite(Number(settings?.upsell_max_per_session))
    ? Number(settings?.upsell_max_per_session)
    : 3;

const MIN_GAP_MINUTES =
  Number.isFinite(Number(settings?.upsell_min_gap_minutes))
    ? Number(settings?.upsell_min_gap_minutes)
    : 5;



let skipReason = null;

// 1) flow limit
if (positionInFlow > MAX_UPSELL_PER_SESSION) {
  skipReason = 'flow_limit';
}

// 1b) min gap between upsells (cooldown)
 if (
   !skipReason &&
   MIN_GAP_MINUTES > 0 &&
   lastUpsellState?.last_upsell_created_at &&
   lastUpsellState?.last_upsell_code // вњ… РІР°Р¶РЅРµР№С€РµРµ: gap СЃС‡РёС‚Р°РµРј С‚РѕР»СЊРєРѕ РµСЃР»Рё upsell СЂРµР°Р»СЊРЅРѕ РїРѕРєР°Р·С‹РІР°Р»Рё
 ) {
  const lastAt = new Date(lastUpsellState.last_upsell_created_at);
  if (!Number.isNaN(lastAt.getTime())) {
    const diffMs = Date.now() - lastAt.getTime();
    const diffMin = diffMs / 60000;
    if (diffMin < MIN_GAP_MINUTES) {
      skipReason = 'min_gap';
    }
  }
}


// 2) no candidates/top empty (РІР°Р¶РЅРµРµ, С‡РµРј invalid picked)
if (
  !skipReason &&
  (!upsellPack || !Array.isArray(upsellPack.top) || upsellPack.top.length === 0)
) {
  skipReason = 'no_candidates';
}

// 3) invalid picked (no item_code) вЂ” С‚РѕР»СЊРєРѕ РµСЃР»Рё top РІРѕРѕР±С‰Рµ Р±С‹Р»
if (!skipReason && !upsellCode) {
  skipReason = 'invalid_candidate';
}


// 4) already in order
if (!skipReason) {
  const orderedCodesSet = new Set(
    (updatedOrder.items || []).map((it) => it.item_code).filter(Boolean)
  );
  if (upsellCode && orderedCodesSet.has(upsellCode)) {
    skipReason = 'already_in_order';
  }
}

// 5) allergen block (only if user has allergies)
if (!skipReason && upsellCode && Array.isArray(deviceMemory?.allergies) && deviceMemory.allergies.length > 0) {
const check = await checkAllergensForItems(
  session.restaurant_id,
  [upsellCode],
  deviceMemory.allergies
);
const unsafe = (check || []).some(
  (row) => row?.item_code === upsellCode && row?.is_safe === false
);

  if (unsafe) {
    skipReason = 'allergen_block';
  }
}



if (!skipReason && upsellCode) {

  // 0b) Text (EN-only) from reason_code + context, then localized via NLG
// STEP 4: Safe NLG вЂ” text is built only from intent + slots (+ persona/emotion), NOT from reason_code
const upsellBaseName = addedItems[0]?.item_name || addedItems[0]?.item_code || null;

const intent = typeof upsell?.message_intent === 'string' && upsell.message_intent.trim()
  ? upsell.message_intent
  : 'pairing_suggestion';
const slots = {
  ...(upsell?.message_slots || {}),
  base_item_name: upsellBaseName,
  upsell_item_name: upsell?.item_name || upsellCode,
  time_ctx: timeCtx,
  weather,
};

const upsellTextEn =
  upsell?.text_en ||
  upsellPack?.text_en ||
  upsellPack?.text ||           // legacy
  buildUpsellTextEn({
    intent,
    slots,
    persona,
    emotion: emotionVal,
    language,
  });

const upsellText = await respondInLanguage({
  baseTextEn: upsellTextEn,
  targetLanguage: language,
});


  const orderSnapshot = {
    item_codes: (updatedOrder.items || [])
      .map((it) => it.item_code || it.itemCode)
      .filter(Boolean),
    total_price:
      typeof updatedOrder.total_amount === 'number'
        ? updatedOrder.total_amount
        : parseFloat(updatedOrder.total_amount || '0') || 0,
  };

  // 3) Р»РѕРіРёСЂСѓРµРј СЃРѕР±С‹С‚РёРµ upsell_shown (Рё РїРѕР»СѓС‡Р°РµРј eventId)
  // 3) Р»РѕРіРёСЂСѓРµРј СЃРѕР±С‹С‚РёРµ upsell_shown (Рё РїРѕР»СѓС‡Р°РµРј eventId)
  const picked = upsell || null; 

const ml = normalizeMlMeta(
  upsellPack?.ml ?? upsellPack?.strategy ?? upsellPack?.strategy_name ?? null
);

const reasonCode = picked?.reason_code ?? null;

  const shownEvent = await logEvent(
    'upsell_shown',
    { session, deviceId: deviceId ?? session.device_id },
    {
      restaurant_id: session.restaurant_id,
      device_id: deviceId ?? session.device_id,
      session_id: session.id,
      // вњ… NEW structured (Step 6/7)
      meta: { language, emotion: emotionVal },
      ml,
      features: upsellPack?.features ?? null,
      features_v1: upsellPack?.features_v1 ?? null,
      picked,
      top_candidates: Array.isArray(upsellPack?.top) ? upsellPack.top : null,
      reason_code: reasonCode,
      upsell_text_en: upsellTextEn,
      upsell_text_localized: upsellText,
      // вњ… Context as-is
      order_snapshot: orderSnapshot,
      position_in_flow: positionInFlow,
      time_context: timeCtx || null,
      weather: weather || null,
      // вњ… LEGACY flat (РЅРёС‡РµРіРѕ РЅРµ Р»РѕРјР°РµРј)
      language,
      emotion: emotionVal,
      suggested_item_code: picked?.item_code ?? null,
      suggested_item_name: picked?.item_name ?? picked?.item_code ?? null,
      strategy: ml.strategy,
      model_version: ml.model_version,
      epsilon: ml.epsilon,
      picked_by: ml.picked_by,
      // legacy extra
      order_id: updatedOrder.id,
    }
  );


  // 4) СЃРѕС…СЂР°РЅСЏРµРј вЂњРїРѕСЃР»РµРґРЅРёР№ Р°РїСЃРµР»Р»вЂќ РІ dialog_state (С‡С‚РѕР±С‹ "РґР°" СЃСЂР°Р±РѕС‚Р°Р»Рѕ РїРѕР·Р¶Рµ)
  await setLastUpsellForSession(session.id, {
  // РЅРѕРІС‹Р№ С„РѕСЂРјР°С‚
  itemCode: picked?.item_code,
  itemName: picked?.item_name || picked?.item_code || null,
  textEn: upsellTextEn,
  eventId: shownEvent?.id || null,
  position: positionInFlow,
  strategy: ml.strategy,
  modelVersion: ml.model_version,
  epsilon: ml.epsilon,
  pickedBy: ml.picked_by,
  reasonCode: picked?.reason_code ?? reasonCode,
  language,
  emotion: emotionVal,

  // legacy С„РѕСЂРјР°С‚ (С‡С‚РѕР±С‹ confirm/reject С‚РѕС‡РЅРѕ СЂР°Р±РѕС‚Р°Р»Рё)
  last_upsell_code: picked?.item_code,
  last_upsell_item_name: picked?.item_name || picked?.item_code || null,
  last_upsell_text_en: upsellTextEn,
  last_upsell_text: upsellText,
  last_upsell_event_id: shownEvent?.id || null,
  last_upsell_position: positionInFlow,
  last_upsell_strategy: ml.strategy,
  last_upsell_model_version: ml.model_version,
  last_upsell_epsilon: ml.epsilon,
  last_upsell_picked_by: ml.picked_by,
  last_upsell_reason_code: picked?.reason_code ?? reasonCode,
  last_upsell_language: language,
  last_upsell_emotion: emotionVal,
});


  // 5) UI upsell РґР»СЏ С‚РµРєСѓС‰РµРіРѕ РѕС‚РІРµС‚Р°
  // в¬‡пёЏ РїРѕРєР°Р·С‹РІР°РµРј 1вЂ“3 РїСЂРµРґР»РѕР¶РµРЅРёР№ (РЅРѕ РќР• РјРµРЅСЏРµРј СЃР°Рј РІС‹Р±РѕСЂ bandit-СЃС‚СЂР°С‚РµРіРёРё)
  const uiCount = desiredUpsellUiCount(updatedOrder);
  const uiCandidates = buildUiUpsellCandidates({
    upsellPack,
    order: updatedOrder,
    maxCount: uiCount,
  });

  const introTextEn = uiCandidates.length > 1
    ? 'Here are a couple of add-ons that go well with your order:'
    : null;

  const introText = introTextEn
    ? await respondInLanguage({ baseTextEn: introTextEn, targetLanguage: language })
    : upsellText;

  const uiItems = [];
  for (const c of uiCandidates) {
    const code = c?.item_code || c?.itemCode || null;
    if (!code) continue;

    const intentLocal =
      typeof c?.message_intent === 'string' && c.message_intent.trim()
        ? c.message_intent
        : (typeof upsell?.message_intent === 'string' && upsell.message_intent.trim()
            ? upsell.message_intent
            : 'pairing_suggestion');

    const slotsLocal = {
      ...(c?.message_slots || {}),
      base_item_name: upsellBaseName,
      upsell_item_name: c?.item_name || code,
      time_ctx: timeCtx,
      weather,
    };

    const trustTextEn = buildUpsellTextEn({
      intent: intentLocal,
      slots: slotsLocal,
      persona,
      emotion: emotionVal,
      language,
    });

    const trustText = await respondInLanguage({
      baseTextEn: trustTextEn,
      targetLanguage: language,
    });

    uiItems.push({
      // РґР»СЏ assistant-widget.js
      code,
      name: c?.item_name || code,
      trust_text: trustText,

      // РґР»СЏ РґСЂСѓРіРёС… РїРѕС‚СЂРµР±РёС‚РµР»РµР№/Р°РЅР°Р»РёС‚РёРєРё
      itemCode: code,
      itemName: c?.item_name || code,
      trust_text_en: trustTextEn,
      reason_code: c?.reason_code ?? null,
      score: c?.score ?? null,
      source: c?.source ?? null,
    });
  }

  uiUpsell = {
    text: introText,
    items: uiItems,
  };


} else if (skipReason) {
  // Step 7.2: ironclad dataset вЂ” log why we did NOT show upsell
const mlSkipped = normalizeMlMeta(
  upsellPack?.ml ?? upsellPack?.strategy ?? upsellPack?.strategy_name ?? null
);

  const reason = skipReason;
  const mlSkippedFixed =
  upsellPack
    ? mlSkipped
    : normalizeMlMeta({ strategy: 'ml_bandit', model_version: 'heuristic_v1' });

if (process.env.DEBUG_UPSELL === '1') {
  console.log('[Upsell] dialogManager_decision', {
    session_id: session.id,
    upsellCode,
    skipReason,
    last_upsell_code: lastUpsellState?.last_upsell_code ?? null,
    last_upsell_created_at: lastUpsellState?.last_upsell_created_at ?? null,
    positionInFlow,
    maxPerSession: MAX_UPSELL_PER_SESSION,
    minGapMinutes: MIN_GAP_MINUTES,
  });
}


  // order_snapshot (same shape as upsell_shown)
  const orderSnapshot = {
    item_codes: (updatedOrder.items || [])
      .map((it) => it.item_code || it.itemCode)
      .filter(Boolean),
    total_price:
      typeof updatedOrder.total_amount === 'number'
        ? updatedOrder.total_amount
        : parseFloat(updatedOrder.total_amount || '0') || 0,
  };

  await logEvent(
    'upsell_skipped',
    { session, deviceId: deviceId ?? session.device_id },
    {
      restaurant_id: session.restaurant_id,
      device_id: deviceId ?? session.device_id,
      session_id: session.id,
      position_in_flow: positionInFlow,

      meta: { language, emotion: emotionVal },
      ml: mlSkippedFixed,
strategy: mlSkippedFixed.strategy,
model_version: mlSkippedFixed.model_version,
epsilon: mlSkippedFixed.epsilon,
picked_by: mlSkippedFixed.picked_by,
      features: upsellPack?.features ?? null,
      features_v1: upsellPack?.features_v1 ?? null,
      reason_code: upsell?.reason_code ?? null,
      picked: upsell ?? null,
      reason,
      top_candidates: Array.isArray(upsellPack?.top) ? upsellPack.top : null,

      time_context: timeCtx || null,
      weather: weather || null,
      order_snapshot: orderSnapshot,

      // legacy flat (optional, but useful)
      language,
      emotion: emotionVal,
      strategy: mlSkippedFixed.strategy,
      model_version: mlSkippedFixed.model_version,
      epsilon: mlSkippedFixed.epsilon,
      picked_by: mlSkippedFixed.picked_by,
    }
  );

  await clearLastUpsellForSession(session.id);
}







      

      // 4) Allergy warning EN-only
      const allergyWarningEn = await buildAllergyWarningForOrder(
        session,
        nlu,
        updatedOrder,
        deviceMemory
      );
      if (allergyWarningEn) {
        baseTextEn += allergyWarningEn;
      }

      orderForResponse = updatedOrder;

      // ---- Р±Р»РѕРє Р»СЋР±РёРјС‹С… Р±Р»СЋРґ РѕСЃС‚Р°РІР»СЏРµРј РєР°Рє Р±С‹Р» ----
      if (effectiveDeviceId && deviceMemory) {
        const counts = new Map();

        const registerItem = (menuItemId) => {
          if (!menuItemId) return;
          const prev = counts.get(menuItemId) || 0;
          counts.set(menuItemId, prev + 1);
        };

        const mtOrders = mediumTermContext?.orders || [];
        for (const o of mtOrders) {
          for (const it of o.items || []) {
            registerItem(it.menu_item_id);
          }
        }

        for (const it of addedItems || []) {
          registerItem(it.menu_item_id);
        }

        const alreadyFav = new Set(deviceMemory.favoriteItems || []);
        const toAddFavorites = [];

        for (const [menuItemId, cnt] of counts.entries()) {
          if (cnt >= 2 && !alreadyFav.has(menuItemId)) {
            toAddFavorites.push(menuItemId);
          }
        }

        if (toAddFavorites.length > 0) {
          const updatedMemory = await updateDeviceMemory(effectiveDeviceId, {
            addFavoriteItemIds: toAddFavorites,
            touchLastVisit: true,
          });

          deviceMemory.favoriteItems = updatedMemory.favoriteItems;
        }
      }

      const lastAdded = addedItems[addedItems.length - 1];
      if (lastAdded) {
        await upsertDialogState(session.id, {
          lastFocusedOrderItemId: lastAdded.id || null,
          lastFocusedMenuItemId: lastAdded.menu_item_id || null,
          lastFocusedItemCode: lastAdded.item_code || null,
          lastFocusedItemName: lastAdded.item_name || null,
        });
      }

      // 5) Р С‚РѕР»СЊРєРѕ Р·РґРµСЃСЊ РІС‹Р·С‹РІР°РµРј NLG-СЃР»РѕР№
      const reply = await respondInLanguage({
        baseTextEn,
        targetLanguage: language,
      });

      // рџ‘‰ Р’РѕР·РІСЂР°С‰Р°РµРј uiUpsell РЅР°СЂСѓР¶Сѓ
      return {
        nlu,
        handled: true,
        reply,
        order: orderForResponse,
        uiUpsell,
      };
    }




case 'modify_order': {
  if (!order || !order.id) {
    const baseTextEn =
      "You don't have an active order yet. First tell me what you want to order.";

    const reply = await respondInLanguage({
      baseTextEn,
      targetLanguage: language,
    });

    return { nlu, handled: true, reply, order: orderForResponse };
  }

  const actions = resolved?.actions || [];

  // 1) РќРµС‚ actions РѕС‚ РєРѕРЅС‚РµРєСЃС‚РЅРѕРіРѕ СЂРµР·РѕР»СЊРІРµСЂР° вЂ” СЃС‚Р°СЂС‹Р№ РїСѓС‚СЊ
  if (!actions.length) {
    const { order: updatedOrder, removedItems } =
      await handleModifyOrderFromNLU(session, nlu);

    if (!updatedOrder || !removedItems || removedItems.length === 0) {

          // вњ… Safety-net: РµСЃР»Рё NLU СЃРјР°С‚С‡РёР» Р±Р»СЋРґР° (items[].menu_item_id),
    // РЅРѕ modify_order РЅРёС‡РµРіРѕ РЅРµ РёР·РјРµРЅРёР» вЂ” СЌС‚Рѕ РїРѕС‡С‚Рё РІСЃРµРіРґР° "РґРѕР·Р°РєР°Р·", Р° РЅРµ "СЂРµРґР°РєС‚РёСЂРѕРІР°РЅРёРµ".
    const addCandidates = (Array.isArray(nlu?.items) ? nlu.items : [])
      .map((it) => ({
        menuItemId: it?.menu_item_id,
        quantity: Number.isFinite(it?.quantity) ? it.quantity : 1,
      }))
      .filter((x) => !!x.menuItemId);

    if (addCandidates.length > 0) {
      const orderId = order.id;

      const addedItems = [];
      for (const c of addCandidates) {
        try {
          const { item } = await addItemToOrder(orderId, c.menuItemId, {
            quantity: c.quantity && c.quantity > 0 ? c.quantity : 1,
            modifiers: {}, // modifiers РёР· NLU С‚СѓС‚ РјРѕР¶РЅРѕ РґРѕР±Р°РІРёС‚СЊ РїРѕР·Р¶Рµ, СЃРµР№С‡Р°СЃ Р±РµР·РѕРїР°СЃРЅРѕ РїСѓСЃС‚Рѕ
            language,
          });
          if (item) addedItems.push(item);
        } catch (e) {
          console.error('[Dialog][modify_order->add_fallback] addItemToOrder failed', e);
        }
      }

      await recalcOrderTotal(orderId);
      const refreshed = await getOrderWithItemsForChat(orderId);
      orderForResponse = refreshed;

      if (addedItems.length > 0) {
        const addedText = addedItems
          .map((it) => {
            const q = it.quantity ?? 1;
            const name = it.item_name || it.item_code || 'item';
            return `${q} Г— ${name}`;
          })
          .join('\n');

        const total =
          typeof refreshed?.total_amount === 'number'
            ? refreshed.total_amount
            : parseFloat(refreshed?.total_amount || '0') || 0;

        const baseTextEn =
          'Added to your order:\n\n' +
          addedText +
          `\n\nCurrent total: ${total}в‚ґ.\n\nWant to add anything else?`;

        const reply = await respondInLanguage({
          baseTextEn,
          targetLanguage: language,
        });

        const lastAdded = addedItems[addedItems.length - 1];
        if (lastAdded) {
          await upsertDialogState(session.id, {
            lastFocusedOrderItemId: lastAdded.id || null,
            lastFocusedMenuItemId: lastAdded.menu_item_id || null,
            lastFocusedItemCode: lastAdded.item_code || null,
            lastFocusedItemName: lastAdded.item_name || null,
          });
        }

        return { nlu, handled: true, reply, order: orderForResponse };
      }
    }


      const baseTextEn =
        'I tried to update your order, but didnвЂ™t find such items in your current bill. If you want, I can show what is currently in your order.';

      const reply = await respondInLanguage({
        baseTextEn,
        targetLanguage: language,
      });

      return { nlu, handled: true, reply, order: orderForResponse };
    }

    const removedText = removedItems
      .map((item) => {
        const q = item.quantity ?? 1;
        const name = item.item_name || item.item_code || 'item';
        const price =
          typeof item.unit_price === 'number'
            ? `${item.unit_price}в‚ґ`
            : 'per menu';
        return `${q} Г— ${name} (${price})`;
      })
      .join('\n');

    const total =
      typeof updatedOrder.total_amount === 'number'
        ? updatedOrder.total_amount
        : parseFloat(updatedOrder.total_amount || '0') || 0;

    const baseTextEn =
      'I removed from your order:\n\n' +
      removedText +
      '\n\n' +
      `New total amount: ${total}в‚ґ.\n\nIf you want to change anything else вЂ” just type it here.`;

    const reply = await respondInLanguage({
      baseTextEn,
      targetLanguage: language,
    });

    orderForResponse = updatedOrder;
    return { nlu, handled: true, reply, order: orderForResponse };
  }

  // 2) РќРѕРІС‹Р№ РїСѓС‚СЊ: actions РёР· ContextResolver
  const orderId = order.id;

  let fullBefore = order;
  if (!Array.isArray(fullBefore.items)) {
    fullBefore = await getOrderWithItemsForChat(orderId);
  }
  const beforeItemsById = new Map(
    (fullBefore.items || []).map((it) => [it.id, it])
  );

  const removedForReply = [];
  const modifiedForReply = [];

  for (const act of actions) {
    if (!act || !act.type) continue;

    if (act.type === 'remove_item') {
      const { orderItemId } = act.payload || {};
      if (!orderItemId) continue;

      const beforeItem = beforeItemsById.get(orderItemId);
      if (beforeItem) removedForReply.push(beforeItem);

      await removeItemFromOrder(orderId, orderItemId);
    } else if (act.type === 'update_modifiers') {
      const { orderItemId, modifiersPatch } = act.payload || {};
      if (!orderItemId || !modifiersPatch) continue;

      const updatedItem = await updateItemModifiers(orderId, orderItemId, {
        modifiers: modifiersPatch,
      });

      modifiedForReply.push(updatedItem || beforeItemsById.get(orderItemId));
    } else if (act.type === 'increment_quantity') {
      const { orderItemId, delta } = act.payload || {};
      if (!orderItemId || !delta) continue;

      const beforeItem = beforeItemsById.get(orderItemId);
      const prevQty = beforeItem?.quantity ?? 1;
      const newQty = Math.max(1, prevQty + delta);

      const updatedItem = await updateItemQuantity(orderId, orderItemId, {
        quantity: newQty,
      });

      modifiedForReply.push(
        updatedItem || { ...(beforeItem || {}), quantity: newQty }
      );
    } else if (act.type === 'add_item') {
      const { menuItemId, quantity, modifiers } = act.payload || {};
      if (!menuItemId) continue;

      await addItemToOrder(orderId, menuItemId, {
        quantity: quantity && quantity > 0 ? quantity : 1,
        modifiers: modifiers || {},
      });
    }
  }

  await recalcOrderTotal(orderId);
  const updatedOrder = await getOrderWithItemsForChat(orderId);
  orderForResponse = updatedOrder;

  const total =
    typeof updatedOrder.total_amount === 'number'
      ? updatedOrder.total_amount
      : parseFloat(updatedOrder.total_amount || '0') || 0;

  const partsEn = [];

  if (removedForReply.length) {
    const removedText = removedForReply
      .map((item) => {
        const q = item.quantity ?? 1;
        const name = item.item_name || item.item_code || 'item';
        const price =
          typeof item.unit_price === 'number'
            ? `${item.unit_price}в‚ґ`
            : 'per menu';
        return `${q} Г— ${name} (${price})`;
      })
      .join('\n');

    partsEn.push('I removed from your order:\n\n' + removedText);
  }

  if (modifiedForReply.length) {
    const modifiedNames = modifiedForReply.map(
      (item) => item?.item_name || item?.item_code || 'item'
    );

    partsEn.push(
      `I updated: ${modifiedNames.join(
        ', '
      )}.\n(For example, made it spicy or added one more as you asked.)`
    );
  }

  let baseTextEn;
  if (!partsEn.length) {
    baseTextEn =
      'I tried to update your order, but nothing actually changed. If you want, you can clarify what exactly to change.';
  } else {
    partsEn.push(
      `\n\nNew total amount: ${total}в‚ґ.\n\nIf you want to change anything else вЂ” just type it here.`
    );
    baseTextEn = partsEn.join('\n\n');
  }

  const reply = await respondInLanguage({
    baseTextEn,
    targetLanguage: language,
  });

  return { nlu, handled: true, reply, order: orderForResponse };
}

    
case 'submit_order': {
  const activeOrder = await getCurrentActiveOrderForSession(session);

  if (!activeOrder || !Array.isArray(activeOrder.items) || activeOrder.items.length === 0) {
    const baseTextEn =
      "I donвЂ™t see any items in your order yet. Tell me what youвЂ™d like to order, and IвЂ™ll add it for you.";

    const reply = await respondInLanguage({
      baseTextEn,
      targetLanguage: language,
    });

    return {
      nlu,
      handled: true,
      reply,
      order: orderForResponse || activeOrder || null,
    };
  }

  if (
    activeOrder.status === 'submitted' ||
    activeOrder.status === 'in_kitchen' ||
    activeOrder.status === 'ready'
  ) {
    const baseTextEn =
      'Your order has already been submitted to the staff. If you need to change something, please ask a live waiter.';

    const reply = await respondInLanguage({
      baseTextEn,
      targetLanguage: language,
    });

    orderForResponse = activeOrder;
    return { nlu, handled: true, reply, order: orderForResponse };
  }

  try {
    const submittedOrder = await submitOrderForSession(session, activeOrder.id);

    try {
      await sendOrderToStaff(submittedOrder);
    } catch (err) {
      console.error('[DialogManager] Failed to send submitted order to Telegram', err);
    }

    const baseTextEn =
      "Got it, I've submitted your order to the staff. If you need anything else, just let me know.";

    const reply = await respondInLanguage({
      baseTextEn,
      targetLanguage: language,
    });

    orderForResponse = submittedOrder;
    return { nlu, handled: true, reply, order: orderForResponse };
  } catch (err) {
    console.error('[DialogManager] Failed to submit order from dialog', err);

    let baseTextEn;
    if (err.code === 'EMPTY_ORDER') {
      baseTextEn =
        "I canвЂ™t submit an empty order. Please tell me what youвЂ™d like to order.";
    } else if (
      err.code === 'FRAUD_QUANTITY_SINGLE' ||
      err.code === 'FRAUD_QUANTITY_TOTAL'
    ) {
      baseTextEn =
        'This order looks unusually large. Please ask a live waiter to confirm it.';
    } else {
      baseTextEn =
        'Sorry, I couldnвЂ™t submit the order due to a technical issue. Please ask a live waiter to help.';
    }

    const reply = await respondInLanguage({
      baseTextEn,
      targetLanguage: language,
    });

    return {
      nlu,
      handled: true,
      reply,
      order: orderForResponse || activeOrder,
    };
  }
}



case 'cancel_order': {
  const activeOrder = await getCurrentActiveOrderForSession(session);

  let baseTextEn;

  if (!activeOrder) {
    baseTextEn =
      'I donвЂ™t see any active order to cancel right now. If there is already something served, please tell a live waiter.';
  } else if (
    activeOrder.status === 'submitted' ||
    activeOrder.status === 'in_kitchen' ||
    activeOrder.status === 'ready'
  ) {
    baseTextEn =
      'I canвЂ™t cancel an order that has already been sent to the restaurant. Please tell a live waiter about any changes.';
  } else {
    baseTextEn =
      'Your order is still in draft. You can tell me what exactly to change or remove, and IвЂ™ll update it.';
  }

  const reply = await respondInLanguage({
    baseTextEn,
    targetLanguage: language,
  });

  if (activeOrder) {
    orderForResponse = activeOrder;
  }

  return { nlu, handled: true, reply, order: orderForResponse };
}


case 'confirm':
case 'confirm_upsell': {
  const lastUpsell = await getLastUpsellForSession(session.id);

  if (!lastUpsell || !lastUpsell.last_upsell_code) {
    const baseTextEn =
      'I wasnвЂ™t suggesting anything extra right now. If you want to add something, just write what exactly.';

    const reply = await respondInLanguage({
      baseTextEn,
      targetLanguage: language,
    });

    return { nlu, handled: true, reply, order: orderForResponse };
  }

  const itemCode = lastUpsell.last_upsell_code;
  const itemName = lastUpsell.last_upsell_item_name || itemCode;

  const orderDraft = await getOrCreateDraftOrderForSession(session);
  const addedItems = await addDishItemsToOrder(orderDraft.id, [
    { code: itemCode, name: itemName },
  ]);

  await recalcOrderTotal(orderDraft.id);
  const fullOrder = await getOrderWithItemsForChat(orderDraft.id);

    const mlAccepted = normalizeMlMeta({
    strategy: lastUpsell?.last_upsell_strategy,
    model_version: lastUpsell?.last_upsell_model_version,
    epsilon: lastUpsell?.last_upsell_epsilon,
    picked_by: lastUpsell?.last_upsell_picked_by,
  });


  await logEvent(
    'upsell_accepted',
    { session, deviceId: deviceId ?? session.device_id },
    {
      restaurant_id: session.restaurant_id,
      device_id: deviceId ?? session.device_id,
      session_id: session.id || session.session_id || null,

      upsell_event_id: lastUpsell?.last_upsell_event_id || null,
      position_in_flow: lastUpsell?.last_upsell_position || null,
      ml: mlAccepted,
      strategy: mlAccepted.strategy,
      model_version: mlAccepted.model_version,
      epsilon: mlAccepted.epsilon,
      picked_by: mlAccepted.picked_by,
      reason_code: lastUpsell?.last_upsell_reason_code || null,

      language: lastUpsell?.last_upsell_language || language,
      emotion: lastUpsell?.last_upsell_emotion || (nlu.emotion ?? 'neutral'),

      order_id: fullOrder.id,
      accepted_items: (addedItems || []).map((item) => ({
        item_code: item.item_code || item.itemCode || null,
        item_name:
          item.item_name ||
          item.itemName ||
          item.item_code ||
          item.itemCode ||
          null,
        quantity: item.quantity ?? 1,
      })),
      suggested_item_code: itemCode,
      suggested_item_name: itemName,
    }
  );

  await clearLastUpsellForSession(session.id);

  const itemsText = addedItems
    .map((item) => {
      const q = item.quantity ?? 1;
      const name = item.item_name || item.item_code || 'item';
      const price =
        typeof item.unit_price === 'number'
          ? `${item.unit_price}в‚ґ`
          : 'per menu';
      return `${q} Г— ${name} (${price})`;
    })
    .join('\n');

  const total =
    typeof fullOrder.total_amount === 'number'
      ? fullOrder.total_amount
      : parseFloat(fullOrder.total_amount || '0') || 0;

  const baseTextEn =
    `I've added to your order:\n\n${itemsText}\n\n` +
    `Updated total amount: ${total}в‚ґ.\n\n` +
    'If you want to change or add anything else вЂ” just type it here.';

  const reply = await respondInLanguage({
    baseTextEn,
    targetLanguage: language,
  });

  orderForResponse = fullOrder;
  return { nlu, handled: true, reply, order: orderForResponse };
}



case 'reject_upsell': {
  const lastUpsell = await getLastUpsellForSession(session.id);

  const mlRejected = normalizeMlMeta({
    strategy: lastUpsell?.last_upsell_strategy,
    model_version: lastUpsell?.last_upsell_model_version,
    epsilon: lastUpsell?.last_upsell_epsilon,
    picked_by: lastUpsell?.last_upsell_picked_by,
  });

  await logEvent(
    'upsell_rejected',
    { session, deviceId: deviceId ?? session.device_id },
    {
      restaurant_id: session.restaurant_id,
      device_id: deviceId ?? session.device_id,
      session_id: session.id || session.session_id || null,

      upsell_event_id: lastUpsell?.last_upsell_event_id || null,
      suggested_item_code: lastUpsell?.last_upsell_code || null,

      position_in_flow: lastUpsell?.last_upsell_position || null,
            ml: mlRejected,
      strategy: mlRejected.strategy,
      model_version: mlRejected.model_version,
      epsilon: mlRejected.epsilon,
      picked_by: mlRejected.picked_by,

      reason_code: lastUpsell?.last_upsell_reason_code || null,

      language: lastUpsell?.last_upsell_language || language,
      emotion: lastUpsell?.last_upsell_emotion || (nlu.emotion ?? 'neutral'),
    }
  );

  await clearLastUpsellForSession(session.id);

  const baseTextEn =
    'No problem, we keep your order as it is рџ™‚ If you want to add something later вЂ” just type it here.';

  const reply = await respondInLanguage({
    baseTextEn,
    targetLanguage: language,
  });

  return { nlu, handled: true, reply, order: orderForResponse };
}



case 'info': {
  if (isConversationalDishQuestion(normalizedText)) {
    const mi = await resolveItemDetailsForConversation({
      session,
      language,
      normalizedText,
      nlu,
      dialogState,
    });
    if (mi && mi.is_active !== false) {
      const baseTextEn = buildDishExplainTextEn(mi, normalizedText);
      const reply = await respondInLanguage({
        baseTextEn,
        targetLanguage: language,
      });
      return { nlu, handled: true, reply, order: orderForResponse };
    }
  }

  const baseTextEn =
    'Ask me anything about the menu, ingredients or the ordering format вЂ” IвЂ™ll try to answer.';

  const reply = await respondInLanguage({
    baseTextEn,
    targetLanguage: language,
  });

  return { nlu, handled: true, reply, order: orderForResponse };
}


case 'unknown':
default: {
  const baseTextEn =
    'I didnвЂ™t fully understand your request yet. Could you phrase it more simply? For example: вЂњI want a lemonadeвЂќ, вЂњRecommend a dessertвЂќ or вЂњIвЂ™m allergic to nutsвЂќ.';

  const reply = await respondInLanguage({
    baseTextEn,
    targetLanguage: language,
  });

  return { nlu, handled: false, reply, order: orderForResponse };
}

  }
}



export async function handleUserMessage({ sessionToken, text, source, clientLanguage }) {
  const dmStart = Date.now(); // РІСЂРµРјСЏ РЅР°С‡Р°Р»Р° СЂР°Р±РѕС‚С‹ Dialog Manager
  const rawText = (text || '').toString();
  const normalizedSource = source || 'chat';

  if (!sessionToken) {
    return {
      replyText:
        'Session is missing or expired. Please scan the QR code on your table again.',
      actions: {
        showOrderPreview: false,
        submitAvailable: false,
        upsellSuggestions: [],
      },
      nlu: null,
      order: null,
    };
  }

  const session = await getSessionByToken(sessionToken);
  if (!session) {
    return {
      replyText:
        'Your session has expired. Please scan the QR code on your table again to start a new session.',
      actions: {
        showOrderPreview: false,
        submitAvailable: false,
        upsellSuggestions: [],
      },
      nlu: null,
      order: null,
    };
  }

  // РћР±РЅРѕРІР»СЏРµРј last_activity, РєР°Рє СЂР°РЅСЊС€Рµ РґРµР»Р°Р» sessionAuth
  try {
    await touchSession(session.id);
  } catch (err) {
    console.error('[DialogManager] Failed to touch session', err);
  }

  const deviceId = session.device_id || null;

  let deviceProfile = null;
  if (deviceId) {
    try {
      deviceProfile = await getDeviceProfile(deviceId, { createIfMissing: true });
    } catch (err) {
      console.error('[DialogManager] Failed to load device profile', err);
    }
  }

  // ---------- РљР›Р®Р§Р•Р’РћР•: current_order (draft / submitted) ----------

// ---------- РљР›Р®Р§Р•Р’РћР•: current_order (draft / submitted) ----------

let currentOrder = null;

try {
  // РџС‹С‚Р°РµРјСЃСЏ РЅР°Р№С‚Рё РїРѕСЃР»РµРґРЅРёР№ В«Р°РєС‚РёРІРЅС‹Р№В» Р·Р°РєР°Р· РґР»СЏ СЃРµСЃСЃРёРё (draft/submitted/in_kitchen/ready).
  // Р’РђР–РќРћ: РјРѕРґРёС„РёС†РёСЂРѕРІР°С‚СЊ С‡РµСЂРµР· С‡Р°С‚ РјРѕР¶РЅРѕ РўРћР›Р¬РљРћ draft.
  currentOrder = await getCurrentActiveOrderForSession(session);
} catch (err) {
  console.error('[DialogManager] Failed to get current active order', err);
}

// Р•СЃР»Рё РїРѕСЃР»РµРґРЅРёР№ Р°РєС‚РёРІРЅС‹Р№ Р·Р°РєР°Р· СѓР¶Рµ РЅРµ draft (РЅР°РїСЂРёРјРµСЂ, РїРѕСЃР»Рµ submit) вЂ” РЅР°С‡РёРЅР°РµРј РЅРѕРІС‹Р№ draft.
// Р­С‚Рѕ РїРѕР·РІРѕР»СЏРµС‚ РїРѕР»СЊР·РѕРІР°С‚РµР»СЋ РґРµР»Р°С‚СЊ СЃРєРѕР»СЊРєРѕ СѓРіРѕРґРЅРѕ Р·Р°РєР°Р·РѕРІ РІ СЂР°РјРєР°С… РѕРґРЅРѕР№ СЃРµСЃСЃРёРё.
if (currentOrder && currentOrder.status !== 'draft') {
  try {
    currentOrder = await getOrCreateDraftOrderForSession(session);
  } catch (err) {
    console.error(
      '[DialogManager] Failed to get/create draft order after non-draft active order',
      err
    );
  }
}

// Р•СЃР»Рё РІРѕРѕР±С‰Рµ РЅРµС‚ Р·Р°РєР°Р·Р° вЂ” СЃРѕР·РґР°С‘Рј РЅРѕРІС‹Р№ draft
if (!currentOrder) {
  try {
    currentOrder = await getOrCreateDraftOrderForSession(session);
  } catch (err) {
    console.error('[DialogManager] Failed to create draft order for session', err);
  }
}


  // Р•СЃР»Рё РІРѕРѕР±С‰Рµ РЅРµС‚ Р·Р°РєР°Р·Р° вЂ” СЃРѕР·РґР°С‘Рј РЅРѕРІС‹Р№ draft
  if (!currentOrder) {
    try {
      currentOrder = await getOrCreateDraftOrderForSession(session);
    } catch (err) {
      console.error('[DialogManager] Failed to create draft order for session', err);
    }
  }

  // ---------------------------------------------------------------

  // Р›РѕРіРёСЂСѓРµРј РІС…РѕРґСЏС‰РµРµ СЃРѕРѕР±С‰РµРЅРёРµ
  try {
    await logEvent(
      'chat_message_in',
      { session, deviceId },
      { text: rawText, source: normalizedSource }
    );
  } catch (err) {
    console.error('[DialogManager] Failed to log chat_message_in', err);
  }

  // Р’СЃСЏ РѕСЃРЅРѕРІРЅР°СЏ Р»РѕРіРёРєР° вЂ” РІРЅСѓС‚СЂРё processUserMessage
  const result = await processUserMessage({
    text: rawText,
    session,
    deviceProfile,
    order: currentOrder,
    deviceId,
    clientLanguage,
  });

  const finalOrder = result.order || currentOrder || null;

  // Upsell suggestions РёР· dialog_state
    // Upsell suggestions РёР· dialog_state
  let upsellSuggestions = [];
  let upsellTextEnFromState = null;
  let lastUpsell = null;

  try {
    lastUpsell = await getLastUpsellForSession(session.id);
    if (lastUpsell && lastUpsell.last_upsell_code) {
      upsellSuggestions.push({
        itemCode: lastUpsell.last_upsell_code,
        itemName:
          lastUpsell.last_upsell_item_name || lastUpsell.last_upsell_code,
      });

      if (lastUpsell.last_upsell_text_en) {
        upsellTextEnFromState = lastUpsell.last_upsell_text_en;
      }
    }
  } catch (err) {
    console.error(
      '[DialogManager] Failed to read last upsell for actions',
      err
    );
  }


  const hasItems =
    !!finalOrder && Array.isArray(finalOrder.items) && finalOrder.items.length > 0;

  const actions = {
    showOrderPreview: hasItems,
    submitAvailable: hasItems && finalOrder.status === 'draft',
    upsellSuggestions,
  };

  const replyText = result.reply ?? null;

  // рџ”№ Р·Р°Р±РёСЂР°РµРј uiUpsell РёР· result, РµСЃР»Рё РєРµР№СЃ order/add_to_order РµРіРѕ РІРµСЂРЅСѓР»
  const uiUpsell = result.uiUpsell || null;

    // вњ… NEW: recommendations from ask_menu (for UI cards)
  const recommendations = Array.isArray(result?.recommendations)
    ? dedupeByCode(result.recommendations)
    : null;


  // рџ”№ РќРѕРІС‹Р№: orderDraft РґР»СЏ РєР°СЂС‚РѕС‡РµРє
  const orderDraft =
    finalOrder && finalOrder.status === 'draft'
      ? buildOrderDraftForResponse(finalOrder)
      : null;

  // рџ”№ РќРѕРІС‹Р№: upsell-Р±Р»РѕРє РґР»СЏ UI
  let upsell = null;

  // 1) Р’ РїСЂРёРѕСЂРёС‚РµС‚Рµ вЂ” uiUpsell РґР»СЏ С‚РµРєСѓС‰РµРіРѕ СЃРѕРѕР±С‰РµРЅРёСЏ
  if (
    uiUpsell &&
    Array.isArray(uiUpsell.items) &&
    uiUpsell.items.length > 0
  ) {
    upsell = {
      text: uiUpsell.text || null,
      items: dedupeByCode(
        uiUpsell.items.map((u) => ({
        code: u.itemCode || u.code,
        name:
          u.itemName ||
          u.name ||
          u.itemCode ||
          u.code ||
          'Р‘РµР· РЅР°Р·РІРё',
        }))
      ),
    };
  } else if (upsellSuggestions.length > 0) {
    // 2) Fallback вЂ” РёР· dialog_state (РЅР°РїСЂРёРјРµСЂ, РЅР° СЃР»РµРґСѓСЋС‰РµРј С€Р°РіРµ, РєРѕРіРґР° РіРѕСЃС‚СЊ РѕС‚РІРµС‡Р°РµС‚ "РґР°, РґР°РІР°Р№")
     upsell = {
    text: lastUpsell?.last_upsell_text || upsellTextEnFromState || null,  // вњ… РІРѕС‚ С‚Р°Рє
    items: dedupeByCode(
      upsellSuggestions.map((u) => ({
        code: u.itemCode,
        name: u.itemName,
      }))
    ),
    };
  }


  // рџ”№ РќРѕРІС‹Р№: meta.language вЂ” РїРѕ РґР°РЅРЅС‹Рј NLU
  const meta = {
    language:
      result?.nlu?.meta?.response_language ||
      result?.nlu?.response_language ||
      result?.nlu?.meta?.language ||
      result?.nlu?.language ||
      null,
  };

  // рџ”№ РќРћР’Р«Р™ Р‘Р›РћРљ: РѕР±РѕРіР°С‰Р°РµРј orderDraft Рё upsell С†РµРЅРѕР№ Рё С„РѕС‚Рѕ РёР· РјРµРЅСЋ
  try {
    const restaurantId = session.restaurant_id;
    const codesSet = new Set();

    // РЎРѕР±РёСЂР°РµРј РІСЃРµ item_code РёР· РґСЂР°С„С‚Р° Р·Р°РєР°Р·Р°
    if (orderDraft && Array.isArray(orderDraft.items)) {
      for (const it of orderDraft.items) {
        if (it.code) {
          codesSet.add(it.code);
        }
      }
    }

    // Р РёР· Р°РїСЃРµР»Р°
    if (upsell && Array.isArray(upsell.items)) {
      for (const u of upsell.items) {
        if (u.code) {
          codesSet.add(u.code);
        }
      }
    }

        // вњ… And from recommendations (ask_menu UI cards)
    if (recommendations && Array.isArray(recommendations)) {
      for (const r of recommendations) {
        const code = r?.code || r?.item_code;
        if (code) codesSet.add(code);
      }
    }


    if (restaurantId && codesSet.size > 0) {
      const codes = Array.from(codesSet);

      // РўСЏРЅРµРј Р±Р°Р·РѕРІСѓСЋ С†РµРЅСѓ Рё С„РѕС‚Рѕ РїРѕ РєРѕРґР°Рј
      const menuItems = await getMenuItemsBasicByCodes(restaurantId, codes);

      const metaByCode = {};
      for (const row of menuItems) {
        let photos = row.photos;

        // РќР° РІСЃСЏРєРёР№ СЃР»СѓС‡Р°Р№, РµСЃР»Рё РґСЂР°Р№РІРµСЂ РІРµСЂРЅСѓР» СЃС‚СЂРѕРєСѓ JSON
        if (typeof photos === 'string') {
          try {
            photos = JSON.parse(photos);
          } catch {
            photos = [];
          }
        }

        metaByCode[row.item_code] = {
          unitPrice:
            row.base_price != null ? Number(row.base_price) : null,
          imageUrl:
            Array.isArray(photos) && photos.length > 0 ? photos[0] : null,
        };
      }

      // РћР±РѕРіР°С‰Р°РµРј orderDraft.items
      if (orderDraft && Array.isArray(orderDraft.items)) {
        orderDraft.items = orderDraft.items.map((it) => {
          const meta = metaByCode[it.code] || {};
          return {
            ...it,
            // РїСЂРёРѕСЂРёС‚РµС‚: С†РµРЅР° РёР· Р·Р°РєР°Р·Р° (РІРґСЂСѓРі СЃРєРёРґРєР°/СЂСѓС‡РЅР°СЏ С†РµРЅР°),
            // РµСЃР»Рё РµС‘ РЅРµС‚ вЂ” Р±РµСЂС‘Рј РёР· РјРµРЅСЋ
            unitPrice:
              typeof it.unitPrice === 'number' && !Number.isNaN(it.unitPrice)
                ? it.unitPrice
                : meta.unitPrice ?? it.unitPrice ?? null,
            imageUrl: meta.imageUrl || null,
          };
        });
      }

      // РћР±РѕРіР°С‰Р°РµРј upsell.items
      if (upsell && Array.isArray(upsell.items)) {
        upsell.items = upsell.items.map((u) => {
          const meta = metaByCode[u.code] || {};
          return {
            ...u,
            unitPrice: meta.unitPrice ?? null,
            imageUrl: meta.imageUrl || null,
          };
        });
      }
            // вњ… Enrich recommendations (ask_menu UI cards)
      if (recommendations && Array.isArray(recommendations)) {
        for (const r of recommendations) {
          const code = r?.code || r?.item_code;
          if (!code) continue;

          const meta = metaByCode[code] || {};

          // fill missing fields from menu
          if (r.unitPrice == null && meta.unitPrice != null) r.unitPrice = meta.unitPrice;
          if (!r.imageUrl && meta.imageUrl) r.imageUrl = meta.imageUrl;

          // normalize
          if (!r.code) r.code = code;
          if (!r.name) r.name = code;
        }
      }

    }
  } catch (err) {
    console.error(
      '[DialogManager] Failed to enrich orderDraft/upsell with price/image',
      err
    );
  }

  // Р›РѕРіРёСЂСѓРµРј РёСЃС…РѕРґСЏС‰РµРµ СЃРѕРѕР±С‰РµРЅРёРµ
  try {
    await logEvent(
      'chat_message_out',
      { session, deviceId },
      { reply: replyText, actions }
    );
  } catch (err) {
    console.error('[DialogManager] Failed to log chat_message_out', err);
  }

  // в¬‡пёЏ Р›РѕРіРёСЂСѓРµРј РІСЂРµРјСЏ СЂР°Р±РѕС‚С‹ Dialog Manager
  try {
    await insertPerformanceMetric({
      metricName: 'dialog.handleUserMessage',
      scope: normalizedSource,
      durationMs: Date.now() - dmStart,
      labels: {
        source: normalizedSource,
        has_error: false,
      },
      meta: {
        session_id: session?.id || null,
        restaurant_id: session?.restaurant_id || null,
        intent: result?.nlu?.intent || null,
        language: meta.language || null,
      },
    });
  } catch (err) {
    console.error('[DialogManager] Failed to log performance metric', err);
  }
  // в¬†пёЏ РєРѕРЅРµС† Р±Р»РѕРєР° РјРµС‚СЂРёРє

  const localizedPayload = await localizeUiPayloadBatch({
    targetLanguage: meta.language || null,
    replyText,
    orderDraft,
    upsell,
    recommendations: recommendations && recommendations.length ? recommendations : null,
    customCategories: Array.isArray(result?.customCategories) ? result.customCategories : [],
  });

  const originalReplyText = (replyText ?? '').toString();
  const localizedReplyText = (localizedPayload.replyText ?? '').toString();
  const safeReplyText = localizedReplyText.trim()
    ? localizedReplyText
    : originalReplyText;

    return {
    replyText: safeReplyText,
    actions,
    nlu: result.nlu ?? null,
    order: finalOrder,   // legacy-С„РѕСЂРјР°С‚
    orderDraft: localizedPayload.orderDraft,          // РЅРѕРІС‹Р№ Р±Р»РѕРє РґР»СЏ РєР°СЂС‚РѕС‡РµРє
    upsell: localizedPayload.upsell,              // СѓР¶Рµ СЃ unitPrice + imageUrl
    recommendations: localizedPayload.recommendations && localizedPayload.recommendations.length
      ? localizedPayload.recommendations
      : null,
    customCategories: Array.isArray(localizedPayload.customCategories) && localizedPayload.customCategories.length
      ? localizedPayload.customCategories
      : null,
    meta,
  };

}


