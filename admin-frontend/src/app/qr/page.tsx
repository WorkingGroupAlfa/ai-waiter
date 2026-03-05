'use client';

import React, { useEffect, useState } from 'react';
import { apiClient } from '../../lib/api';
import { ensureAdminToken } from '../../lib/auth';

const RESTAURANT_ID = 'azuma_demo';

interface SessionRow {
  table_id: string;
}

export default function QrPage() {
  const [tableId, setTableId] = useState('');
  const [ttlMinutes, setTtlMinutes] = useState(15);
  const [resultToken, setResultToken] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [persistentMode, setPersistentMode] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [tables, setTables] = useState<string[]>([]);
  const [loadingTables, setLoadingTables] = useState(false);

  useEffect(() => {
    ensureAdminToken();
    loadTables();
  }, []);

  async function loadTables() {
    setLoadingTables(true);
    setError(null);
    try {
      const res = await apiClient.get('/admin/sessions', {
        params: { restaurant_id: RESTAURANT_ID, only_active: 'false' },
      });
      const sessions: SessionRow[] = res.data.sessions || [];
      const unique = Array.from(
        new Set(
          sessions
            .map(s => s.table_id)
            .filter(t => t && typeof t === 'string')
        )
      ) as string[];
      setTables(unique);
    } catch (err: any) {
      console.error(err);
      setError(prev => prev || 'Failed to load tables');
    } finally {
      setLoadingTables(false);
    }
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResultToken(null);
    setResultUrl(null);
    setLoading(true);

    try {
      const res = persistentMode
        ? await apiClient.post('/qr/admin/table-code', {
            restaurant_id: RESTAURANT_ID,
            table_id: tableId,
            rotate: false,
          })
        : await apiClient.post('/qr/admin/create', {
            restaurant_id: RESTAURANT_ID,
            table_id: tableId,
            ttl_minutes: ttlMinutes,
          });

      const qr = res.data.qr || res.data;
      setResultToken(qr.token || qr.qr_token || qr.table_code || null);
      setResultUrl(qr.qr_url || null);
    } catch (err: any) {
      console.error(err);
      setError('Failed to generate QR');
    } finally {
      setLoading(false);
    }
  }

  function handlePickTable(t: string) {
    setTableId(t);
  }

  return (
    <div className="p-2 space-y-4">
      <h1 className="text-2xl font-semibold mb-2">QR generator</h1>



      <form onSubmit={handleGenerate} className="space-y-3 max-w-sm mt-2 text-sm">
        <div className="flex flex-col gap-1">
          <label>Restaurant ID</label>
          <input
            type="text"
            className="border rounded px-2 py-1"
            value={RESTAURANT_ID}
            disabled
          />
        </div>
        <div className="flex flex-col gap-1">
          <label>Table ID</label>
          <input
            type="text"
            className="border rounded px-2 py-1"
            value={tableId}
            onChange={e => setTableId(e.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-1">
          <label>Mode</label>
          <select
            className="border rounded px-2 py-1"
            value={persistentMode ? 'persistent' : 'one_time'}
            onChange={e => setPersistentMode(e.target.value === 'persistent')}
          >
            <option value="persistent">Persistent table QR (for printing)</option>
            <option value="one_time">One-time token QR</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label>TTL (minutes)</label>
          <input
            type="number"
            className="border rounded px-2 py-1"
            value={ttlMinutes}
            onChange={e => setTtlMinutes(Number(e.target.value) || 15)}
            disabled={persistentMode}
          />
        </div>
        <button
  type="submit"
  className="btn btn-primary"
  disabled={loading}
>
  {loading ? 'Generating...' : 'Generate QR'}
</button>
      </form>

      {error && <div className="text-red-500 mt-2 text-sm">{error}</div>}

      {resultToken && (
        <div className="mt-4 text-sm">
          <div className="font-semibold mb-1">{persistentMode ? 'Table code:' : 'QR token:'}</div>
          <code className="border px-2 py-1 rounded inline-block break-all">
            {resultToken}
          </code>
          {resultUrl && (
            <div className="mt-2">
              <div className="font-semibold mb-1">QR link:</div>
              <code className="border px-2 py-1 rounded inline-block break-all">
                {resultUrl}
              </code>
            </div>
          )}
        </div>
      )}

      <section className="mt-6 text-sm space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Tables from sessions</h2>
          <button
            className="border px-2 py-1 rounded text-xs"
            onClick={loadTables}
            disabled={loadingTables}
          >
            Reload
          </button>
        </div>

        {loadingTables && <div>Loading tables...</div>}

        {!loadingTables && tables.length === 0 && (
          <div className="text-gray-500">No tables found from sessions.</div>
        )}

        {!loadingTables && tables.length > 0 && (
  <div className="tables-chips">
    {tables.map(t => (
      <button
        key={t}
        type="button"
        className={
          t === tableId
            ? 'tables-chips-active'
            : ''
        }
        onClick={() => handlePickTable(t)}
      >
        Table {t}
      </button>
    ))}
  </div>
)}

      </section>
    </div>
  );
}

