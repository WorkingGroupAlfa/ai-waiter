// admin-frontend/src/app/persona/page.tsx
'use client';

import React, { useEffect, useState } from 'react';
import { apiClient } from '../../lib/api';
import { ensureAdminToken } from '../../lib/auth';

const RESTAURANT_ID = 'azuma_demo';

interface Persona {
  restaurant_id: string;
  speech_rate: number;
  humor_level: number;
  tone: string;
  greeting: string;
  farewell: string;
}

export default function PersonaPage() {
  const [persona, setPersona] = useState<Persona | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ensureAdminToken();
    loadPersona();
  }, []);

  async function loadPersona() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get('/admin/ai/persona', {
        params: { restaurant_id: RESTAURANT_ID },
      });
      setPersona(res.data);
    } catch (err: any) {
      console.error(err);
      setError('Failed to load persona');
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!persona) return;
    setSaving(true);
    setError(null);

    try {
      await apiClient.put('/admin/ai/persona', {
        ...persona,
        restaurant_id: RESTAURANT_ID,
      });
    } catch (err: any) {
      console.error(err);
      setError('Failed to save persona');
    } finally {
      setSaving(false);
    }
  }

  function update<K extends keyof Persona>(key: K, value: Persona[K]) {
    if (!persona) return;
    setPersona({ ...persona, [key]: value });
  }

  return (
    <div className="p-2 space-y-6 max-w-xl">
      <h1 className="text-2xl font-semibold mb-4">Persona settings</h1>



      {error && <div className="text-red-500 mb-2">{error}</div>}

      {loading || !persona ? (
        <div>Loading...</div>
      ) : (
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="block text-sm mb-1">
              Speech rate (0.5–2.0)
            </label>
            <input
              type="number"
              step="0.1"
              min={0.5}
              max={2.0}
              className="border rounded px-2 py-1 w-full"
              value={persona.speech_rate}
              onChange={e =>
                update('speech_rate', Number(e.target.value) || 1.0)
              }
            />
          </div>

          <div>
            <label className="block text-sm mb-1">
              Humor level (0–1)
            </label>
            <input
              type="number"
              step="0.1"
              min={0}
              max={1}
              className="border rounded px-2 py-1 w-full"
              value={persona.humor_level}
              onChange={e =>
                update('humor_level', Number(e.target.value) || 0)
              }
            />
          </div>

          <div>
            <label className="block text-sm mb-1">Tone</label>
            <select
              className="border rounded px-2 py-1 w-full"
              value={persona.tone}
              onChange={e => update('tone', e.target.value)}
            >
              <option value="neutral">Neutral</option>
              <option value="casual_friendly">Casual friendly</option>
              <option value="formal">Formal</option>
            </select>
          </div>

          <div>
            <label className="block text-sm mb-1">Greeting message</label>
            <textarea
              className="border rounded px-2 py-1 w-full"
              rows={3}
              value={persona.greeting}
              onChange={e => update('greeting', e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm mb-1">Farewell message</label>
            <textarea
              className="border rounded px-2 py-1 w-full"
              rows={3}
              value={persona.farewell}
              onChange={e => update('farewell', e.target.value)}
            />
          </div>

          <button
  type="submit"
  className="btn btn-primary"
  disabled={saving}
>
  {saving ? 'Saving...' : 'Save persona'}
</button>

        </form>
      )}
    </div>
  );
}
