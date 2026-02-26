// scripts/build_upsell_dataset.js
// Build an upsell dataset from Postgres events.
// Output: JSONL (one JSON per line).
//
// Usage:
//   node scripts/build_upsell_dataset.js --out ./upsell_dataset.jsonl
//   node scripts/build_upsell_dataset.js --restaurant azuma_demo --out ./azuma_upsell_dataset.jsonl
//   node scripts/build_upsell_dataset.js --limit 5000 --out ./upsell_dataset.jsonl

import fs from 'fs';
import { query, pool } from '../src/db.js';

function parseArgs(argv) {
  const map = new Map();
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a || !a.startsWith('--')) continue;
    const key = a.slice(2);
    const val = argv[i + 1];
    if (val && !val.startsWith('--')) {
      map.set(key, val);
      i++;
    } else {
      map.set(key, 'true');
    }
  }
  return map;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function get(obj, path, def = null) {
  try {
    return path
      .split('.')
      .reduce((a, k) => (a && a[k] !== undefined ? a[k] : undefined), obj) ?? def;
  } catch {
    return def;
  }
}

// сначала новый nested-формат, потом старый flat
function pickField(p, oldKey, newPath, def = null) {
  const vNew = get(p, newPath, undefined);
  if (vNew !== undefined && vNew !== null) return vNew;
  const vOld = p?.[oldKey];
  return vOld !== undefined ? vOld : def;
}

function normalizeCandidatesTop(raw) {
  if (!Array.isArray(raw)) return null;
  return raw.map((c) => ({
    item_code: c?.item_code ?? c?.itemCode ?? null,
    item_name: c?.item_name ?? c?.itemName ?? null,
    score: num(c?.score),
    reason_code: c?.reason_code ?? c?.reasonCode ?? null,
    type: c?.type ?? null,
    source: c?.source ?? null,
  }));
}

async function main() {
  const args = parseArgs(process.argv);
  const restaurantId = args.get('restaurant') || null;
  const outPath = args.get('out') || 'upsell_dataset.jsonl';
  const limit = num(args.get('limit')) || null;

  // WHERE без "голого AND"
  const clauses = ["shown.event_type = 'upsell_shown'"];
  const params = [];

  if (restaurantId) {
    params.push(restaurantId);
    clauses.push(`shown.payload->>'restaurant_id' = $${params.length}`);
  }

  const where = `WHERE ${clauses.join(' AND ')}`;

  // outcome JOIN: безопасно приводим к uuid, фильтруем по формату
  const sql = `
    SELECT
      shown.id AS shown_event_id,
      shown.session_id,
      shown.device_id,
      shown.created_at AS shown_created_at,
      shown.payload AS shown_payload,
      outcome.event_type AS outcome_type,
      outcome.created_at AS outcome_created_at,
      outcome.payload AS outcome_payload
    FROM events shown
    LEFT JOIN events outcome
      ON (outcome.payload->>'upsell_event_id') ~* '^[0-9a-f-]{36}$'
     AND (outcome.payload->>'upsell_event_id')::uuid = shown.id
     AND outcome.event_type IN ('upsell_accepted','upsell_rejected')
    ${where}
    ORDER BY shown.created_at ASC
    ${limit ? `LIMIT ${Math.floor(limit)}` : ''}
  `;

  const res = await query(sql, params);
  const rows = res.rows || [];

  const stream = fs.createWriteStream(outPath, { encoding: 'utf8' });

  for (const r of rows) {
    const p = r.shown_payload || {};
    const metaOld = (p && p._meta) || {};

    // совместимое чтение (старый flat + новый nested)
    const language = pickField(p, 'language', 'meta.language', null);
    const emotion = pickField(p, 'emotion', 'meta.emotion', null);

    const reason_code = pickField(p, 'reason_code', 'picked.reason_code', null);

    const strategy = pickField(p, 'strategy', 'ml.strategy', null);
    const model_version = pickField(p, 'model_version', 'ml.model_version', null);
    const epsilon = num(pickField(p, 'epsilon', 'ml.epsilon', null));
    const picked_by = pickField(p, 'picked_by', 'ml.picked_by', null);

    // picked item (старое suggested_* или новое picked.*)
    const picked_item_code = pickField(p, 'suggested_item_code', 'picked.item_code', null);
    const picked_item_name = pickField(p, 'suggested_item_name', 'picked.item_name', null);
    const picked_score = num(pickField(p, 'score', 'picked.score', null));
    const picked_type = pickField(p, 'type', 'picked.type', null);

    // order snapshot (как сейчас + на будущее)
    const orderSnapshot = p.order_snapshot || null;
    const item_codes =
      (orderSnapshot && Array.isArray(orderSnapshot.item_codes) ? orderSnapshot.item_codes : []) || [];
    const total_price = num(orderSnapshot && orderSnapshot.total_price);

    // time/weather (как сейчас + на будущее)
    const timeCtx = p.time_context || get(p, 'context.time', null) || null;
    const weather = p.weather || get(p, 'context.weather', null) || null;

    const time_hour = num(timeCtx && timeCtx.hour);
    const time_daypart = timeCtx && timeCtx.daypart ? String(timeCtx.daypart) : null;

    // weather возможен в разных форматах — поддержим оба
    const temp_c = num(weather && (weather.temperature_c ?? weather.temp_c ?? weather.temperatureC));
    const weather_code = num(weather && (weather.weather_code ?? weather.code ?? weather.weatherCode));

    // top-N candidates (появится после шага 6)
// top-N candidates (Step 6/7). Support both keys: candidates_top (old) and top_candidates (new/alias)
const candidatesTopRaw = get(p, 'candidates_top', null) ?? get(p, 'top_candidates', null);
const candidates_top = normalizeCandidatesTop(candidatesTopRaw);


    // label
    const label = r.outcome_type === 'upsell_accepted' ? 1 : 0;

    // timestamp: сначала payload meta.ts, потом shown.created_at
    const ts = metaOld.ts || get(p, 'meta.ts', null) || r.shown_created_at || null;

    const rec = {
      shown_event_id: r.shown_event_id,
      restaurant_id: pickField(p, 'restaurant_id', 'ids.restaurant_id', null),

      session_id: r.session_id || pickField(p, 'session_id', 'ids.session_id', null),
      device_id: r.device_id || pickField(p, 'device_id', 'ids.device_id', null),

      ts,

      // core features
      language,
      emotion,

      reason_code,

      strategy,
      model_version,
      epsilon,
      picked_by,

      // picked (what was actually shown)
      picked_item_code,
      picked_item_name,
      picked_score,
      picked_type,

      // exposure (for step 6/7)
      candidates_top, // null until you implement top-N in logging

      // order
      item_codes,
      total_price,

      // time
      time_hour,
      time_daypart,

      // weather
      temp_c,
      weather_code,

      // label
      accepted: label,

      // optional debug fields (очень полезно на этапе валидации датасета)
      outcome_type: r.outcome_type || null,
      outcome_ts: r.outcome_created_at || null,
    };

    stream.write(JSON.stringify(rec) + '\n');
  }

  stream.end();
  await new Promise((resolve) => stream.on('finish', resolve));

  console.log(`Wrote ${rows.length} rows to ${outPath}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await pool.end();
    } catch {
      // ignore
    }
  });
