#!/usr/bin/env node
/**
 * scripts/rebuild_related_stats.js
 *
 * Rebuild co-occurrence stats ("buy together") and upsert into upsell_related_stats.
 *
 * Usage:
 *   node scripts/rebuild_related_stats.js --restaurant_id=azuma_demo --days=60 --min_support=0.02 --limit_per_a=10
 *
 * Notes:
 * - Reads non-draft, non-cancelled orders (best-effort "completed")
 * - Uses DISTINCT item_codes per order
 */

import dotenv from 'dotenv';
import { query } from '../src/db.js';

dotenv.config();

function arg(name, def = null) {
  const key = `--${name}=`;
  const hit = process.argv.find(x => x.startsWith(key));
  if (!hit) return def;
  return hit.slice(key.length);
}

const restaurantId = arg('restaurant_id', arg('restaurantId', null));
const days = Number(arg('days', '90'));
const minSupport = Number(arg('min_support', '0'));
const limitPerA = Number(arg('limit_per_a', '15'));
const dryRun = String(arg('dry_run', 'false')).toLowerCase() === 'true';

if (!restaurantId) {
  console.error('ERROR: --restaurant_id is required');
  process.exit(1);
}

const DAYS = Number.isFinite(days) && days > 0 ? days : 90;
const MIN_SUPPORT = Number.isFinite(minSupport) && minSupport >= 0 ? minSupport : 0;
const LIMIT_PER_A = Number.isFinite(limitPerA) && limitPerA > 0 ? limitPerA : 15;

function combos(items) {
  const out = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = 0; j < items.length; j++) {
      if (i === j) continue;
      out.push([items[i], items[j]]);
    }
  }
  return out;
}

async function fetchOrdersItems({ sinceDays }) {
  const res = await query(
    `
    SELECT o.id AS order_id,
           ARRAY_AGG(DISTINCT oi.item_code) FILTER (WHERE oi.item_code IS NOT NULL AND oi.item_code <> '') AS items
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    WHERE o.restaurant_id = $1
      AND o.status NOT IN ('draft','cancelled')
      AND o.created_at >= NOW() - ($2::text || ' days')::interval
    GROUP BY o.id
    `,
    [restaurantId, String(sinceDays)]
  );

  return (res.rows || [])
    .map(r => ({
      order_id: r.order_id,
      items: Array.from(new Set((r.items || []).map(String).filter(Boolean))),
    }))
    .filter(r => r.items.length >= 2);
}

async function main() {
  console.log(`[related-stats] restaurant_id=${restaurantId} days=${DAYS} min_support=${MIN_SUPPORT} limit_per_a=${LIMIT_PER_A} dry_run=${dryRun}`);

  const orders = await fetchOrdersItems({ sinceDays: DAYS });
  const orders30 = await fetchOrdersItems({ sinceDays: 30 });

  const N = orders.length;
  const N30 = orders30.length;

  if (N === 0) {
    console.log('[related-stats] no orders found in range');
    return;
  }

  const countA = new Map();
  const countB = new Map();
  const countAB = new Map(); // key `${a}|||${b}`

  for (const o of orders) {
    for (const a of o.items) countA.set(a, (countA.get(a) || 0) + 1);
    for (const [a, b] of combos(o.items)) {
      const k = `${a}|||${b}`;
      countAB.set(k, (countAB.get(k) || 0) + 1);
    }
  }

  // For lift need P(B). countB same as countA for singletons.
  for (const [k, v] of countA.entries()) countB.set(k, v);

  const countAB30 = new Map();
  for (const o of orders30) {
    for (const [a, b] of combos(o.items)) {
      const k = `${a}|||${b}`;
      countAB30.set(k, (countAB30.get(k) || 0) + 1);
    }
  }

  const byA = new Map();

  for (const [k, ab] of countAB.entries()) {
    const [a, b] = k.split('|||');
    const aCnt = countA.get(a) || 0;
    const bCnt = countB.get(b) || 0;
    if (!aCnt || !bCnt) continue;

    const support = ab / N;
    if (support < MIN_SUPPORT) continue;

    const confidence = ab / aCnt;
    const pB = bCnt / N;
    const lift = pB > 0 ? confidence / pB : 0;

    const ab30 = countAB30.get(k) || 0;
    const last30 = N30 > 0 ? ab30 / N30 : 0;

    const row = { restaurant_id: restaurantId, a_item_code: a, b_item_code: b, support, confidence, lift, last_30d_support: last30 };

    if (!byA.has(a)) byA.set(a, []);
    byA.get(a).push(row);
  }

  const finalRows = [];
  for (const [a, arr] of byA.entries()) {
    arr.sort((x, y) =>
      (y.confidence - x.confidence) ||
      (y.support - x.support) ||
      (y.lift - x.lift) ||
      x.b_item_code.localeCompare(y.b_item_code)
    );
    finalRows.push(...arr.slice(0, LIMIT_PER_A));
  }

  console.log(`[related-stats] orders=${N} pairs=${countAB.size} rows_to_upsert=${finalRows.length}`);

  if (dryRun) {
    console.log('[related-stats] dry-run sample:', finalRows.slice(0, 10));
    return;
  }

  const chunkSize = 500;
  for (let i = 0; i < finalRows.length; i += chunkSize) {
    const chunk = finalRows.slice(i, i + chunkSize);

    const values = [];
    const params = [];
    let idx = 1;

    for (const r of chunk) {
      values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`);
      params.push(r.restaurant_id, r.a_item_code, r.b_item_code, r.support, r.confidence, r.lift, r.last_30d_support);
    }

    await query(
      `
      INSERT INTO upsell_related_stats (
        restaurant_id, a_item_code, b_item_code,
        support, confidence, lift, last_30d_support
      )
      VALUES ${values.join(',\n')}
      ON CONFLICT (restaurant_id, a_item_code, b_item_code)
      DO UPDATE SET
        support = EXCLUDED.support,
        confidence = EXCLUDED.confidence,
        lift = EXCLUDED.lift,
        last_30d_support = EXCLUDED.last_30d_support,
        updated_at = NOW()
      `,
      params
    );
  }

  console.log('[related-stats] done');
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[related-stats] failed', err);
    process.exit(1);
  });
