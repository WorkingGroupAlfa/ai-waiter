'use client';

import React, { useEffect, useState } from 'react';
import { apiClient } from '../../lib/api';
import { ensureAdminToken } from '../../lib/auth';

interface OrderRow {
  id: string;
  session_id: string;
  device_id: string;
  restaurant_id: string;
  table_id: string;
  status: string;
  total_amount: number;
  created_at: string;
  submitted_at?: string;
}

const RESTAURANT_ID = 'azuma_demo';

const STATUSES = ['draft', 'submitted', 'in_kitchen', 'ready', 'served', 'cancelled'];

export default function OrdersPage() {
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ensureAdminToken();
    loadOrders();
  }, []);

  async function loadOrders(status?: string) {
    setLoading(true);
    setError(null);
    try {
      const params: any = { restaurant_id: RESTAURANT_ID, limit: 100 };
      if (status) params.status = status;

      const res = await apiClient.get('/admin/orders', { params });
      setOrders(res.data.orders || []);
      setStatusFilter(status || '');
    } catch (err: any) {
      console.error(err);
      setError('Failed to load orders');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-2 space-y-4">
      <h1 className="text-2xl font-semibold mb-2">Orders</h1>



      <div className="flex items-center gap-4">
        <label className="text-sm">
          Status:{' '}
          <select
            className="border px-2 py-1 text-sm"
            value={statusFilter}
            onChange={e => loadOrders(e.target.value || undefined)}
          >
            <option value="">All</option>
            {STATUSES.map(st => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
        </label>
        <button
          className="border px-3 py-1 text-sm rounded"
          onClick={() => loadOrders(statusFilter || undefined)}
        >
          Reload
        </button>
      </div>

      {error && <div className="text-red-500">{error}</div>}
      {loading && <div>Loading...</div>}

      {!loading && orders.length === 0 && <div>No orders found.</div>}

      {!loading && orders.length > 0 && (
        <table className="min-w-full border text-sm mt-2">
          <thead>
            <tr className="bg-gray-100">
              <th className="border px-2 py-1">Order ID</th>
              <th className="border px-2 py-1">Table</th>
              <th className="border px-2 py-1">Status</th>
              <th className="border px-2 py-1">Total</th>
              <th className="border px-2 py-1">Created</th>
              <th className="border px-2 py-1">Submitted</th>
            </tr>
          </thead>
          <tbody>
            {orders.map(o => (
              <tr key={o.id}>
                <td className="border px-2 py-1">{o.id}</td>
                <td className="border px-2 py-1">{o.table_id}</td>
                <td className="border px-2 py-1">{o.status}</td>
                <td className="border px-2 py-1">
                  {Number(o.total_amount || 0).toFixed(2)}
                </td>
                <td className="border px-2 py-1">
                  {new Date(o.created_at).toLocaleString()}
                </td>
                <td className="border px-2 py-1">
                  {o.submitted_at ? new Date(o.submitted_at).toLocaleString() : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
