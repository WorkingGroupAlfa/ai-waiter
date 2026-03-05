'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { apiClient } from '../../../lib/api';
import { ensureAdminToken } from '../../../lib/auth';

const RESTAURANT_ID = 'azuma_demo';

interface MenuItem {
  id: string;
  restaurant_id: string;
  item_code: string;
  name_ua: string;
  name_en?: string;
  base_price: number;
  category?: string;
  tags?: string[];
  custom_category_ids?: string[];
  is_active: boolean;
  ingredients?: string[] | null;
  allergens?: string[] | null;
  photos?: string[] | null;
}

type SortKey = 'name' | 'price' | 'code';
type SortDir = 'asc' | 'desc';

export default function InactiveMenuPage() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  useEffect(() => {
    ensureAdminToken();
    void loadItems();
  }, []);

  async function loadItems() {
    try {
      setLoading(true);
      setError(null);
      const res = await apiClient.get('/menu/items', {
        params: { restaurant_id: RESTAURANT_ID, only_active: false },
      });
      const all = Array.isArray(res.data?.items) ? res.data.items : [];
      setItems(all.filter((i: MenuItem) => !i.is_active));
    } catch (err) {
      console.error(err);
      setError('Failed to load inactive dishes');
    } finally {
      setLoading(false);
    }
  }

  async function activate(item: MenuItem) {
    try {
      setActivatingId(item.id);
      setError(null);

      const payload = {
        id: item.id,
        restaurant_id: RESTAURANT_ID,
        item_code: item.item_code,
        name_ua: item.name_ua,
        name_en: item.name_en || '',
        base_price: Number(item.base_price || 0),
        category: item.category || '',
        tags: Array.isArray(item.tags) ? item.tags : [],
        custom_category_ids: Array.isArray(item.custom_category_ids) ? item.custom_category_ids : [],
        is_active: true,
        ingredients: Array.isArray(item.ingredients) ? item.ingredients : [],
        allergens: Array.isArray(item.allergens) ? item.allergens : [],
        photos: Array.isArray(item.photos) ? item.photos : [],
      };

      await apiClient.post('/admin/menu/items', payload);
      setItems(prev => prev.filter(x => x.id !== item.id));
    } catch (err) {
      console.error(err);
      setError('Failed to activate dish');
    } finally {
      setActivatingId(null);
    }
  }

  const visibleItems = useMemo(() => {
    let rows = [...items];
    const q = search.trim().toLowerCase();

    if (q) {
      rows = rows.filter(i => {
        const code = String(i.item_code || '').toLowerCase();
        const ua = String(i.name_ua || '').toLowerCase();
        const en = String(i.name_en || '').toLowerCase();
        return code.includes(q) || ua.includes(q) || en.includes(q);
      });
    }

    rows.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'price') cmp = Number(a.base_price || 0) - Number(b.base_price || 0);
      else if (sortKey === 'code') cmp = String(a.item_code || '').localeCompare(String(b.item_code || ''));
      else cmp = String(a.name_ua || a.name_en || '').localeCompare(String(b.name_ua || b.name_en || ''));
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return rows;
  }, [items, search, sortKey, sortDir]);

  return (
    <div className="space-y-6">
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h1 className="text-2xl font-semibold mb-2" style={{ margin: 0 }}>Inactive dishes</h1>
          <div className="text-sm text-gray-600" style={{ marginTop: '0.25rem' }}>
            Restaurant: <span className="font-mono">{RESTAURANT_ID}</span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <a className="btn btn-ghost" href="/menu">Back to menu</a>
          <button className="btn btn-ghost" onClick={() => void loadItems()}>Reload</button>
        </div>
      </div>

      {error && <div className="text-red-500 text-sm">{error}</div>}
      {loading && <div>Loading...</div>}

      {!loading && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ minWidth: 280, flex: '1 1 280px', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label>Search</label>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Name or code" />
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label>Sort by</label>
                <select value={sortKey} onChange={e => setSortKey(e.target.value as SortKey)}>
                  <option value="name">Name</option>
                  <option value="price">Price</option>
                  <option value="code">Code</option>
                </select>
              </div>
              <button className="btn btn-ghost" onClick={() => setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))}>
                {sortDir === 'asc' ? 'Asc' : 'Desc'}
              </button>
            </div>
          </div>

          <div className="text-sm muted">Total inactive: {items.length} • Showing: {visibleItems.length}</div>

          <div className="table-wrap" style={{ maxHeight: '62vh', overflow: 'auto' }}>
            <table className="min-w-full text-sm">
              <thead>
                <tr>
                  <th className="border px-2 py-1" style={{ position: 'sticky', top: 0, zIndex: 2 }}>Code</th>
                  <th className="border px-2 py-1" style={{ position: 'sticky', top: 0, zIndex: 2 }}>Name (UA)</th>
                  <th className="border px-2 py-1" style={{ position: 'sticky', top: 0, zIndex: 2 }}>Name (EN)</th>
                  <th className="border px-2 py-1" style={{ position: 'sticky', top: 0, zIndex: 2 }}>Price</th>
                  <th className="border px-2 py-1" style={{ position: 'sticky', top: 0, zIndex: 2 }}>Base category</th>
                  <th className="border px-2 py-1" style={{ position: 'sticky', top: 0, zIndex: 2 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map(item => (
                  <tr key={item.id}>
                    <td className="border px-2 py-1" style={{ whiteSpace: 'nowrap' }}>{item.item_code}</td>
                    <td className="border px-2 py-1">{item.name_ua}</td>
                    <td className="border px-2 py-1">{item.name_en || '—'}</td>
                    <td className="border px-2 py-1">{Number(item.base_price || 0).toFixed(2)}</td>
                    <td className="border px-2 py-1">{item.category || '—'}</td>
                    <td className="border px-2 py-1">
                      <button
                        className="btn btn-primary btn-sm"
                        disabled={activatingId === item.id}
                        onClick={() => void activate(item)}
                      >
                        {activatingId === item.id ? 'Activating...' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
                {!visibleItems.length && (
                  <tr>
                    <td colSpan={6} className="border px-2 py-2">No inactive dishes found</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

