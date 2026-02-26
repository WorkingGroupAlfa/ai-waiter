'use client';

import React, { useEffect, useState } from 'react';
import { apiClient } from '../../lib/api';
import { ensureAdminToken } from '../../lib/auth';

interface SessionRow {
  id: string;
  device_id: string;
  restaurant_id: string;
  table_id: string;
  status: string;
  created_at: string;
  last_activity: string;
  expires_at: string;
}

const RESTAURANT_ID = 'azuma_demo';

export default function SessionsPage() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [onlyActive, setOnlyActive] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ensureAdminToken();
    loadSessions();
  }, []);

  async function loadSessions(options?: { onlyActive?: boolean }) {
    setLoading(true);
    setError(null);
    try {
      const params: any = { restaurant_id: RESTAURANT_ID };
      const active = options?.onlyActive ?? onlyActive;
      params.only_active = active ? 'true' : 'false';

      const res = await apiClient.get('/admin/sessions', { params });
      setSessions(res.data.sessions || []);
      setOnlyActive(active);
    } catch (err: any) {
      console.error(err);
      setError('Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-2 space-y-4">
      <h1 className="text-2xl font-semibold mb-2">Sessions</h1>



      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={onlyActive}
            onChange={e => loadSessions({ onlyActive: e.target.checked })}
          />
          Only active
        </label>
        <button
          className="border px-3 py-1 text-sm rounded"
          onClick={() => loadSessions()}
        >
          Reload
        </button>
      </div>

      {error && <div className="text-red-500">{error}</div>}
      {loading && <div>Loading...</div>}

      {!loading && sessions.length === 0 && <div>No sessions found.</div>}

      {!loading && sessions.length > 0 && (
        <table className="min-w-full border text-sm mt-2">
          <thead>
            <tr className="bg-gray-100">
              <th className="border px-2 py-1">Session ID</th>
              <th className="border px-2 py-1">Device</th>
              <th className="border px-2 py-1">Table</th>
              <th className="border px-2 py-1">Status</th>
              <th className="border px-2 py-1">Last activity</th>
              <th className="border px-2 py-1">Expires</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map(s => (
              <tr key={s.id}>
                <td className="border px-2 py-1">{s.id}</td>
                <td className="border px-2 py-1">{s.device_id}</td>
                <td className="border px-2 py-1">{s.table_id}</td>
                <td className="border px-2 py-1">{s.status}</td>
                <td className="border px-2 py-1">
                  {new Date(s.last_activity).toLocaleString()}
                </td>
                <td className="border px-2 py-1">
                  {new Date(s.expires_at).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
