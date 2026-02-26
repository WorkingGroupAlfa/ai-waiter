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

const RESTAURANT_ID = 'azuma_demo';

export default function UpsellPage() {
  const [rows, setRows] = useState<UpsellStatRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ensureAdminToken();
    loadStats();
  }, []);

  async function loadStats() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get('/admin/analytics/upsell', {
        params: { restaurant_id: RESTAURANT_ID },
      });
      setRows(res.data.stats || []);
    } catch (err: any) {
      console.error(err);
      setError('Failed to load upsell stats');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-2 space-y-6">
      <h1 className="text-2xl font-semibold mb-4">Upsell statistics</h1>



      {error && <div className="text-red-500 mb-2">{error}</div>}

      {loading ? (
        <div>Loading...</div>
      ) : (
        <table className="min-w-full border text-sm">
          <thead>
            <tr className="bg-gray-100">
              <th className="border px-2 py-1">Item code</th>
              <th className="border px-2 py-1">Item name</th>
              <th className="border px-2 py-1">Upsell shown</th>
              <th className="border px-2 py-1">Upsell accepted</th>
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
                <td className="border px-2 py-1">
                  {(row.conversion * 100).toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
