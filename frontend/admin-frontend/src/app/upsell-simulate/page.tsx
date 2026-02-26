'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { apiClient } from '../../lib/api';
import { ensureAdminToken } from '../../lib/auth';

type MenuItem = {
  id: string;
  item_code: string;
  name_en?: string | null;
  name_ua?: string | null;
  is_active?: boolean;
};

type SimTopRow = {
  type: string | null;
  item_code: string | null;
  item_name: string | null;
  score: number | null;
  reason_code: string | null;
  source: string | null;
  message_intent?: string | null;
  message_slots?: any;
};

type SimResponse = {
  features: any;
  top: SimTopRow[];
  picked: SimTopRow | null;
  strategy: any;
  message_preview_en: string | null;
  message_preview_localized: string | null;
};

const RESTAURANT_ID = 'azuma_demo';

export default function UpsellSimulatePage() {
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [language, setLanguage] = useState('en');
  const [emotion, setEmotion] = useState('neutral');
  const [epsilon, setEpsilon] = useState<0 | 0.1>(0.1);

  const [advanced, setAdvanced] = useState(false);
  const [timeOverrideText, setTimeOverrideText] = useState('');
  const [weatherOverrideText, setWeatherOverrideText] = useState('');

  const [loading, setLoading] = useState(false);
  const [resData, setResData] = useState<SimResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ensureAdminToken();
    loadMenu();
  }, []);

  async function loadMenu() {
    try {
      const res = await apiClient.get('/menu/items', {
        params: { restaurant_id: RESTAURANT_ID, only_active: false },
      });
      setMenu(res.data.items || []);
    } catch (e: any) {
      console.error(e);
      setError('Failed to load menu');
    }
  }

  const selectedPreview = useMemo(() => {
    const byCode = new Map(menu.map(m => [m.item_code, m]));
    return selected.map(code => byCode.get(code)).filter(Boolean) as MenuItem[];
  }, [menu, selected]);

  function parseJsonOrNull(text: string) {
    const trimmed = (text || '').trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return { __error: 'Invalid JSON', raw: trimmed };
    }
  }

  async function simulate() {
    setLoading(true);
    setError(null);
    setResData(null);

    try {
      const timeOverride = advanced ? parseJsonOrNull(timeOverrideText) : null;
      const weatherOverride = advanced ? parseJsonOrNull(weatherOverrideText) : null;

      if (timeOverride && (timeOverride as any).__error) {
        setError('Time override JSON is invalid');
        setLoading(false);
        return;
      }
      if (weatherOverride && (weatherOverride as any).__error) {
        setError('Weather override JSON is invalid');
        setLoading(false);
        return;
      }

      const payload: any = {
        restaurant_id: RESTAURANT_ID,
        items: selected,
        language,
        emotion,
        epsilon_override: epsilon,
        time_context_override: timeOverride,
        weather_override: weatherOverride,
      };

      const res = await apiClient.post('/admin/upsell-simulate', payload);
      setResData(res.data as SimResponse);
    } catch (e: any) {
      console.error(e);
      setError(e?.response?.data?.error || e?.response?.data?.message || 'Simulation failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-2 space-y-6">
      <h1 className="text-2xl font-semibold">Upsell simulator</h1>

      {error && <div className="text-red-500">{error}</div>}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <div className="text-sm font-medium">Order items (multi-select)</div>
          <select
            multiple
            className="w-full border rounded p-2 h-[320px] bg-white"
            value={selected}
            onChange={e => {
              const opts = Array.from(e.target.selectedOptions).map(o => o.value);
              setSelected(opts);
            }}
          >
            {menu
              .slice()
              .sort((a, b) => a.item_code.localeCompare(b.item_code))
              .map(it => (
                <option key={it.item_code} value={it.item_code}>
                  {it.item_code} — {(it.name_en || it.name_ua || '').toString()}
                </option>
              ))}
          </select>

          <div className="text-xs text-gray-600">
            Selected: {selectedPreview.map(x => x.item_code).join(', ') || '—'}
          </div>
        </div>

        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <div className="text-sm font-medium">Language</div>
              <select className="w-full border rounded p-2 bg-white" value={language} onChange={e => setLanguage(e.target.value)}>
                <option value="en">en</option>
                <option value="ua">ua</option>
                <option value="ru">ru</option>
              </select>
            </label>

            <label className="space-y-1">
              <div className="text-sm font-medium">Emotion</div>
              <select className="w-full border rounded p-2 bg-white" value={emotion} onChange={e => setEmotion(e.target.value)}>
                <option value="neutral">neutral</option>
                <option value="happy">happy</option>
                <option value="confused">confused</option>
                <option value="angry">angry</option>
                <option value="frustrated">frustrated</option>
              </select>
            </label>
          </div>

          <div className="space-y-1">
            <div className="text-sm font-medium">ε (epsilon)</div>
            <div className="flex gap-2">
              <button
                className={`px-3 py-2 rounded border ${epsilon === 0 ? 'bg-black text-white' : 'bg-white'}`}
                onClick={() => setEpsilon(0)}
                type="button"
              >
                0 (exploit)
              </button>
              <button
                className={`px-3 py-2 rounded border ${epsilon === 0.1 ? 'bg-black text-white' : 'bg-white'}`}
                onClick={() => setEpsilon(0.1)}
                type="button"
              >
                0.1 (ε-greedy)
              </button>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={advanced} onChange={e => setAdvanced(e.target.checked)} />
            Advanced overrides (time/weather JSON)
          </label>

          {advanced && (
            <div className="space-y-3">
              <label className="space-y-1 block">
                <div className="text-sm font-medium">time_context_override (JSON)</div>
                <textarea
                  className="w-full border rounded p-2 font-mono text-xs h-28 bg-white"
                  placeholder='Example: {"hour":19,"daypart":"dinner","timezone":"Australia/Adelaide"}'
                  value={timeOverrideText}
                  onChange={e => setTimeOverrideText(e.target.value)}
                />
              </label>

              <label className="space-y-1 block">
                <div className="text-sm font-medium">weather_override (JSON)</div>
                <textarea
                  className="w-full border rounded p-2 font-mono text-xs h-28 bg-white"
                  placeholder='Example: {"temperature_c":28,"weather_code":1}'
                  value={weatherOverrideText}
                  onChange={e => setWeatherOverrideText(e.target.value)}
                />
              </label>
            </div>
          )}

          <button
            className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
            disabled={loading || selected.length === 0}
            onClick={simulate}
            type="button"
          >
            {loading ? 'Simulating…' : 'Run simulation'}
          </button>

          {selected.length === 0 && <div className="text-xs text-gray-500">Pick at least 1 item.</div>}
        </div>
      </div>

      {resData && (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="border rounded p-3 bg-white">
              <div className="font-medium mb-2">Message preview (EN)</div>
              <div className="text-sm whitespace-pre-wrap">{resData.message_preview_en || '—'}</div>
            </div>
            <div className="border rounded p-3 bg-white">
              <div className="font-medium mb-2">Message preview (localized)</div>
              <div className="text-sm whitespace-pre-wrap">{resData.message_preview_localized || '—'}</div>
            </div>
          </div>

          <div className="border rounded p-3 bg-white">
            <div className="font-medium mb-2">Picked</div>
            {resData.picked ? (
              <div className="text-sm">
                <div><b>{resData.picked.item_code}</b> — {resData.picked.item_name}</div>
                <div className="text-xs text-gray-600">
                  type={resData.picked.type || '—'} • score={resData.picked.score ?? '—'} • reason_code={resData.picked.reason_code || '—'} • source={resData.picked.source || '—'}
                </div>
              </div>
            ) : (
              <div className="text-sm text-gray-600">No pick (no candidates?)</div>
            )}
          </div>

          <div className="border rounded p-3 bg-white">
            <div className="font-medium mb-2">Top-N</div>
            <table className="min-w-full border text-sm">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border px-2 py-1">#</th>
                  <th className="border px-2 py-1">Item</th>
                  <th className="border px-2 py-1">Type</th>
                  <th className="border px-2 py-1">Score</th>
                  <th className="border px-2 py-1">Reason</th>
                  <th className="border px-2 py-1">Source</th>
                </tr>
              </thead>
              <tbody>
                {(resData.top || []).map((r, i) => (
                  <tr key={(r.item_code || 'null') + ':' + i} className={resData.picked?.item_code === r.item_code ? 'bg-yellow-50' : ''}>
                    <td className="border px-2 py-1">{i + 1}</td>
                    <td className="border px-2 py-1">
                      <div className="font-medium">{r.item_code || '—'}</div>
                      <div className="text-xs text-gray-600">{r.item_name || '—'}</div>
                    </td>
                    <td className="border px-2 py-1">{r.type || '—'}</td>
                    <td className="border px-2 py-1">{typeof r.score === 'number' ? r.score.toFixed(3) : '—'}</td>
                    <td className="border px-2 py-1">{r.reason_code || '—'}</td>
                    <td className="border px-2 py-1">{r.source || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border rounded p-3 bg-white">
            <div className="font-medium mb-2">Features</div>
            <pre className="text-xs bg-gray-50 p-2 rounded overflow-auto">{JSON.stringify(resData.features, null, 2)}</pre>
          </div>

          <div className="border rounded p-3 bg-white">
            <div className="font-medium mb-2">Strategy</div>
            <pre className="text-xs bg-gray-50 p-2 rounded overflow-auto">{JSON.stringify(resData.strategy, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
