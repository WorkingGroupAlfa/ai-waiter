'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { apiClient } from '../../lib/api';
import { ensureAdminToken } from '../../lib/auth';

const RESTAURANT_ID =
  (typeof window !== 'undefined' && (window as any).__RESTAURANT_ID__) ||
  'azuma_demo';

type Row = {
  restaurant_id: string;
  a_item_code: string;
  b_item_code: string;
  support: number;
  confidence: number;
  lift: number;
  last_30d_support: number;
  is_enabled: boolean;
  boost_weight: number;
  updated_at: string;
};

export default function AutoRelatedPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);

  const [aFilter, setAFilter] = useState('');
  const [minSupport, setMinSupport] = useState<string>('0');
  const [minConfidence, setMinConfidence] = useState<string>('0');
  const [enabledOnly, setEnabledOnly] = useState(false);

  const queryParams = useMemo(() => {
    const p: any = {
      restaurant_id: RESTAURANT_ID,
      page: 1,
      limit: 200,
    };
    if (aFilter.trim()) p.a_item_code = aFilter.trim();
    if (minSupport !== '') p.min_support = minSupport;
    if (minConfidence !== '') p.min_confidence = minConfidence;
    if (enabledOnly) p.is_enabled = 'true';
    return p;
  }, [aFilter, minSupport, minConfidence, enabledOnly]);

  async function load() {
    setLoading(true);
    try {
      await ensureAdminToken();
      const res = await apiClient.get('/admin/auto-related', { params: queryParams });
      setRows(res.data?.rows || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryParams]);

  async function toggle(row: Row) {
    await ensureAdminToken();
    const res = await apiClient.post('/admin/auto-related/toggle', {
      restaurant_id: row.restaurant_id,
      a_item_code: row.a_item_code,
      b_item_code: row.b_item_code,
      is_enabled: !row.is_enabled,
    });
    const updated: Row = res.data?.row;
    setRows(prev =>
      prev.map(r =>
        r.restaurant_id === updated.restaurant_id &&
        r.a_item_code === updated.a_item_code &&
        r.b_item_code === updated.b_item_code
          ? updated
          : r
      )
    );
  }

  async function saveBoost(row: Row, nextBoost: number) {
    await ensureAdminToken();
    const res = await apiClient.post('/admin/auto-related/boost', {
      restaurant_id: row.restaurant_id,
      a_item_code: row.a_item_code,
      b_item_code: row.b_item_code,
      boost_weight: nextBoost,
    });
    const updated: Row = res.data?.row;
    setRows(prev =>
      prev.map(r =>
        r.restaurant_id === updated.restaurant_id &&
        r.a_item_code === updated.a_item_code &&
        r.b_item_code === updated.b_item_code
          ? updated
          : r
      )
    );
  }

  async function convertToRule(row: Row) {
    await ensureAdminToken();
    await apiClient.post('/admin/auto-related/convert-to-rule', {
      restaurant_id: row.restaurant_id,
      a_item_code: row.a_item_code,
      b_item_code: row.b_item_code,
      priority: 0,
      // weight можно не передавать — модель возьмёт confidence*boost
    });
    alert('Converted to Upsell Rule ✅');
  }

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 12 }}>Auto Related (Co-occurrence)</h1>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <label>
          A item code:
          <input
            value={aFilter}
            onChange={e => setAFilter(e.target.value)}
            style={{ marginLeft: 8, padding: 6 }}
            placeholder="e.g. COFFEE"
          />
        </label>

        <label>
          min_support:
          <input
            value={minSupport}
            onChange={e => setMinSupport(e.target.value)}
            style={{ marginLeft: 8, padding: 6, width: 90 }}
          />
        </label>

        <label>
          min_confidence:
          <input
            value={minConfidence}
            onChange={e => setMinConfidence(e.target.value)}
            style={{ marginLeft: 8, padding: 6, width: 90 }}
          />
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={enabledOnly} onChange={e => setEnabledOnly(e.target.checked)} />
          Enabled only
        </label>

        <button onClick={load} disabled={loading} style={{ padding: '6px 10px' }}>
          {loading ? 'Loading...' : 'Reload'}
        </button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['A → B', 'confidence', 'support', 'lift', 'enabled', 'boost', 'actions'].map(h => (
                <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={`${r.restaurant_id}:${r.a_item_code}:${r.b_item_code}`}>
                <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>
                  <b>{r.a_item_code}</b> → {r.b_item_code}
                </td>
                <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{Number(r.confidence).toFixed(4)}</td>
                <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{Number(r.support).toFixed(4)}</td>
                <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>{Number(r.lift).toFixed(3)}</td>
                <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>
                  <button onClick={() => toggle(r)} style={{ padding: '4px 8px' }}>
                    {r.is_enabled ? 'ON' : 'OFF'}
                  </button>
                </td>
                <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>
                  <input
                    defaultValue={String(r.boost_weight ?? 1)}
                    style={{ width: 80, padding: 6 }}
                    onBlur={e => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v)) saveBoost(r, v);
                    }}
                  />
                </td>
                <td style={{ padding: 8, borderBottom: '1px solid #eee' }}>
                  <button onClick={() => convertToRule(r)} style={{ padding: '4px 8px' }}>
                    convert-to-rule
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: 12 }}>
                  No rows. (Run rebuild script + enable some rows)
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
