'use client';
// src/app/ask-aaria/page.jsx
//
// New, additive entry point for the Aaria voice-control-plane. Separate from
// the existing voice capture / parse-intent pipeline (src/app/api/parse-intent,
// src/app/voice) — this page just sends free text to /api/aaria (a new proxy
// route to pranix-aaria) and shows the resolved intent back to the user.
import { useState } from 'react';
import { useAuth } from '@/lib/context/auth';
import { apiPost } from '@/lib/safeFetch';
import NavbarClient from '@/components/NavbarClient';

export default function AskAariaPage() {
  const { accessToken } = useAuth();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');

  async function ask() {
    const text = query.trim();
    if (!text) return;
    setLoading(true);
    setErr('');
    setResult(null);
    const { data, error } = await apiPost('/api/aaria', { text, lang_hint: 'en' }, accessToken);
    if (error) setErr(error);
    else setResult(data);
    setLoading(false);
  }

  return (
    <div className="qk-page">
      <NavbarClient />
      <div className="qk-container">
        <div style={{ marginBottom: 24 }}>
          <div className="qk-h1">Ask Aaria</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
            Voice-assistant powered help, e.g. saving a note or listing your notes
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') ask(); }}
            placeholder="e.g. Save a note to call the plumber tomorrow"
            style={{
              flex: 1, borderRadius: 10, border: '1px solid var(--border)',
              background: 'var(--input-bg, var(--bg-raised))', color: 'var(--text)',
              padding: '10px 12px', fontSize: 14,
            }}
          />
          <button
            onClick={ask}
            disabled={loading || !query.trim()}
            style={{
              background: 'var(--accent, #6366f1)', color: '#fff', border: 'none',
              borderRadius: 10, padding: '10px 16px', fontSize: 14, fontWeight: 600,
              opacity: loading || !query.trim() ? 0.5 : 1,
              cursor: loading || !query.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? '...' : 'Ask'}
          </button>
        </div>

        {err && (
          <div style={{ marginTop: 12, fontSize: 12, color: '#f87171' }}>
            ⚠️ {err}
          </div>
        )}

        {result && !err && (
          <div style={{ marginTop: 16, background: 'var(--bg-raised)', borderRadius: 10, padding: 12, fontSize: 13, color: 'var(--text)' }}>
            <div><strong>Intent:</strong> {result.intent ?? 'unknown'}</div>
            {typeof result.confidence === 'number' && (
              <div><strong>Confidence:</strong> {(result.confidence * 100).toFixed(0)}%</div>
            )}
            {result.engine_used && <div><strong>Engine:</strong> {result.engine_used}</div>}
            {result.visual_companion?.expression && (
              <div><strong>Expression:</strong> {result.visual_companion.expression}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
