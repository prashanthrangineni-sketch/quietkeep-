// File: src/components/KeepAIAssist.jsx
// FIX 2: Accepts accessToken prop and passes it as Authorization header
'use client';
import { useState } from 'react';

const ACTIONS = [
  { id: 'suggest', label: '💡 Suggest', desc: 'Next steps' },
  { id: 'breakdown', label: '📋 Break Down', desc: 'Sub-tasks' },
  { id: 'deadline', label: '📅 Deadline', desc: 'When to do it' },
  { id: 'reminder', label: '⏰ Reminder', desc: 'Best time' },
];

export default function KeepAIAssist({ keepId, content, intentType, accessToken }) {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState('suggest');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const [subCreated, setSubCreated] = useState(false);

  async function askAI(selectedAction) {
    setAction(selectedAction);
    setLoading(true); setResult(null); setErr(''); setSubCreated(false);
    try {
      const res = await fetch('/api/keep-assist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // FIX 2: Send Bearer token so API route can authenticate
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ keepId, content, intent_type: intentType, action: selectedAction }),
      });
      const data = await res.json();
      if (data.error) { setErr(data.error); }
      else { setResult(data.result); if (selectedAction === 'breakdown') setSubCreated(true); }
    } catch (e) { setErr(String(e)); }
    setLoading(false);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          padding: '8px 14px', borderRadius: 20, border: '1px solid #6366f133',
          background: '#6366f108', color: '#818cf8', fontSize: '11px',
          fontWeight: 600, cursor: 'pointer', marginTop: '8px',
          display: 'inline-flex', alignItems: 'center', gap: 4,
          minHeight: '36px', WebkitTapHighlightColor: 'transparent',
        }}
      >
        ✨ AI Assist
      </button>
    );
  }

  return (
    <div style={{ marginTop: '10px', background: '#0d0d1a', border: '1px solid #6366f130', borderRadius: 10, padding: '12px', fontSize: '12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <span style={{ color: '#818cf8', fontWeight: 700 }}>✨ AI Assist</span>
        <button
          onClick={() => { setOpen(false); setResult(null); }}
          style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: '18px', width: '36px', height: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px' }}
        >✕</button>
      </div>

      {/* Action buttons — min 36px height for mobile */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '10px', flexWrap: 'wrap' }}>
        {ACTIONS.map(a => (
          <button
            key={a.id}
            onClick={() => askAI(a.id)}
            disabled={loading}
            style={{
              padding: '8px 12px', borderRadius: 20, minHeight: '36px',
              border: `1px solid ${action === a.id && result ? '#6366f1' : '#334155'}`,
              background: action === a.id && result ? '#6366f122' : 'transparent',
              color: action === a.id && result ? '#818cf8' : '#94a3b8',
              fontSize: '11px', cursor: loading ? 'not-allowed' : 'pointer',
              fontWeight: action === a.id ? 600 : 400,
              opacity: loading ? 0.6 : 1,
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {a.label}
          </button>
        ))}
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '12px', color: '#6366f1', fontSize: '12px' }}>
          <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite', fontSize: '16px' }}>⟳</span>
          <span style={{ marginLeft: '8px' }}>Thinking…</span>
          <style>{`@keyframes spin { to { transform: rotate(360deg); }}`}</style>
        </div>
      )}

      {err && (
        <div style={{ color: '#ef4444', fontSize: '11px', padding: '8px', background: 'rgba(239,68,68,0.08)', borderRadius: '6px', border: '1px solid rgba(239,68,68,0.2)' }}>
          {err === 'Unauthorized' ? '⚠️ Session expired — please refresh the page' : err}
        </div>
      )}

      {result && !loading && (
        <div style={{ background: '#111827', borderRadius: 8, padding: '10px' }}>
          {Array.isArray(result) ? (
            <ul style={{ margin: 0, paddingLeft: '16px', color: '#cbd5e1', lineHeight: '1.7' }}>
              {result.map((item, i) => <li key={i} style={{ marginBottom: '4px', fontSize: '12px' }}>{item}</li>)}
            </ul>
          ) : (
            <div style={{ color: '#cbd5e1', lineHeight: '1.6', fontSize: '12px' }}>
              {result.deadline && <div style={{ marginBottom: '4px' }}>📅 <strong>Deadline:</strong> {result.deadline}</div>}
              {result.reason && <div style={{ marginBottom: '4px', color: '#94a3b8' }}>{result.reason}</div>}
              {result.time && <div style={{ marginBottom: '4px' }}>⏰ <strong>Best time:</strong> {result.time}</div>}
              {result.when && <div style={{ color: '#94a3b8' }}>{result.when}</div>}
              {typeof result === 'string' && <div>{result}</div>}
            </div>
          )}
          {subCreated && (
            <div style={{ marginTop: '8px', fontSize: '11px', color: '#22c55e', padding: '6px 8px', background: 'rgba(34,197,94,0.08)', borderRadius: '6px' }}>
              ✓ Sub-tasks saved to your keeps
            </div>
          )}
        </div>
      )}
    </div>
  );
}
