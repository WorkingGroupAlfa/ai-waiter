// backend/src/services/upsellCandidateService.js
import { query } from '../db.js';
import { getActiveMenuItemsByCodes } from '../models/menuModel.js';

/**
 * Reads DB rules and produces candidates in unified format:
 * { itemCode, reason_code, source: { type:'upsell_rule', id }, base_weight, priority }
 *
 * Constraints supported:
 * - channels: TEXT[] (if set -> must include provided channel)
 * - min_order_total
 * - max_per_session: counts upsell_shown events within session for this suggested item
 * - cooldown_minutes: checks last upsell_shown for this suggested item
 * - time_windows: JSON (best-effort) supports:
 *   - { ranges: [{ start:"HH:MM", end:"HH:MM", days:[0..6] or [1..7] }] }
 *   - or an array directly: [{start,end,days}]
 */
export async function getRuleBasedUpsellCandidates({
  order,
  session,
  channel = 'chat',
  now = new Date(),
} = {}) {
  if (!order || !session?.restaurant_id) return [];

  const restaurantId = session.restaurant_id;

  const orderItems = Array.isArray(order.items) ? order.items : [];
  const orderedCodes = new Set(
    orderItems.map(it => it.item_code || it.itemCode).filter(Boolean)
  );

  if (orderedCodes.size === 0) return [];

  // Fetch menu metadata for ordered items -> categories + tags
  const meta = await getActiveMenuItemsByCodes(restaurantId, Array.from(orderedCodes));
  const categories = new Set();
  const tags = new Set();

  for (const m of meta || []) {
    if (m?.category) categories.add(String(m.category));
    if (Array.isArray(m?.tags)) {
      for (const t of m.tags) if (t) tags.add(String(t));
    }
  }

  const itemCodesArr = Array.from(orderedCodes);
  const categoriesArr = Array.from(categories);
  const tagsArr = Array.from(tags);

  // If no metadata, still allow item_to_item rules
  const res = await query(
    `
    SELECT *
    FROM upsell_rules
    WHERE restaurant_id = $1
      AND is_active = TRUE
      AND (
        (rule_type = 'item_to_item' AND trigger_item_code = ANY($2::text[]))
        OR
        (rule_type = 'category_to_item' AND trigger_category_id = ANY($3::text[]))
        OR
        (rule_type = 'tag_to_item' AND trigger_tag = ANY($4::text[]))
      )
    ORDER BY priority DESC, weight DESC, id DESC
    `,
    [restaurantId, itemCodesArr, categoriesArr.length ? categoriesArr : ['__none__'], tagsArr.length ? tagsArr : ['__none__']]
  );

  const rules = res.rows || [];
  if (!rules.length) return [];

  const out = [];
  for (const r of rules) {
    const suggested = r?.suggested_item_code ? String(r.suggested_item_code) : null;
    if (!suggested) continue;

    // Don't suggest if already in order
    if (orderedCodes.has(suggested)) continue;

    // constraints: channels
    if (Array.isArray(r.channels) && r.channels.length > 0) {
      const ok = r.channels.map(String).includes(String(channel));
      if (!ok) continue;
    }

    // constraints: min_order_total
    if (r.min_order_total !== null && r.min_order_total !== undefined) {
      const total = Number(order.total_amount ?? order.totalAmount ?? 0);
      if (Number.isFinite(total) && total < Number(r.min_order_total)) continue;
    }

    // constraints: time_windows (best effort)
    if (r.time_windows) {
      const ok = isNowInTimeWindows(now, r.time_windows);
      if (!ok) continue;
    }

    // constraints: max_per_session / cooldown_minutes via events
    const sessionId = session.id;
    if (sessionId) {
      if (r.max_per_session !== null && r.max_per_session !== undefined) {
        const cnt = await countShownForItemInSession(sessionId, suggested);
        if (cnt >= Number(r.max_per_session)) continue;
      }

      if (r.cooldown_minutes !== null && r.cooldown_minutes !== undefined) {
        const lastTs = await getLastShownTsForItemInSession(sessionId, suggested);
        if (lastTs) {
          const diffMin = (now.getTime() - lastTs.getTime()) / 60000;
          if (diffMin < Number(r.cooldown_minutes)) continue;
        }
      }
    }

    out.push({
  itemCode: suggested,
  reason_code: r.reason_code || 'rule_based',
  // IMPORTANT: keep reason_code/source for analytics only.
  // For safe NLG we still want to know the trigger (tells us what the suggestion is "based on").
  source: {
    type: 'upsell_rule',
    id: r.id,
    rule_type: r.rule_type || null,
    trigger_item_code: r.trigger_item_code || null,
    trigger_category_id: r.trigger_category_id || null,
    trigger_tag: r.trigger_tag || null,
  },
  base_weight: Number(r.weight ?? 0.6),
  priority: Number(r.priority ?? 0),
});

  }

  return out;
}

/**
 * Co-occurrence candidates from upsell_related_stats (admin-enabled rows only).
 * Unified format:
 * { itemCode, reason_code, source:{ type:'cooccur', kind:'cooccur', a_item_code, b_item_code }, base_weight, priority }
 */
export async function getCooccurUpsellCandidates({
  order,
  session,
  topMPerA = 3,
} = {}) {
  if (!order || !session?.restaurant_id) return [];

  const restaurantId = session.restaurant_id;

  const orderItems = Array.isArray(order.items) ? order.items : [];
  const orderedCodes = Array.from(
    new Set(orderItems.map(it => it.item_code || it.itemCode).filter(Boolean))
  );

  if (orderedCodes.length === 0) return [];

  const M = Math.max(1, Math.min(20, Number(topMPerA) || 3));

  // Берём top-M для каждого A, только enabled, и учитываем boost_weight
  // score = confidence * boost_weight (простая и прозрачная формула)
  const res = await query(
    `
    WITH ranked AS (
      SELECT
        restaurant_id,
        a_item_code,
        b_item_code,
        support,
        confidence,
        lift,
        last_30d_support,
        is_enabled,
        boost_weight,
        (confidence * boost_weight) AS score,
        ROW_NUMBER() OVER (
          PARTITION BY a_item_code
          ORDER BY (confidence * boost_weight) DESC, support DESC, lift DESC, b_item_code ASC
        ) AS rn
      FROM upsell_related_stats
      WHERE restaurant_id = $1
        AND is_enabled = TRUE
        AND a_item_code = ANY($2::text[])
    )
    SELECT *
    FROM ranked
    WHERE rn <= $3
    ORDER BY a_item_code, rn
    `,
    [restaurantId, orderedCodes, M]
  );

  const rows = res.rows || [];
  if (rows.length === 0) return [];

  // Дедуп по suggested item: если один и тот же B пришёл из разных A — оставляем лучший score
  const bestByB = new Map();

  for (const r of rows) {
    const suggested = String(r.b_item_code || '').trim();
    if (!suggested) continue;

    // не предлагаем то, что уже в заказе
    if (orderedCodes.includes(suggested)) continue;

    const baseWeight = Number(r.score ?? 0);
    const cand = {
      itemCode: suggested,
      reason_code: 'cooccur',
      source: {
        type: 'cooccur',
        kind: 'cooccur',
        a_item_code: r.a_item_code,
        b_item_code: r.b_item_code,
        support: Number(r.support ?? 0),
        confidence: Number(r.confidence ?? 0),
        lift: Number(r.lift ?? 0),
      },
      base_weight: baseWeight,
      priority: 0,
    };

    const prev = bestByB.get(suggested);
    if (!prev || (cand.base_weight > prev.base_weight)) {
      bestByB.set(suggested, cand);
    }
  }

  // Можно дополнительно отфильтровать по “активности” меню (если хочешь строго)
  // Я сделал мягко: если меню-таблица есть и функция доступна — оставляем только реально существующие items.
  try {
    const codes = Array.from(bestByB.keys());
    if (codes.length) {
      const active = await getActiveMenuItemsByCodes(restaurantId, codes);
      const activeSet = new Set((active || []).map(x => x.item_code || x.itemCode).filter(Boolean));
      for (const code of codes) {
        if (!activeSet.has(code)) bestByB.delete(code);
      }
    }
  } catch (_) {
    // если что-то не так с меню-слоем — НЕ ломаем выдачу
  }

  return Array.from(bestByB.values()).sort(
    (a, b) => (b.base_weight - a.base_weight) || a.itemCode.localeCompare(b.itemCode)
  );
}


async function countShownForItemInSession(sessionId, itemCode) {
  const res = await query(
    `
    SELECT COUNT(*)::int AS cnt
    FROM events
    WHERE session_id = $1
      AND event_type = 'upsell_shown'
      AND (
        payload->>'suggested_item_code' = $2
        OR payload->'picked'->>'item_code' = $2
      )
    `,
    [sessionId, itemCode]
  );
  return res.rows[0]?.cnt ?? 0;
}

async function getLastShownTsForItemInSession(sessionId, itemCode) {
  const res = await query(
    `
    SELECT created_at
    FROM events
    WHERE session_id = $1
      AND event_type = 'upsell_shown'
      AND (
        payload->>'suggested_item_code' = $2
        OR payload->'picked'->>'item_code' = $2
      )
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [sessionId, itemCode]
  );
  const ts = res.rows[0]?.created_at;
  return ts ? new Date(ts) : null;
}

function isNowInTimeWindows(now, timeWindows) {
  let ranges = null;

  if (Array.isArray(timeWindows)) ranges = timeWindows;
  else if (timeWindows && Array.isArray(timeWindows.ranges)) ranges = timeWindows.ranges;

  if (!ranges || !ranges.length) return true;

  const day = now.getDay(); // 0..6
  const mins = now.getHours() * 60 + now.getMinutes();

  for (const r of ranges) {
    const start = parseHHMM(r?.start);
    const end = parseHHMM(r?.end);
    if (start === null || end === null) continue;

    // days can be [0..6] or [1..7]
    let days = Array.isArray(r?.days) ? r.days : null;
    if (days && days.length) {
      const normDays = days.map(Number).map(d => (d === 7 ? 0 : d)); // 7->0 for Sunday
      if (!normDays.includes(day)) continue;
    }

    // handle overnight windows
    if (start <= end) {
      if (mins >= start && mins <= end) return true;
    } else {
      if (mins >= start || mins <= end) return true;
    }
  }

  return false;
}

function parseHHMM(x) {
  if (!x) return null;
  const s = String(x).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}
