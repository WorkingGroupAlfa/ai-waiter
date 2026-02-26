'use client';

import React, { useEffect, useState } from 'react';
import { apiClient } from '../../lib/api';
import { ensureAdminToken } from '../../lib/auth';

interface MenuItem {
  id: string;
  restaurant_id: string;
  item_code: string;
  name_ua: string;
  name_en?: string;
  base_price: number;
  category?: string;
  tags?: string[];
  is_active: boolean;
  // возможные дополнительные поля, если backend их возвращает
  ingredients?: string[] | null;
  allergens?: string[] | null;
  photos?: string[] | null;
}

const RESTAURANT_ID = 'azuma_demo';

// --- Standard tags used by backend recommendations ---
const TAG_OPTIONS = [
  'spicy',
  'sweet',
  'salty',
  'sour',
  'drink',
  'dessert',
  'light',
] as const;

// --- Standard categories (shown in datalist) ---
const CATEGORY_OPTIONS = [
  { value: 'main', label: 'Main dish' },
  { value: 'snack', label: 'Snacks' },
  { value: 'drink', label: 'Drinks' },
  { value: 'dessert', label: 'Desserts' },
] as const;

export default function MenuPage() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [editing, setEditing] = useState<MenuItem | null>(null);
  const [form, setForm] = useState<Partial<MenuItem>>({});
  const [ingredientsText, setIngredientsText] = useState('');
  const [allergensText, setAllergensText] = useState('');
  const [photosText, setPhotosText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    ensureAdminToken();
    loadItems();
  }, []);

  async function loadItems() {
    try {
      setLoading(true);
      setError(null);
      const res = await apiClient.get('/menu/items', {
        params: { restaurant_id: RESTAURANT_ID, only_active: false },
      });
      setItems(res.data.items || []);
    } catch (err: any) {
      console.error(err);
      setError('Failed to load menu items');
    } finally {
      setLoading(false);
    }
  }

  function startCreate() {
    setEditing(null);
    setForm({
      id: undefined,
      restaurant_id: RESTAURANT_ID,
      item_code: '',
      name_ua: '',
      name_en: '',
      base_price: 0,
      category: '',
      tags: [],
      is_active: true,
    });
    setIngredientsText('');
    setAllergensText('');
    setPhotosText('');
  }

  function startEdit(item: MenuItem) {
    setEditing(item);
    setForm({
      id: item.id,
      restaurant_id: item.restaurant_id,
      item_code: item.item_code,
      name_ua: item.name_ua,
      name_en: item.name_en || '',
      base_price: item.base_price,
      category: item.category || '',
      tags: Array.isArray((item as any).tags) ? (item as any).tags : [],
      is_active: item.is_active,
    });

    // преобразуем массивы в строку "a, b, c"
    setIngredientsText((item.ingredients || []).join(', '));
    setAllergensText((item.allergens || []).join(', '));
    setPhotosText((item.photos || []).join(', '));
  }

  function updateForm<K extends keyof MenuItem>(key: K, value: MenuItem[K]) {
    setForm(prev => ({ ...prev, [key]: value }));
  }

  function toggleTag(tag: string) {
    const current = Array.isArray(form.tags) ? form.tags : [];
    const next = current.includes(tag)
      ? current.filter(t => t !== tag)
      : [...current, tag];
    setForm(prev => ({ ...prev, tags: next as any }));
  }

  function parseCommaList(text: string): string[] {
    return text
      .split(',')
      .map(t => t.trim())
      .filter(Boolean);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (!form.item_code || !form.name_ua) {
        setError('item_code и name_ua обязательны');
        setSaving(false);
        return;
      }

      const payload = {
        id: form.id, // может быть undefined для создания
        restaurant_id: RESTAURANT_ID,
        item_code: form.item_code,
        name_ua: form.name_ua,
        name_en: form.name_en || '',
        base_price: Number(form.base_price || 0),
        category: form.category || '',
        tags: Array.isArray(form.tags) ? form.tags : [],
        is_active: form.is_active ?? true,
        // новые поля — строки → массивы строк
        ingredients: parseCommaList(ingredientsText),
        allergens: parseCommaList(allergensText),
        photos: parseCommaList(photosText),
      };

      await apiClient.post('/admin/menu/items', payload);
      await loadItems();
      setSaving(false);
    } catch (err: any) {
      console.error(err);
      setError('Failed to save menu item');
      setSaving(false);
    }
  }

  async function handleDelete(item: MenuItem) {
    const ok = window.confirm(`Delete "${item.name_ua}"? (will be deactivated)`);
    if (!ok) return;

    try {
      setError(null);
      await apiClient.delete(`/admin/menu/items/${item.id}`, {
        params: { restaurant_id: RESTAURANT_ID },
      });

      await loadItems();

      // If editing this item — reset form
      if (editing?.id === item.id) {
        setEditing(null);
        startCreate();
      }
    } catch (err) {
      console.error(err);
      setError('Failed to delete menu item');
    }
  }

    // Inline photo URL update (no need to open Edit)
  async function savePhotoInline(item: MenuItem, url: string) {
    try {
      setError(null);
      const photos = url ? [url] : [];

      const payload = {
        id: item.id,
        restaurant_id: RESTAURANT_ID,
        item_code: item.item_code,
        name_ua: item.name_ua,
        name_en: item.name_en || '',
        base_price: Number(item.base_price || 0),
        category: item.category || '',
        tags: Array.isArray(item.tags) ? item.tags : [],
        is_active: item.is_active ?? true,
        ingredients: Array.isArray(item.ingredients) ? item.ingredients : [],
        allergens: Array.isArray(item.allergens) ? item.allergens : [],
        photos,
      };

      await apiClient.post('/admin/menu/items', payload);

      // optimistic update
      setItems(prev =>
        prev.map(it => (it.id === item.id ? { ...it, photos } : it))
      );
    } catch (err) {
      console.error(err);
      setError('Failed to save photo URL');
    }
  }

  const tagPillStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9999,
    border: '1px solid #333333',
    background: '#151515',
    padding: '2px 8px',
    fontSize: '0.72rem',
    lineHeight: 1.2,
    whiteSpace: 'nowrap',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: '1rem',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h1 className="text-2xl font-semibold mb-2" style={{ margin: 0 }}>
            Menu
          </h1>
          <div className="text-sm text-gray-600" style={{ marginTop: '0.25rem' }}>
            Restaurant: <span className="font-mono">{RESTAURANT_ID}</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button className="btn btn-primary" onClick={startCreate}>
            + New item
          </button>
        </div>
      </div>

      {error && <div className="text-red-500 text-sm">{error}</div>}
      {loading && <div>Loading...</div>}

      {/* Table */}
      {!loading && items.length > 0 && (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="min-w-full text-sm">
            <thead>
              <tr>
                <th className="border px-2 py-1">Code</th>
                <th className="border px-2 py-1">Name (UA)</th>
                <th className="border px-2 py-1">Name (EN)</th>
                <th className="border px-2 py-1">Price</th>
                <th className="border px-2 py-1">Category</th>
                <th className="border px-2 py-1">Tags</th>
                <th className="border px-2 py-1">Photo URL</th>
                <th className="border px-2 py-1">Active</th>
                <th className="border px-2 py-1">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id}>
                  <td className="border px-2 py-1" style={{ minWidth: 260 }}>
  <input
    defaultValue={(item.photos && item.photos[0]) || ''}
    placeholder="https://..."
    className="input"
    style={{ width: '100%' }}
    onKeyDown={e => {
      if (e.key === 'Enter') {
        (e.target as HTMLInputElement).blur();
      }
    }}
    onBlur={e => {
      const url = (e.target as HTMLInputElement).value.trim();
      const current = (item.photos && item.photos[0]) || '';
      if (url !== current) savePhotoInline(item, url);
    }}
  />
</td>
                  <td className="border px-2 py-1" style={{ whiteSpace: 'nowrap' }}>
                    {item.item_code}
                  </td>
                  <td className="border px-2 py-1">{item.name_ua}</td>
                  <td className="border px-2 py-1">{item.name_en}</td>
                  <td className="border px-2 py-1">
                    {Number(item.base_price).toFixed(2)}
                  </td>
                  <td className="border px-2 py-1">{item.category}</td>

                  <td className="border px-2 py-1">
                    {Array.isArray(item.tags) && item.tags.length > 0 ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                        {item.tags.map(tag => (
                          <span key={tag} style={tagPillStyle}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs opacity-70">—</span>
                    )}
                  </td>

                  <td className="border px-2 py-1">{item.is_active ? 'Yes' : 'No'}</td>

                  <td className="border px-2 py-1">
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}
                        onClick={() => startEdit(item)}
                      >
                        Edit
                      </button>
                      <button
                        className="btn btn-ghost"
                        style={{
                          padding: '0.25rem 0.75rem',
                          fontSize: '0.8rem',
                          borderColor: 'rgba(252, 165, 165, 0.35)',
                          color: '#fca5a5',
                        }}
                        onClick={() => handleDelete(item)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Form */}
      <div className="card max-w-xl text-sm" style={{ width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.75rem' }}>
          <h2 className="font-semibold mb-1" style={{ margin: 0 }}>
            {form.id ? 'Edit item' : 'Create new item'}
          </h2>

          {form.id && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}
              onClick={startCreate}
              title="Cancel editing"
            >
              Cancel
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 220px', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <label>Item code</label>
              <input
                value={form.item_code || ''}
                onChange={e => updateForm('item_code', e.target.value as any)}
                required
              />
            </div>

            <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
              <input
                type="checkbox"
                checked={form.is_active ?? true}
                onChange={e => updateForm('is_active', e.target.checked as any)}
              />
              <span style={{ fontSize: '0.85rem' }}>Active</span>
            </label>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <label>Name (UA)</label>
            <input
              value={form.name_ua || ''}
              onChange={e => updateForm('name_ua', e.target.value as any)}
              required
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <label>Name (EN)</label>
            <input
              value={form.name_en || ''}
              onChange={e => updateForm('name_en', e.target.value as any)}
            />
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 180px', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <label>Base price</label>
              <input
                type="number"
                step="0.01"
                value={form.base_price ?? 0}
                onChange={e => updateForm('base_price', Number(e.target.value) as any)}
              />
            </div>

            <div style={{ flex: '1 1 180px', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <label>Category</label>
              <input
                list="category-options"
                value={form.category || ''}
                onChange={e => updateForm('category', e.target.value as any)}
                placeholder="main / snack / drink / dessert"
              />
              <datalist id="category-options">
                {CATEGORY_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </datalist>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <label>Tags (standard)</label>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {TAG_OPTIONS.map(tag => {
                const checked = Array.isArray(form.tags) && form.tags.includes(tag as any);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(String(tag))}
                    aria-pressed={checked}
                    className="btn"
                    style={{
                      padding: '0.25rem 0.75rem',
                      fontSize: '0.8rem',
                      border: '1px solid #333333',
                      background: checked ? '#ed2d23' : '#151515',
                      borderColor: checked ? '#bfa76f' : '#333333',
                      color: '#ffffff',
                      boxShadow: checked ? '0 0 12px rgba(191, 167, 111, 0.55)' : 'none',
                    }}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>

            <div className="text-xs opacity-70">
              Used for smart recommendations (e.g. “хочу что-то острое” → tag=spicy)
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <label>Ingredients (comma-separated)</label>
            <textarea
              rows={2}
              value={ingredientsText}
              onChange={e => setIngredientsText(e.target.value)}
              placeholder="shrimp, garlic, chili"
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <label>Allergens (comma-separated)</label>
            <textarea
              rows={2}
              value={allergensText}
              onChange={e => setAllergensText(e.target.value)}
              placeholder="shrimp, gluten"
            />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <label>Photo URLs (comma-separated)</label>
            <textarea
              rows={2}
              value={photosText}
              onChange={e => setPhotosText(e.target.value)}
              placeholder="https://..., https://..."
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
