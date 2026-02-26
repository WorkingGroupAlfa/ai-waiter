// backend/src/models/upsellRulesModel.js
import { query } from '../db.js';

const ALLOWED_TYPES = new Set(['item_to_item', 'category_to_item', 'tag_to_item']);

function normInt(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? n : null;
}

function normNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normText(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function normTextArray(v) {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.map(x => String(x).trim()).filter(Boolean);
  // allow "chat,voice"
  return String(v)
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);
}

function normJson(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(String(v));
  } catch {
    return null;
  }
}

export async function getUpsellRuleById(id) {
  const res = await query(`SELECT * FROM upsell_rules WHERE id = $1`, [id]);
  return res.rows[0] || null;
}

export async function listUpsellRules({
  restaurantId,
  page = 1,
  limit = 50,
  isActive = null,
  ruleType = null,
} = {}) {
  if (!restaurantId) throw new Error('restaurantId is required');

  const p = Math.max(1, normInt(page) || 1);
  const l = Math.max(1, Math.min(200, normInt(limit) || 50));
  const offset = (p - 1) * l;

  const where = ['restaurant_id = $1'];
  const params = [restaurantId];
  let idx = 2;

  if (typeof isActive === 'boolean') {
    where.push(`is_active = $${idx++}`);
    params.push(isActive);
  }

  if (ruleType && ALLOWED_TYPES.has(String(ruleType))) {
    where.push(`rule_type = $${idx++}`);
    params.push(String(ruleType));
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totalRes = await query(
    `SELECT COUNT(*)::int AS total FROM upsell_rules ${whereSql}`,
    params
  );

  const rowsRes = await query(
    `
    SELECT *
    FROM upsell_rules
    ${whereSql}
    ORDER BY is_active DESC, priority DESC, id DESC
    LIMIT $${idx++} OFFSET $${idx++}
    `,
    [...params, l, offset]
  );

  return {
    page: p,
    limit: l,
    total: totalRes.rows[0]?.total || 0,
    rows: rowsRes.rows || [],
  };
}

export async function createUpsellRule(payload = {}) {
  const restaurant_id = normText(payload.restaurant_id || payload.restaurantId);
  const rule_type = normText(payload.rule_type);
  if (!restaurant_id) throw new Error('restaurant_id is required');
  if (!rule_type || !ALLOWED_TYPES.has(rule_type)) throw new Error('rule_type is invalid');

  const row = {
    restaurant_id,
    is_active: typeof payload.is_active === 'boolean' ? payload.is_active : true,
    rule_type,

    trigger_item_code: normText(payload.trigger_item_code),
    trigger_category_id: normText(payload.trigger_category_id),
    trigger_tag: normText(payload.trigger_tag),

    suggested_item_code: normText(payload.suggested_item_code),
    priority: normInt(payload.priority) ?? 0,
    weight: normNum(payload.weight) ?? 0.6,
    reason_code: normText(payload.reason_code),

    max_per_session: normInt(payload.max_per_session),
    cooldown_minutes: normInt(payload.cooldown_minutes),
    min_order_total: normNum(payload.min_order_total),
    time_windows: normJson(payload.time_windows),
    channels: normTextArray(payload.channels),
  };

  if (!row.suggested_item_code) throw new Error('suggested_item_code is required');

  const cols = Object.keys(row);
  const vals = Object.values(row);
  const ph = cols.map((_, i) => `$${i + 1}`);

  const res = await query(
    `
    INSERT INTO upsell_rules (${cols.join(', ')})
    VALUES (${ph.join(', ')})
    RETURNING *
    `,
    vals
  );

  return res.rows[0];
}

export async function updateUpsellRule(id, patch = {}) {
  const existing = await getUpsellRuleById(id);
  if (!existing) throw new Error('Rule not found');

  const allowed = new Set([
    'is_active',
    'rule_type',
    'trigger_item_code',
    'trigger_category_id',
    'trigger_tag',
    'suggested_item_code',
    'priority',
    'weight',
    'reason_code',
    'max_per_session',
    'cooldown_minutes',
    'min_order_total',
    'time_windows',
    'channels',
  ]);

  const keys = Object.keys(patch || {}).filter(k => allowed.has(k));
  if (!keys.length) return existing;

  const set = [];
  const params = [];
  let idx = 1;

  for (const k of keys) {
    let v = patch[k];

    if (k === 'rule_type') {
      v = normText(v);
      if (!v || !ALLOWED_TYPES.has(v)) throw new Error('rule_type is invalid');
    } else if (k === 'is_active') {
      v = Boolean(v);
    } else if (k === 'priority' || k === 'max_per_session' || k === 'cooldown_minutes') {
      v = normInt(v);
    } else if (k === 'weight' || k === 'min_order_total') {
      v = normNum(v);
    } else if (k === 'time_windows') {
      v = normJson(v);
    } else if (k === 'channels') {
      v = normTextArray(v);
    } else {
      v = normText(v);
    }

    set.push(`${k} = $${idx++}`);
    params.push(v);
  }

  params.push(id);

  const res = await query(
    `
    UPDATE upsell_rules
    SET ${set.join(', ')},
        updated_at = NOW()
    WHERE id = $${idx}
    RETURNING *
    `,
    params
  );

  return res.rows[0];
}

export async function deleteUpsellRule(id) {
  await query(`DELETE FROM upsell_rules WHERE id = $1`, [id]);
  return { ok: true };
}

export async function toggleUpsellRule(id, isActive = null) {
  const existing = await getUpsellRuleById(id);
  if (!existing) throw new Error('Rule not found');

  const next = typeof isActive === 'boolean' ? isActive : !existing.is_active;

  const res = await query(
    `
    UPDATE upsell_rules
    SET is_active = $1,
        updated_at = NOW()
    WHERE id = $2
    RETURNING *
    `,
    [next, id]
  );

  return res.rows[0];
}

export async function duplicateUpsellRule(id) {
  const existing = await getUpsellRuleById(id);
  if (!existing) throw new Error('Rule not found');

  const res = await query(
    `
    INSERT INTO upsell_rules (
      restaurant_id, is_active, rule_type,
      trigger_item_code, trigger_category_id, trigger_tag,
      suggested_item_code,
      priority, weight, reason_code,
      max_per_session, cooldown_minutes, min_order_total, time_windows, channels
    )
    SELECT
      restaurant_id, is_active, rule_type,
      trigger_item_code, trigger_category_id, trigger_tag,
      suggested_item_code,
      priority, weight, reason_code,
      max_per_session, cooldown_minutes, min_order_total, time_windows, channels
    FROM upsell_rules
    WHERE id = $1
    RETURNING *
    `,
    [id]
  );

  return res.rows[0];
}
