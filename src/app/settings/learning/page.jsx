'use client';
// src/app/settings/learning/page.jsx — "What Aaria learned" (T29, 22 Nov 2026)
// The person chooses how Aaria learns, sees every habit she noticed, and says
// yes, no or forget to each. They can also teach her something directly.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/context/auth';

const P = '#6366f1';
const MODES = [
  { v: 'hybrid', t: 'Hybrid (recommended)', d: 'Aaria learns by herself. The first time she wants to use something she learned, she asks you once. Yes means she does it from then on; no means she never asks again.' },
  { v: 'ask_first', t: 'Ask me first', d: 'Aaria uses nothing she learned until you approve it here. You can also teach her things yourself.' },
  { v: 'let_act', t: 'Let her act', d: 'Aaria uses habits she is sure about straight away. She still asks when she is not sure.' },
];
const card = { background: 'var(--surface, #fff)', border: '1px solid var(--border, #e5e7eb)', borderRadius: 14, padding: 16, marginBottom: 12 };
const btn = (bg, fg = '#fff') => ({ background: bg, color: fg, border: 'none', borderRadius: 10, padding: '8px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer' });

export default function LearningPage() {
  const { accessToken, loading: authLoading } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [teach, setTeach] = useState('');

  const call = useCallback(async (method, body) => {
    if (!accessToken) return;
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/aaria/learned', {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: body ? JSON.stringify(body) : undefined,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setError(j.error || 'Something went wrong. Please try again.');
      else setData(j);
    } catch {
      setError('No connection. Please try again.');
    } finally {
      setBusy(false);
    }
  }, [accessToken]);

  useEffect(() => { call('GET'); }, [call]);

  const habits = data?.habits || [];
  const waiting = habits.filter((h) => h.status === 'learned');
  const answered = habits.filter((h) => h.status !== 'learned');

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '16px 16px 96px', color: 'var(--text, #111827)' }}>
      <Link href="/more" style={{ color: P, fontSize: 14, textDecoration: 'none' }}>← Back</Link>
      <h1 style={{ fontSize: 22, margin: '12px 0 4px' }}>What Aaria learned</h1>
      <p style={{ color: 'var(--text-muted, #6b7280)', fontSize: 14, margin: '0 0 16px' }}>
        Aaria notices your habits so she can help before you ask. Only you can see this. Money, sharing your location and
        calling unknown numbers always need your fingerprint; SOS is never blocked.
      </p>

      {authLoading || (!data && !error) ? <p>Loading…</p> : null}
      {error ? <p role="alert" style={{ color: '#b91c1c' }}>{error}</p> : null}

      {data ? (
        <>
          <section style={card}>
            <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>How Aaria learns</h2>
            {MODES.map((m) => (
              <label key={m.v} style={{ display: 'flex', gap: 10, padding: '8px 0', cursor: 'pointer' }}>
                <input type="radio" name="mode" checked={data.mode === m.v} disabled={busy}
                  onChange={() => call('POST', { mode: m.v })} />
                <span>
                  <strong style={{ fontSize: 14 }}>{m.t}</strong>
                  <span style={{ display: 'block', color: 'var(--text-muted, #6b7280)', fontSize: 13 }}>{m.d}</span>
                </span>
              </label>
            ))}
          </section>

          <section style={card}>
            <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Habits Aaria noticed</h2>
            {waiting.length === 0 ? (
              <p style={{ color: 'var(--text-muted, #6b7280)', fontSize: 14, margin: 0 }}>
                Nothing new yet. Aaria needs to see something on 3 different days before she counts it as a habit.
              </p>
            ) : waiting.map((h) => (
              <div key={h.id} style={{ borderTop: '1px solid var(--border, #e5e7eb)', padding: '10px 0' }}>
                <p style={{ margin: '0 0 8px', fontSize: 14 }}>{h.sentence}</p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button style={btn(P)} disabled={busy} onClick={() => call('POST', { action: 'confirm', id: h.id })}>Yes, help me with this</button>
                  <button style={btn('#e5e7eb', '#111827')} disabled={busy} onClick={() => call('POST', { action: 'decline', id: h.id })}>No</button>
                  <button style={btn('transparent', '#b91c1c')} disabled={busy} onClick={() => call('POST', { action: 'forget', id: h.id })}>Forget this</button>
                </div>
              </div>
            ))}
          </section>

          <section style={card}>
            <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Teach Aaria something</h2>
            <p style={{ color: 'var(--text-muted, #6b7280)', fontSize: 13, margin: '0 0 8px' }}>
              For example: &quot;My office is in Hitech City&quot; or &quot;I buy milk every evening&quot;.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={teach} onChange={(e) => setTeach(e.target.value)} maxLength={200} placeholder="Type it here"
                aria-label="Something for Aaria to remember"
                style={{ flex: 1, border: '1px solid var(--border, #d1d5db)', borderRadius: 10, padding: '8px 10px', fontSize: 14 }} />
              <button style={btn(P)} disabled={busy || !teach.trim()}
                onClick={async () => { await call('POST', { action: 'teach', text: teach }); setTeach(''); }}>Remember</button>
            </div>
          </section>

          {answered.length ? (
            <section style={card}>
              <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>Your answers</h2>
              {answered.map((h) => (
                <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, borderTop: '1px solid var(--border, #e5e7eb)', padding: '8px 0' }}>
                  <span style={{ fontSize: 14 }}>
                    {h.sentence}{' '}
                    <em style={{ color: 'var(--text-muted, #6b7280)', fontSize: 12 }}>
                      {h.status === 'confirmed' ? (h.kind === 'fact' ? 'remembered' : 'she helps with this') : 'she will not ask again'}
                    </em>
                  </span>
                  <button style={btn('transparent', '#b91c1c')} disabled={busy} onClick={() => call('POST', { action: 'forget', id: h.id })}>Forget</button>
                </div>
              ))}
            </section>
          ) : null}
        </>
      ) : null}
    </main>
  );
}
