'use client';

import React, { useEffect, useState } from 'react';
import { apiClient } from '../lib/api';
import { ensureAdminToken } from '../lib/auth';

interface OrdersSummary {
  count?: number;
  avg_check?: number;
  total_revenue?: number;
}

interface UpsellSummary {
  shown?: number;
  accepted?: number;
  conversion?: number;
}

interface Summary {
  orders?: OrdersSummary;
  upsell?: UpsellSummary;
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ensureAdminToken();
    loadSummary();
  }, []);

  async function loadSummary() {
    try {
      const res = await apiClient.get('/admin/analytics/summary');
      // backend возвращает { summary: { orders: {...}, upsell: {...} } }
      setSummary(res.data.summary);
    } catch (err: any) {
      console.error(err);
      setError('Failed to load summary. Check admin token.');
    }
  }

  // Безопасные значения с fallback'ами
  const ordersCount = summary?.orders?.count ?? 0;
  const revenueTotal = summary?.orders?.total_revenue ?? 0;
  const averageCheck = summary?.orders?.avg_check ?? 0;
  const upsellConversion = summary?.upsell?.conversion ?? 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold mb-4">Dashboard: Azuma AI</h1>
      <div className="card" style={{ marginBottom: 16 }}>
  <div className="text-sm mb-2">Quick links</div>
  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
    <a href="/restaurant-settings" className="btn btn-secondary">
      Restaurant Settings
    </a>
    <a href="/upsell" className="btn btn-secondary">Upsell</a>
    <a href="/menu" className="btn btn-secondary">Menu</a>
    <a href="/sessions" className="btn btn-secondary">Sessions</a>
    <a href="/upsell-rules" className="btn btn-secondary">Upsell Rules</a>

  </div>
</div>




      {error && <div className="text-red-600 mt-4">{error}</div>}

      {summary && !error && (
  <div className="metric-grid">
    <div className="card">
      <div className="metric-card-title">Total orders</div>
      <div className="metric-card-value">{ordersCount}</div>
    </div>
    <div className="card">
      <div className="metric-card-title">Total revenue</div>
      <div className="metric-card-value">
        {revenueTotal.toFixed(2)}
      </div>
    </div>
    <div className="card">
      <div className="metric-card-title">Average check</div>
      <div className="metric-card-value">
        {averageCheck.toFixed(2)}
      </div>
    </div>
    <div className="card">
      <div className="metric-card-title">Upsell conversion</div>
      <div className="metric-card-value">
        {(upsellConversion * 100).toFixed(1)}%
      </div>
    </div>
  </div>
)}

    </div>
  );
}


