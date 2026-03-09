// File: src/components/KeepAIAssist.jsx
// NEW FILE — Per-Keep AI Assistant panel (Sprint 1, Step 6)
// Usage: import KeepAIAssist from '@/components/KeepAIAssist';
//        <KeepAIAssist keepId={intent.id} content={intent.content} intentType={intent.intent_type} />
'use client';
import { useState } from 'react';

const ACTIONS = [
  { id: 'suggest', label: '💡 Suggest', desc: 'Next steps' },
  { id: 'breakdown', label: '📋 Break Down', desc: 'Sub-tasks' },
  { id: 'deadline', label: '📅 Deadline', desc: 'When to do it' },
  { id: 'reminder', label: '⏰ Reminder', desc: 'Best time' },
];

export default function KeepAIAssist({ keepId, content, intentType }) {
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
        headers: { 'Content-Type': 'application/json' },
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
        style={{ padding:'4px 10px', borderRadius:20, border:'1px solid #6366f133', background:'#6366f108', color:'#818cf8', fontSize:'10px', fontWeight:600, cursor:'pointer', marginTop:'6px', display:'inline-flex', alignItems:'center', gap:4 }}
      >
        ✨ AI Assist
      </button>
    );
  }

  return (
    <div style={{ marginTop:'10px', background:'#0d0d1a', border:'1px solid #6366f130', borderRadius:10, padding:'10px', fontSize:'12px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'8px' }}>
        <span style={{ color:'#818cf8', fontWeight:700 }}>✨ AI Assist</span>
        <button onClick={() => { setOpen(false); setResult(null); }} style={{ background:'none', border:'none', color:'#475569', cursor:'pointer', fontSize:'14px' }}>✕</button>
      </div>

      {/* Action Tabs */}
      <div style={{ display:'flex', gap:'6px', marginBottom:'8px', flexWrap:'wrap' }}>
        {ACTIONS.map(a => (
          <button key={a.id} onClick={() => askAI(a.id)} disabled={loading} style={{ padding:'4px 10px', borderRadius:20, border:`1px solid ${action===a.id && result ? '#6366f1' : '#334155'}`, background: action===a.id && result ? '#6366f122' : 'transparent', color: action===a.id && result ? '#818cf8' : '#94a3b8', fontSize:'10px', cursor:'pointer', fontWeight: action===a.id ? 600 : 400 }}>
            {a.label}
          </button>
        ))}
      </div>

      {loading && (
        <div style={{ textAlign:'center', padding:'10px', color:'#6366f1', fontSize:'11px' }}>
          <span style={{ display:'inline-block', animation:'spin 1s linear infinite' }}>⟳</span> Thinking…
          <style>{`@keyframes spin { to { transform: rotate(360deg); }}`}</style>
        </div>
      )}

      {err && <div style={{ color:'#ef4444', fontSize:'11px', padding:'6px' }}>{err}</div>}

      {result && !loading && (
        <div style={{ background:'#111827', borderRadius:8, padding:'8px' }}>
          {Array.isArray(result) ? (
            <ul style={{ margin:0, paddingLeft:'14px', color:'#cbd5e1', lineHeight:'1.6' }}>
              {result.map((item, i) => <li key={i} style={{ marginBottom:'3px' }}>{item}</li>)}
            </ul>
          ) : (
            <div style={{ color:'#cbd5e1', lineHeight:'1.6' }}>
              {result.deadline && <div>📅 <b>Deadline:</b> {result.deadline}</div>}
              {result.reason && <div style={{ color:'#94a3b8', marginTop:'2px' }}>{result.reason}</div>}
              {result.time && <div>⏰ <b>Best time:</b> {result.time} — {result.when}</div>}
            </div>
          )}
          {subCreated && <div style={{ color:'#22c55e', fontSize:'10px', marginTop:'6px' }}>✓ Sub-tasks created in your keeps</div>}
        </div>
      )}
    </div>
  );
}
