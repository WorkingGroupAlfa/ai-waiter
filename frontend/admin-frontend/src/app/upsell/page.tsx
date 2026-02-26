// admin-frontend/src/app/upsell/page.tsx
'use client';

import React, { useEffect, useState } from 'react';
import { apiClient } from '../../lib/api';
import { ensureAdminToken } from '../../lib/auth';

interface UpsellStatRow {
  item_code: string;
  item_name: string;
  upsell_shown: number;
  upsell_accepted: number;
  conversion: number; // 0–1
}

interface GroupedRow {
  reason_code?: string;
  source_kind?: string;
  upsell_shown: number;
  upsell_accepted: number;
  conversion: number;
}

interface SkipRow {
  reason: string;
  count: number;
}

const RESTAURANT_ID = 'azuma_demo';

export default function UpsellPage() {
  const [rows, setRows] = useState<UpsellStatRow[]>([]);
  const [reasons, setReasons] = useState<GroupedRow[]>([]);
  const [sources, setSources] = useState<GroupedRow[]>([]);
  const [skips, setSkips] = useState<SkipRow[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ensureAdminToken();
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [a, b, c, d] = await Promise.all([
        apiClient.get('/admin/analytics/upsell', { params: { restaurant_id: RESTAURANT_ID } }),
        apiClient.get('/admin/analytics/upsell-reason-codes', { params: { restaurant_id: RESTAURANT_ID } }),
        apiClient.get('/admin/analytics/upsell-source-kinds', { params: { restaurant_id: RESTAURANT_ID } }),
        apiClient.get('/admin/analytics/upsell-skip-reasons', { params: { restaurant_id: RESTAURANT_ID } }),
      ]);

      setRows(a.data.stats || []);
      setReasons(b.data.rows || []);
      setSources(c.data.rows || []);
      setSkips(d.data.rows || []);
    } catch (err: any) {
      console.error(err);
      setError('Failed to load upsell stats');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-2 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Upsell statistics</h1>
        <button className="px-3 py-2 rounded border" onClick={loadAll} disabled={loading} type="button">
          Refresh
        </button>
      </div>

      {error && <div className="text-red-500 mb-2">{error}</div>}

      {loading ? (
        <div>Loading...</div>
      ) : (
        <>
          <div className="space-y-2">
            <div className="font-medium">By item</div>
            <table className="min-w-full border text-sm">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border px-2 py-1">Item code</th>
                  <th className="border px-2 py-1">Item name</th>
                  <th className="border px-2 py-1">Shown</th>
                  <th className="border px-2 py-1">Accepted</th>
                  <th className="border px-2 py-1">Conversion</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.item_code}>
                    <td className="border px-2 py-1">{row.item_code}</td>
                    <td className="border px-2 py-1">{row.item_name}</td>
                    <td className="border px-2 py-1">{row.upsell_shown}</td>
                    <td className="border px-2 py-1">{row.upsell_accepted}</td>
                    <td className="border px-2 py-1">{(row.conversion * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <div className="font-medium">Acceptance by reason_code</div>
              <table className="min-w-full border text-sm">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="border px-2 py-1">reason_code</th>
                    <th className="border px-2 py-1">Shown</th>
                    <th className="border px-2 py-1">Accepted</th>
                    <th className="border px-2 py-1">Conversion</th>
                  </tr>
                </thead>
                <tbody>
                  {reasons.map((r, i) => (
                    <tr key={(r.reason_code || 'unknown') + ':' + i}>
                      <td className="border px-2 py-1">{r.reason_code || 'unknown'}</td>
                      <td className="border px-2 py-1">{r.upsell_shown}</td>
                      <td className="border px-2 py-1">{r.upsell_accepted}</td>
                      <td className="border px-2 py-1">{(r.conversion * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-2">
              <div className="font-medium">Acceptance by source kind</div>
              <table className="min-w-full border text-sm">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="border px-2 py-1">source_kind</th>
                    <th className="border px-2 py-1">Shown</th>
                    <th className="border px-2 py-1">Accepted</th>
                    <th className="border px-2 py-1">Conversion</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((r, i) => (
                    <tr key={(r.source_kind || 'unknown') + ':' + i}>
                      <td className="border px-2 py-1">{r.source_kind || 'unknown'}</td>
                      <td className="border px-2 py-1">{r.upsell_shown}</td>
                      <td className="border px-2 py-1">{r.upsell_accepted}</td>
                      <td className="border px-2 py-1">{(r.conversion * 100).toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-2">
            <div className="font-medium">Skip reasons distribution</div>
            <table className="min-w-full border text-sm">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border px-2 py-1">reason</th>
                  <th className="border px-2 py-1">count</th>
                </tr>
              </thead>
              <tbody>
                {skips.map((r, i) => (
                  <tr key={r.reason + ':' + i}>
                    <td className="border px-2 py-1">{r.reason}</td>
                    <td className="border px-2 py-1">{r.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-xs text-gray-600">
              Note: skip reasons are logged as <code>upsell_skipped.payload.reason</code>.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
