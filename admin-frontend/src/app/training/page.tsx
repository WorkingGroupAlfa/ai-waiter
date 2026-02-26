'use client';

import React, { useEffect, useState } from 'react';
import { apiClient } from '../../lib/api';
import { ensureAdminToken } from '../../lib/auth';

interface DialogRow {
  out_event_id: string;
  in_event_id?: string;
  session_id?: string;
  device_id?: string;
  user_text?: string;
  bot_reply?: string;
  bot_time?: string;
}

interface SynonymRow {
  id: string;
  restaurant_id: string;
  locale?: string;
  phrase: string;
  canonical: string;
  created_at: string;
}

const RESTAURANT_ID = 'azuma_demo';

export default function TrainingPage() {
  const [dialogs, setDialogs] = useState<DialogRow[]>([]);
  const [synonyms, setSynonyms] = useState<SynonymRow[]>([]);
  const [loadingDialogs, setLoadingDialogs] = useState(false);
  const [loadingSynonyms, setLoadingSynonyms] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [synPhrase, setSynPhrase] = useState('');
  const [synCanonical, setSynCanonical] = useState('');
  const [synLocale, setSynLocale] = useState('');

  useEffect(() => {
    ensureAdminToken();
    loadDialogs();
    loadSynonyms();
  }, []);

  async function loadDialogs() {
    setLoadingDialogs(true);
    setError(null);
    try {
      const res = await apiClient.get('/admin/ai/dialogs', {
        params: { limit: 50 },
      });
      setDialogs(res.data.dialogs || []);
    } catch (err: any) {
      console.error(err);
      setError('Failed to load dialogs');
    } finally {
      setLoadingDialogs(false);
    }
  }

  async function loadSynonyms() {
    setLoadingSynonyms(true);
    setError(null);
    try {
      const res = await apiClient.get('/admin/ai/synonyms', {
        params: { restaurant_id: RESTAURANT_ID },
      });
      setSynonyms(res.data.synonyms || []);
    } catch (err: any) {
      console.error(err);
      setError(prev => prev || 'Failed to load synonyms');
    } finally {
      setLoadingSynonyms(false);
    }
  }

  async function markWrong(dialog: DialogRow) {
    try {
      await apiClient.post('/admin/ai/bad-answer', {
        restaurant_id: RESTAURANT_ID,
        session_id: dialog.session_id,
        device_id: dialog.device_id,
        in_event_id: dialog.in_event_id,
        out_event_id: dialog.out_event_id,
        user_text: dialog.user_text,
        bot_reply: dialog.bot_reply,
        comment: 'Marked as wrong answer from admin panel',
      });
      // ничего не перезагружаем, просто помечаем визуально
      alert('Marked as wrong answer');
    } catch (err: any) {
      console.error(err);
      alert('Failed to mark as wrong answer');
    }
  }

  async function handleAddSynonym(e: React.FormEvent) {
    e.preventDefault();
    if (!synPhrase || !synCanonical) return;

    try {
      await apiClient.post('/admin/ai/synonyms', {
        restaurant_id: RESTAURANT_ID,
        locale: synLocale || null,
        phrase: synPhrase,
        canonical: synCanonical,
      });

      setSynPhrase('');
      setSynCanonical('');
      setSynLocale('');
      await loadSynonyms();
    } catch (err: any) {
      console.error(err);
      alert('Failed to add synonym');
    }
  }

  return (
    <div className="p-2 space-y-4">
      <h1 className="text-2xl font-semibold mb-2">AI training</h1>



      {error && <div className="text-red-500">{error}</div>}

      {/* Диалоги */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recent dialogs</h2>
          <button
            className="border px-3 py-1 text-sm rounded"
            onClick={loadDialogs}
            disabled={loadingDialogs}
          >
            Reload
          </button>
        </div>

        {loadingDialogs && <div>Loading dialogs...</div>}

        {!loadingDialogs && dialogs.length === 0 && (
          <div className="text-sm text-gray-500">No dialogs found.</div>
        )}

        {!loadingDialogs && dialogs.length > 0 && (
          <table className="min-w-full border text-sm mt-2">
            <thead>
              <tr className="bg-gray-100">
                <th className="border px-2 py-1">User</th>
                <th className="border px-2 py-1">Bot reply</th>
                <th className="border px-2 py-1">Time</th>
                <th className="border px-2 py-1">Actions</th>
              </tr>
            </thead>
            <tbody>
              {dialogs.map(d => (
                <tr key={d.out_event_id}>
                  <td className="border px-2 py-1 align-top max-w-xs">
                    {d.user_text || <span className="text-gray-400">–</span>}
                  </td>
                  <td className="border px-2 py-1 align-top max-w-xs">
                    {d.bot_reply || <span className="text-gray-400">–</span>}
                  </td>
                  <td className="border px-2 py-1 align-top whitespace-nowrap">
                    {d.bot_time ? new Date(d.bot_time).toLocaleString() : '–'}
                  </td>
                  <td className="border px-2 py-1 align-top">
                    <button
                      className="border px-2 py-1 text-xs rounded"
                      onClick={() => markWrong(d)}
                    >
                      Mark wrong
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Синонимы */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Synonyms</h2>

        <form
          onSubmit={handleAddSynonym}
          className="flex flex-wrap gap-2 items-end text-sm"
        >
          <div className="flex flex-col gap-1">
            <label>Phrase</label>
            <input
              className="border rounded px-2 py-1"
              value={synPhrase}
              onChange={e => setSynPhrase(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <label>Canonical</label>
            <input
              className="border rounded px-2 py-1"
              value={synCanonical}
              onChange={e => setSynCanonical(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <label>Locale (optional)</label>
            <input
              className="border rounded px-2 py-1"
              value={synLocale}
              onChange={e => setSynLocale(e.target.value)}
              placeholder="en / ru / uk"
            />
          </div>
          <button type="submit" className="btn btn-primary">
  Add synonym
</button>

        </form>

        {loadingSynonyms && <div>Loading synonyms...</div>}

        {!loadingSynonyms && synonyms.length === 0 && (
          <div className="text-sm text-gray-500">No synonyms yet.</div>
        )}

        {!loadingSynonyms && synonyms.length > 0 && (
          <table className="min-w-full border text-sm mt-2">
            <thead>
              <tr className="bg-gray-100">
                <th className="border px-2 py-1">Phrase</th>
                <th className="border px-2 py-1">Canonical</th>
                <th className="border px-2 py-1">Locale</th>
                <th className="border px-2 py-1">Created</th>
              </tr>
            </thead>
            <tbody>
              {synonyms.map(s => (
                <tr key={s.id}>
                  <td className="border px-2 py-1">{s.phrase}</td>
                  <td className="border px-2 py-1">{s.canonical}</td>
                  <td className="border px-2 py-1">{s.locale || '–'}</td>
                  <td className="border px-2 py-1">
                    {new Date(s.created_at).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
