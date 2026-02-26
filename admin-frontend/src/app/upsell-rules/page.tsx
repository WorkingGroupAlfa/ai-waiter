'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { apiClient } from '../../lib/api';
import { ensureAdminToken } from '../../lib/auth';

type RuleType = 'item_to_item' | 'category_to_item' | 'tag_to_item';

interface UpsellRule {
  id: number;
  restaurant_id: string;
  is_active: boolean;
  rule_type: RuleType;

  trigger_item_code: string | null;
  trigger_category_id: string | null;
  trigger_tag: string | null;

  suggested_item_code: string;
  priority: number;
  weight: number;
  reason_code: string | null;

  max_per_session: number | null;
  cooldown_minutes: number | null;
  min_order_total: number | null;
  time_windows: any;
  channels: string[] | null;

  created_at: string;
  updated_at: string;
}

const RESTAURANT_ID = 'azuma_demo';

const emptyDraft = (): Partial<UpsellRule> => ({
  restaurant_id: RESTAURANT_ID,
  is_active: true,
  rule_type: 'item_to_item',
  trigger_item_code: '',
  trigger_category_id: '',
  trigger_tag: '',
  suggested_item_code: '',
  priority: 0,
  weight: 0.6,
  reason_code: 'pairing_with_item',
  max_per_session: null,
  cooldown_minutes: null,
  min_order_total: null,
  channels: ['chat'],
  time_windows: null,
});

export default function UpsellRulesPage() {
  const [rows, setRows] = useState<UpsellRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<UpsellRule | null>(null);
  const [draft, setDraft] = useState<Partial<UpsellRule>>(emptyDraft());

  useEffect(() => {
    ensureAdminToken();
    load();
  }, []);

  const mode = useMemo(() => (selected ? 'edit' : 'create'), [selected]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get('/admin/upsell-rules', {
        params: { restaurant_id: RESTAURANT_ID, page: 1, limit: 200 },
      });
      setRows((res.data.rows || []).filter(Boolean));
    } catch (e: any) {
      console.error(e);
      setError('Failed to load upsell rules');
    } finally {
      setLoading(false);
    }
  }

  function pick(r: UpsellRule) {
    setSelected(r);
    setDraft({
      ...r,
      // normalize nullable -> string inputs
      trigger_item_code: r.trigger_item_code || '',
      trigger_category_id: r.trigger_category_id || '',
      trigger_tag: r.trigger_tag || '',
      channels: r.channels || [],
      time_windows: r.time_windows ?? null,
    });
  }

  function resetForm() {
    setSelected(null);
    setDraft(emptyDraft());
  }

  async function save() {
    setError(null);
    try {
      const payload: any = {
        ...draft,
        restaurant_id: RESTAURANT_ID,
        // channels: allow csv or array
      };

      // Clean triggers depending on rule_type
      if (payload.rule_type === 'item_to_item') {
        payload.trigger_category_id = null;
        payload.trigger_tag = null;
      } else if (payload.rule_type === 'category_to_item') {
        payload.trigger_item_code = null;
        payload.trigger_tag = null;
      } else if (payload.rule_type === 'tag_to_item') {
        payload.trigger_item_code = null;
        payload.trigger_category_id = null;
      }

      // time_windows: allow textarea JSON
      if (typeof payload.time_windows === 'string') {
        try {
          payload.time_windows = JSON.parse(payload.time_windows);
        } catch {
          payload.time_windows = null;
        }
      }

      if (mode === 'create') {
        const res = await apiClient.post('/admin/upsell-rules', payload);
        const rule = res.data?.rule ?? res.data;
        if (!rule?.id) throw new Error('Bad response shape: missing rule');
        setRows(prev => [rule, ...prev]);
        resetForm();
      } else {
        const res = await apiClient.put(`/admin/upsell-rules/${selected!.id}`, payload);
        const rule = res.data?.rule ?? res.data;
        if (!rule?.id) throw new Error('Bad response shape: missing rule');
        setRows(prev => prev.map(x => (x.id === rule.id ? rule : x)));
        setSelected(rule);
setDraft({
  ...rule,
  trigger_item_code: rule.trigger_item_code || '',
  trigger_category_id: rule.trigger_category_id || '',
  trigger_tag: rule.trigger_tag || '',
  channels: rule.channels || [],
  time_windows: rule.time_windows ?? null,
});

      }
    } catch (e: any) {
      console.error(e);
      setError(e?.response?.data?.message || 'Failed to save');
    }
  }

  async function del(id: number) {
    if (!confirm('Delete rule?')) return;
    setError(null);
    try {
      await apiClient.delete(`/admin/upsell-rules/${id}`);
      setRows(prev => prev.filter(x => x.id !== id));
      if (selected?.id === id) resetForm();
    } catch (e: any) {
      console.error(e);
      setError('Failed to delete');
    }
  }

  async function toggle(id: number, is_active: boolean) {
    setError(null);
    try {
      const res = await apiClient.post(`/admin/upsell-rules/${id}/toggle`, {
        is_active: !is_active,
      });
      const rule = res.data?.rule ?? res.data;
if (!rule?.id) throw new Error('Bad response shape: missing rule');

      setRows(prev => prev.map(x => (x.id === rule.id ? rule : x)));
      if (selected?.id === id) {
        setSelected(rule);
setDraft({
  ...rule,
  trigger_item_code: rule.trigger_item_code || '',
  trigger_category_id: rule.trigger_category_id || '',
  trigger_tag: rule.trigger_tag || '',
  channels: rule.channels || [],
  time_windows: rule.time_windows ?? null,
});

      }
    } catch (e: any) {
      console.error(e);
      setError('Failed to toggle');
    }
  }

  async function duplicate(id: number) {
    setError(null);
    try {
      const res = await apiClient.post(`/admin/upsell-rules/${id}/duplicate`);
      const rule = res.data?.rule ?? res.data;
if (!rule?.id) throw new Error('Bad response shape: missing rule');

      setRows(prev => [rule, ...prev]);
    } catch (e: any) {
      console.error(e);
      setError('Failed to duplicate');
    }
  }

  const triggerLabel =
    (draft.rule_type as RuleType) === 'item_to_item'
      ? 'Trigger item_code'
      : (draft.rule_type as RuleType) === 'category_to_item'
      ? 'Trigger category'
      : 'Trigger tag';

  return (
    <div className="p-2 space-y-6">
      <h1 className="text-2xl font-semibold">Upsell Rules</h1>

      {error && <div className="text-red-600">{error}</div>}

      <div className="grid" style={{ gridTemplateColumns: '1.4fr 1fr', gap: 16 }}>
        <div className="card">
          <div className="text-sm mb-2">Rules list ({rows.length})</div>
          {loading ? (
            <div>Loading...</div>
          ) : (
            <table className="min-w-full border text-sm">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border px-2 py-1">Active</th>
                  <th className="border px-2 py-1">Type</th>
                  <th className="border px-2 py-1">Trigger</th>
                  <th className="border px-2 py-1">Suggest</th>
                  <th className="border px-2 py-1">P</th>
                  <th className="border px-2 py-1">W</th>
                  <th className="border px-2 py-1">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} style={{ opacity: r.is_active ? 1 : 0.55 }}>
                    <td className="border px-2 py-1">
                      <button className="btn btn-secondary" onClick={() => toggle(r.id, r.is_active)}>
                        {r.is_active ? 'ON' : 'OFF'}
                      </button>
                    </td>
                    <td className="border px-2 py-1">
                      <button className="link" onClick={() => pick(r)}>
                        {r.rule_type}
                      </button>
                    </td>
                    <td className="border px-2 py-1">
                      {r.trigger_item_code || r.trigger_category_id || r.trigger_tag || '-'}
                    </td>
                    <td className="border px-2 py-1">{r.suggested_item_code}</td>
                    <td className="border px-2 py-1">{r.priority}</td>
                    <td className="border px-2 py-1">{Number(r.weight).toFixed(2)}</td>
                    <td className="border px-2 py-1" style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-secondary" onClick={() => duplicate(r.id)}>
                        Duplicate
                      </button>{' '}
                      <button className="btn btn-secondary" onClick={() => del(r.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
                {!rows.length && (
                  <tr>
                    <td className="border px-2 py-2" colSpan={7}>
                      No rules yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        <div className="card space-y-3">
          <div className="text-sm mb-2">
            {mode === 'create' ? 'Create rule' : `Edit rule #${selected?.id}`}
          </div>

          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label className="text-sm">
              Type
              <select
                className="input"
                value={(draft.rule_type as any) || 'item_to_item'}
                onChange={e => setDraft(d => ({ ...d, rule_type: e.target.value as RuleType }))}
              >
                <option value="item_to_item">item_to_item</option>
                <option value="category_to_item">category_to_item</option>
                <option value="tag_to_item">tag_to_item</option>
              </select>
            </label>

            <label className="text-sm">
              Suggested item_code
              <input
                className="input"
                value={(draft.suggested_item_code as any) || ''}
                onChange={e => setDraft(d => ({ ...d, suggested_item_code: e.target.value }))}
              />
            </label>

            <label className="text-sm" style={{ gridColumn: '1 / span 2' }}>
              {triggerLabel}
              <input
                className="input"
                value={
                  (draft.rule_type as RuleType) === 'item_to_item'
                    ? (draft.trigger_item_code as any) || ''
                    : (draft.rule_type as RuleType) === 'category_to_item'
                    ? (draft.trigger_category_id as any) || ''
                    : (draft.trigger_tag as any) || ''
                }
                onChange={e => {
                  const v = e.target.value;
                  if ((draft.rule_type as RuleType) === 'item_to_item') setDraft(d => ({ ...d, trigger_item_code: v }));
                  else if ((draft.rule_type as RuleType) === 'category_to_item')
                    setDraft(d => ({ ...d, trigger_category_id: v }));
                  else setDraft(d => ({ ...d, trigger_tag: v }));
                }}
              />
            </label>

            <label className="text-sm">
              Priority
              <input
                className="input"
                type="number"
                value={(draft.priority as any) ?? 0}
                onChange={e => setDraft(d => ({ ...d, priority: Number(e.target.value) }))}
              />
            </label>

            <label className="text-sm">
              Weight
              <input
                className="input"
                type="number"
                step="0.01"
                value={(draft.weight as any) ?? 0.6}
                onChange={e => setDraft(d => ({ ...d, weight: Number(e.target.value) }))}
              />
            </label>

            <label className="text-sm">
              max_per_session
              <input
                className="input"
                type="number"
                value={(draft.max_per_session as any) ?? ''}
                onChange={e =>
                  setDraft(d => ({ ...d, max_per_session: e.target.value === '' ? null : Number(e.target.value) }))
                }
              />
            </label>

            <label className="text-sm">
              cooldown_minutes
              <input
                className="input"
                type="number"
                value={(draft.cooldown_minutes as any) ?? ''}
                onChange={e =>
                  setDraft(d => ({ ...d, cooldown_minutes: e.target.value === '' ? null : Number(e.target.value) }))
                }
              />
            </label>

            <label className="text-sm">
              min_order_total
              <input
                className="input"
                type="number"
                step="0.01"
                value={(draft.min_order_total as any) ?? ''}
                onChange={e =>
                  setDraft(d => ({ ...d, min_order_total: e.target.value === '' ? null : Number(e.target.value) }))
                }
              />
            </label>

            <label className="text-sm">
              channels (csv)
              <input
                className="input"
                value={Array.isArray(draft.channels) ? draft.channels.join(',') : (draft.channels as any) || ''}
                onChange={e => setDraft(d => ({ ...d, channels: e.target.value.split(',').map(x => x.trim()).filter(Boolean) }))}
              />
            </label>

            <label className="text-sm" style={{ gridColumn: '1 / span 2' }}>
              reason_code
              <input
                className="input"
                value={(draft.reason_code as any) || ''}
                onChange={e => setDraft(d => ({ ...d, reason_code: e.target.value }))}
              />
            </label>

            <label className="text-sm" style={{ gridColumn: '1 / span 2' }}>
              time_windows (JSON)
              <textarea
                className="input"
                style={{ height: 120 }}
                value={
                  typeof draft.time_windows === 'string'
                    ? draft.time_windows
                    : draft.time_windows
                    ? JSON.stringify(draft.time_windows)
                    : ''
                }
                onChange={e => setDraft(d => ({ ...d, time_windows: e.target.value }))}
                placeholder='Example: {"ranges":[{"start":"11:00","end":"15:00","days":[1,2,3,4,5]}]}'
              />
            </label>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-primary" onClick={save}>
              {mode === 'create' ? 'Create' : 'Save'}
            </button>
            <button className="btn btn-secondary" onClick={resetForm}>
              Reset
            </button>
            <button className="btn btn-secondary" onClick={load}>
              Refresh
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
