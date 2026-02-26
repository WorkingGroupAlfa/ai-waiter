// admin-frontend/src/app/restaurant-settings/page.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { apiClient } from '../../lib/api';
import { ensureAdminToken } from '../../lib/auth';

type DaypartKey = 'breakfast' | 'lunch' | 'dinner' | 'late';
type Dayparts = Record<DaypartKey, { start: string; end: string }>;

interface RestaurantSettings {
  restaurant_id: string;
  timezone: string | null;
  lat: number | null;
  lon: number | null;

  weather_enabled: boolean;
  weather_provider: string | null;
  weather_cache_ttl_seconds: number;

  dayparts: Dayparts;

  upsell_max_per_session: number;
  upsell_min_gap_minutes: number;
  upsell_default_epsilon: number;
}

const DEFAULT_DAYPARTS: Dayparts = {
  breakfast: { start: '06:00', end: '11:00' },
  lunch: { start: '11:00', end: '16:00' },
  dinner: { start: '16:00', end: '22:00' },
  late: { start: '22:00', end: '06:00' },
};

const DEFAULT_RESTAURANT_ID = 'azuma_demo';

export default function RestaurantSettingsPage() {
  const [restaurantId, setRestaurantId] = useState(DEFAULT_RESTAURANT_ID);
  const [settings, setSettings] = useState<RestaurantSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const tzOptions = useMemo(() => {
    const anyIntl: any = Intl as any;
    const list: string[] =
      typeof anyIntl.supportedValuesOf === 'function'
        ? (anyIntl.supportedValuesOf('timeZone') as string[])
        : [
            'UTC',
            'Europe/Kyiv',
            'Australia/Adelaide',
            'Australia/Sydney',
            'America/New_York',
            'America/Los_Angeles',
          ];
    return list;
  }, []);

  async function load() {
    setErr(null);
    setMsg(null);
    setLoading(true);
    try {
      ensureAdminToken();
      const res = await apiClient.get('/admin/restaurant-settings', {
        params: { restaurant_id: restaurantId },
      });
      const s = res.data as RestaurantSettings;
      setSettings({
        ...s,
        dayparts: (s.dayparts as any) || DEFAULT_DAYPARTS,
      });
    } catch (e: any) {
      console.error(e);
      setErr('Failed to load settings');
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    if (!settings) return;
    setErr(null);
    setMsg(null);
    setSaving(true);
    try {
      ensureAdminToken();
      const res = await apiClient.put(
        '/admin/restaurant-settings',
        {
          restaurant_id: settings.restaurant_id,
          timezone: settings.timezone,
          lat: settings.lat,
          lon: settings.lon,
          weather_enabled: settings.weather_enabled,
          weather_cache_ttl_seconds: settings.weather_cache_ttl_seconds,
          dayparts: settings.dayparts,
          upsell_max_per_session: settings.upsell_max_per_session,
          upsell_min_gap_minutes: settings.upsell_min_gap_minutes,
          upsell_default_epsilon: settings.upsell_default_epsilon,
        },
        { params: { restaurant_id: settings.restaurant_id } }
      );
      setSettings(res.data as RestaurantSettings);
      setMsg('Saved ✅');
    } catch (e: any) {
      console.error(e);
      setErr('Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function set<K extends keyof RestaurantSettings>(key: K, value: RestaurantSettings[K]) {
    if (!settings) return;
    setSettings({ ...settings, [key]: value });
  }

  function setDaypart(dp: DaypartKey, key: 'start' | 'end', value: string) {
    if (!settings) return;
    setSettings({
      ...settings,
      dayparts: {
        ...settings.dayparts,
        [dp]: { ...settings.dayparts[dp], [key]: value },
      },
    });
  }

  return (
    <div className="p-2 space-y-4">
      <h1 className="text-2xl font-semibold mb-2">Restaurant Settings</h1>

      <div className="card">
        <div className="text-sm mb-2">Restaurant</div>
        <div className="flex gap-2" style={{ display: 'flex', gap: 8 }}>
          <input
            className="border rounded px-3 py-2"
            value={restaurantId}
            onChange={e => setRestaurantId(e.target.value)}
            placeholder="restaurant_id"
            style={{ flex: 1 }}
          />
          <button className="btn btn-primary" onClick={load} disabled={loading}>
            {loading ? 'Loading…' : 'Load'}
          </button>
        </div>
      </div>

      {err && <div className="text-red-600">{err}</div>}
      {msg && <div className="text-green-600">{msg}</div>}

      {!settings ? (
        <div className="card">No settings loaded.</div>
      ) : (
        <>
          <div className="card">
            <h2 className="text-lg font-semibold mb-2">Timezone</h2>
            <select
              className="border rounded px-3 py-2 w-full"
              value={settings.timezone || ''}
              onChange={e => set('timezone', e.target.value || null)}
            >
              <option value="">(not set)</option>
              {tzOptions.map(tz => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
            <div className="text-xs mt-2" style={{ opacity: 0.7 }}>
              Used to compute time_context.daypart/hour/day_of_week.
            </div>
          </div>

          <div className="card">
            <h2 className="text-lg font-semibold mb-2">Dayparts</h2>
            {(['breakfast', 'lunch', 'dinner', 'late'] as DaypartKey[]).map(dp => (
              <div key={dp} className="mb-3">
                <div className="text-sm mb-1" style={{ textTransform: 'capitalize' }}>
                  {dp}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    className="border rounded px-3 py-2"
                    value={settings.dayparts?.[dp]?.start || ''}
                    onChange={e => setDaypart(dp, 'start', e.target.value)}
                    placeholder="HH:MM"
                    style={{ width: 120 }}
                  />
                  <input
                    className="border rounded px-3 py-2"
                    value={settings.dayparts?.[dp]?.end || ''}
                    onChange={e => setDaypart(dp, 'end', e.target.value)}
                    placeholder="HH:MM"
                    style={{ width: 120 }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="card">
            <h2 className="text-lg font-semibold mb-2">Weather</h2>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={Boolean(settings.weather_enabled)}
                onChange={e => set('weather_enabled', e.target.checked)}
              />
              Enable weather
            </label>

            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <input
                className="border rounded px-3 py-2"
                value={settings.lat ?? ''}
                onChange={e => set('lat', e.target.value === '' ? null : Number(e.target.value))}
                placeholder="lat"
                style={{ width: 160 }}
              />
              <input
                className="border rounded px-3 py-2"
                value={settings.lon ?? ''}
                onChange={e => set('lon', e.target.value === '' ? null : Number(e.target.value))}
                placeholder="lon"
                style={{ width: 160 }}
              />
              <input
                className="border rounded px-3 py-2"
                value={settings.weather_cache_ttl_seconds ?? 600}
                onChange={e => set('weather_cache_ttl_seconds', Number(e.target.value))}
                placeholder="ttl seconds"
                style={{ width: 180 }}
              />
            </div>

            <div className="text-xs mt-2" style={{ opacity: 0.7 }}>
              If disabled or no lat/lon — weather is null (nothing breaks).
            </div>
          </div>

          <div className="card">
            <h2 className="text-lg font-semibold mb-2">Upsell defaults</h2>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <div>
                <div className="text-sm mb-1">Max per session</div>
                <input
                  className="border rounded px-3 py-2"
                  value={settings.upsell_max_per_session}
                  onChange={e => set('upsell_max_per_session', Number(e.target.value))}
                  style={{ width: 160 }}
                />
              </div>

              <div>
                <div className="text-sm mb-1">Min gap (minutes)</div>
                <input
                  className="border rounded px-3 py-2"
                  value={settings.upsell_min_gap_minutes}
                  onChange={e => set('upsell_min_gap_minutes', Number(e.target.value))}
                  style={{ width: 160 }}
                />
              </div>

              <div>
                <div className="text-sm mb-1">Default epsilon</div>
                <input
                  className="border rounded px-3 py-2"
                  value={settings.upsell_default_epsilon}
                  onChange={e => set('upsell_default_epsilon', Number(e.target.value))}
                  style={{ width: 160 }}
                />
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
