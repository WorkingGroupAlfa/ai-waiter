'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { apiClient } from '../../lib/api';
import { ensureAdminToken } from '../../lib/auth';

const RESTAURANT_ID = 'azuma_demo';

interface CustomCategory {
  id: string;
  restaurant_id: string;
  slug: string;
  name_ua: string;
  name_en?: string | null;
  aliases?: string[] | null;
  is_active: boolean;
  sort_order: number;
}

const emptyDraft = {
  slug: '',
  name_ua: '',
  name_en: '',
  aliases: '',
  is_active: true,
  sort_order: 0,
};

export default function CustomCategoriesPage() {
  const [rows, setRows] = useState<CustomCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<CustomCategory | null>(null);
  const [draft, setDraft] = useState<any>(emptyDraft);

  const mode = useMemo(() => (selected ? 'edit' : 'create'), [selected]);

  useEffect(() => {
    ensureAdminToken();
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get('/admin/menu/custom-categories', {
        params: { restaurant_id: RESTAURANT_ID },
      });
      setRows(Array.isArray(res.data?.rows) ? res.data.rows : []);
    } catch (err) {
      console.error(err);
      setError('Failed to load custom categories');
    } finally {
      setLoading(false);
    }
  }

  function pick(row: CustomCategory) {
    setSelected(row);
    setDraft({
      slug: row.slug || '',
      name_ua: row.name_ua || '',
      name_en: row.name_en || '',
      aliases: Array.isArray(row.aliases) ? row.aliases.join(', ') : '',
      is_active: row.is_active ?? true,
      sort_order: Number(row.sort_order || 0),
    });
  }

  function reset() {
    setSelected(null);
    setDraft(emptyDraft);
  }

  async function save() {
    setError(null);
    const payload = {
      restaurant_id: RESTAURANT_ID,
      slug: String(draft.slug || '').trim().toLowerCase(),
      name_ua: String(draft.name_ua || '').trim(),
      name_en: String(draft.name_en || '').trim() || null,
      aliases: String(draft.aliases || '')
        .split(',')
        .map(x => x.trim())
        .filter(Boolean),
      is_active: Boolean(draft.is_active),
      sort_order: Number(draft.sort_order || 0),
    };

    try {
      if (mode === 'create') {
        const res = await apiClient.post('/admin/menu/custom-categories', payload);
        const row = res.data?.row;
        if (row?.id) {
          setRows(prev => [row, ...prev]);
          reset();
        } else {
          await load();
        }
      } else if (selected?.id) {
        const res = await apiClient.put(
          `/admin/menu/custom-categories/${selected.id}`,
          payload
        );
        const row = res.data?.row;
        if (row?.id) {
          setRows(prev => prev.map(x => (x.id === row.id ? row : x)));
          pick(row);
        } else {
          await load();
        }
      }
    } catch (err: any) {
      console.error(err);
      setError(err?.response?.data?.message || 'Failed to save category');
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete custom category?')) return;
    setError(null);
    try {
      await apiClient.delete(`/admin/menu/custom-categories/${id}`);
      setRows(prev => prev.filter(x => x.id !== id));
      if (selected?.id === id) reset();
    } catch (err) {
      console.error(err);
      setError('Failed to delete category');
    }
  }

  return (
    <div className="p-2 space-y-6">
      <h1 className="text-2xl font-semibold">Custom categories</h1>

      {error && <div className="text-red-600">{error}</div>}

      <div className="grid" style={{ gridTemplateColumns: '1.3fr 1fr', gap: 16 }}>
        <div className="card">
          <div className="text-sm mb-2">Categories list ({rows.length})</div>
          {loading ? (
            <div>Loading...</div>
          ) : (
            <table className="min-w-full border text-sm">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border px-2 py-1">Active</th>
                  <th className="border px-2 py-1">Slug</th>
                  <th className="border px-2 py-1">Name UA</th>
                  <th className="border px-2 py-1">Name EN</th>
                  <th className="border px-2 py-1">Order</th>
                  <th className="border px-2 py-1">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} style={{ opacity: r.is_active ? 1 : 0.55 }}>
                    <td className="border px-2 py-1">{r.is_active ? 'ON' : 'OFF'}</td>
                    <td className="border px-2 py-1">
                      <button className="link" onClick={() => pick(r)}>
                        {r.slug}
                      </button>
                    </td>
                    <td className="border px-2 py-1">{r.name_ua}</td>
                    <td className="border px-2 py-1">{r.name_en || '—'}</td>
                    <td className="border px-2 py-1">{Number(r.sort_order || 0)}</td>
                    <td className="border px-2 py-1">
                      <button className="btn btn-secondary" onClick={() => remove(r.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td className="border px-2 py-2" colSpan={6}>
                      No custom categories yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        <div className="card space-y-3">
          <div className="text-sm mb-2">
            {mode === 'create' ? 'Create category' : `Edit category #${selected?.id}`}
          </div>

          <label className="text-sm">
            Slug
            <input
              className="input"
              value={draft.slug}
              onChange={e => setDraft((d: any) => ({ ...d, slug: e.target.value }))}
              placeholder="gunkan"
            />
          </label>

          <label className="text-sm">
            Name UA
            <input
              className="input"
              value={draft.name_ua}
              onChange={e => setDraft((d: any) => ({ ...d, name_ua: e.target.value }))}
              placeholder="Гункани"
            />
          </label>

          <label className="text-sm">
            Name EN
            <input
              className="input"
              value={draft.name_en}
              onChange={e => setDraft((d: any) => ({ ...d, name_en: e.target.value }))}
              placeholder="Gunkan"
            />
          </label>

          <label className="text-sm">
            Aliases (comma-separated)
            <input
              className="input"
              value={draft.aliases}
              onChange={e => setDraft((d: any) => ({ ...d, aliases: e.target.value }))}
              placeholder="gun kan, гункан, гункани"
            />
          </label>

          <label className="text-sm">
            Sort order
            <input
              className="input"
              type="number"
              value={draft.sort_order}
              onChange={e =>
                setDraft((d: any) => ({ ...d, sort_order: Number(e.target.value || 0) }))
              }
            />
          </label>

          <label className="text-sm" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={Boolean(draft.is_active)}
              onChange={e => setDraft((d: any) => ({ ...d, is_active: e.target.checked }))}
            />
            Active
          </label>

          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-primary" onClick={save}>
              {mode === 'create' ? 'Create' : 'Save'}
            </button>
            <button className="btn btn-secondary" onClick={reset}>
              Reset
            </button>
            <button className="btn btn-secondary" onClick={load}>
              Reload
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

