// backend/src/models/upsellRelatedStatsModel.js
import { query } from '../db.js';
import { createUpsellRule } from './upsellRulesModel.js';

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

export async function listUpsellRelatedStats({
  restaurantId,
  aItemCode = null,
  minSupport = null,
  minConfidence = null,
  isEnabled = null,
  page = 1,
  limit = 100,
} = {}) {
  if (!restaurantId) throw new Error('restaurantId is required');

  const p = Math.max(1, normInt(page) || 1);
  const l = Math.max(1, Math.min(500, normInt(limit) || 100));
  const offset = (p - 1) * l;

  const where = ['restaurant_id = $1'];
  const params = [restaurantId];
  let idx = 2;

  const a = normText(aItemCode);
  if (a) {
    where.push(`a_item_code = $${idx++}`);
    params.push(a);
  }

  const ms = normNum(minSupport);
  if (ms !== null) {
    where.push(`support >= $${idx++}`);
    params.push(ms);
  }

  const mc = normNum(minConfidence);
  if (mc !== null) {
    where.push(`confidence >= $${idx++}`);
    params.push(mc);
  }

  if (typeof isEnabled === 'boolean') {
    where.push(`is_enabled = $${idx++}`);
    params.push(isEnabled);
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;

  const totalRes = await query(
    `SELECT COUNT(*)::int AS total FROM upsell_related_stats ${whereSql}`,
    params
  );

  const rowsRes = await query(
    `
      SELECT *
      FROM upsell_related_stats
      ${whereSql}
      ORDER BY is_enabled DESC, boost_weight DESC, confidence DESC, support DESC, lift DESC, a_item_code, b_item_code
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

export async function toggleUpsellRelatedStat({ restaurantId, aItemCode, bItemCode, isEnabled } = {}) {
  const rid = normText(restaurantId);
  const a = normText(aItemCode);
  const b = normText(bItemCode);
  if (!rid || !a || !b) throw new Error('restaurantId/aItemCode/bItemCode are required');

  const res = await query(
    `
      UPDATE upsell_related_stats
      SET is_enabled = $4,
          updated_at = NOW()
      WHERE restaurant_id = $1 AND a_item_code = $2 AND b_item_code = $3
      RETURNING *
    `,
    [rid, a, b, Boolean(isEnabled)]
  );

  return res.rows[0] || null;
}

export async function setUpsellRelatedBoost({ restaurantId, aItemCode, bItemCode, boostWeight } = {}) {
  const rid = normText(restaurantId);
  const a = normText(aItemCode);
  const b = normText(bItemCode);
  const bw = normNum(boostWeight);
  if (!rid || !a || !b) throw new Error('restaurantId/aItemCode/bItemCode are required');

  const next = bw === null ? 1.0 : Math.max(0, bw);

  const res = await query(
    `
      UPDATE upsell_related_stats
      SET boost_weight = $4,
          updated_at = NOW()
      WHERE restaurant_id = $1 AND a_item_code = $2 AND b_item_code = $3
      RETURNING *
    `,
    [rid, a, b, next]
  );

  return res.rows[0] || null;
}

/**
 * Convert a co-occurrence relation into a manual upsell rule (item_to_item).
 */
export async function convertRelatedToUpsellRule({
  restaurantId,
  aItemCode,
  bItemCode,
  weight = null,
  priority = 0,
  reasonCode = 'cooccur_related',
} = {}) {
  const rid = normText(restaurantId);
  const a = normText(aItemCode);
  const b = normText(bItemCode);
  if (!rid || !a || !b) throw new Error('restaurantId/aItemCode/bItemCode are required');

  let derivedWeight = normNum(weight);
  if (derivedWeight === null) {
    const res = await query(
      `SELECT confidence, boost_weight FROM upsell_related_stats WHERE restaurant_id=$1 AND a_item_code=$2 AND b_item_code=$3`,
      [rid, a, b]
    );
    const row = res.rows[0];
    const c = Number(row?.confidence ?? 0);
    const bw = Number(row?.boost_weight ?? 1);
    derivedWeight = Math.max(0.05, Math.min(0.95, c * bw));
  }

  const created = await createUpsellRule({
    restaurant_id: rid,
    is_active: true,
    rule_type: 'item_to_item',
    trigger_item_code: a,
    suggested_item_code: b,
    priority: Number(priority) || 0,
    weight: derivedWeight,
    reason_code: reasonCode,
    channels: ['chat', 'voice'],
  });

  return created;
}
