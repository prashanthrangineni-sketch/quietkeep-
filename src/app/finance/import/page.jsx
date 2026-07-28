'use client';
// src/app/finance/import/page.jsx — paste or share a payment SMS → auto expense
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/context/auth';

const P = '#5b5ef4';
const CATS = ['food','groceries','transport','shopping','health','entertainment','bills','education','travel','other'];

export default function ImportExpensePage() {
  const { accessToken } = useAuth();
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState(null);
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('other');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  // Prefill from a share-target (?text=...) so a shared SMS lands here directly.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const shared = q.get('text') || q.get('sms') || q.get('body');
    if (shared) { setText(shared); }
  }, []);

  async function scan() {
    setError(''); setNote(''); setDone(false); setParsed(null);
    if (!text.trim()) { setError('Paste a payment message first.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/finance/sms-expense', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ text, preview: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not read that message.');
      const p = data.parsed;
      setParsed(p);
      setAmount(p.amount ? String(p.amount) : '');
      setCategory(p.category || 'other');
      setDesc(p.party ? `Paid ${p.party}` : 'UPI payment');
      if (!p.isPayment) setNote('No payment amount detected — you can still fill it in manually.');
      else if (p.direction === 'credit') setNote('This looks like money received, not an expense.');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function add() {
    setError(''); setBusy(true);
    try {
      const res = await fetch('/api/finance/sms-expense', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ text, amount: Number(amount), category, description: desc }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not add expense.');
      if (!data.created) { setNote(data.note || 'Nothing was added.'); }
      else { setDone(true); setText(''); setParsed(null); }
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', padding: 16, fontFamily: "'Inter',-apple-system,sans-serif" }}>
      <Link href="/finance" style={{ color: P, textDecoration: 'none', fontWeight: 700, fontSize: 14 }}>← Finance</Link>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '4px 0' }}>Add expense from a message</h1>
      <p style={{ color: '#64748b', fontSize: 14, margin: '0 0 16px' }}>
        Paste a UPI / bank / card SMS (or share one into QuietKeep) and it becomes an expense — no typing amounts.
      </p>

      <textarea value={text} onChange={e => setText(e.target.value)} rows={4}
        placeholder="e.g. Rs.240 debited from a/c XX1234 to SWIGGY via UPI ref 4501…"
        style={ta} />
      <button onClick={scan} disabled={busy} style={{ ...btn, marginTop: 10 }}>{busy ? 'Reading…' : 'Read message'}</button>

      {note && <p style={{ color: '#b45309', fontSize: 13, marginTop: 10 }}>{note}</p>}
      {error && <p style={{ color: '#dc2626', fontSize: 13, marginTop: 10 }}>{error}</p>}

      {parsed && (
        <div style={card}>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
            Detected: {parsed.direction || 'unknown'} · {parsed.method || 'upi'}{parsed.party ? ` · ${parsed.party}` : ''}
          </div>
          <label style={lbl}>Amount (₹)
            <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" style={inp} />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={lbl}>Category
              <select value={category} onChange={e => setCategory(e.target.value)} style={inp}>
                {CATS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label style={lbl}>Note
              <input value={desc} onChange={e => setDesc(e.target.value)} style={inp} />
            </label>
          </div>
          <button onClick={add} disabled={busy || !amount} style={{ ...btn, marginTop: 12 }}>
            {busy ? 'Adding…' : 'Add expense'}
          </button>
        </div>
      )}

      {done && (
        <div style={{ ...card, background: '#ecfdf5', borderColor: '#10b981', color: '#065f46', fontWeight: 600 }}>
          ✅ Expense added. Paste another to keep going.
        </div>
      )}
    </div>
  );
}

const ta = { width: '100%', padding: '13px 14px', border: '1.5px solid rgba(0,0,0,.12)', borderRadius: 12, fontSize: 15, fontFamily: 'inherit', outline: 'none', resize: 'vertical', boxSizing: 'border-box' };
const card = { marginTop: 14, background: '#fff', border: '1px solid rgba(0,0,0,.1)', borderRadius: 16, padding: 16, boxShadow: '0 6px 20px rgba(80,90,160,.07)' };
const lbl = { display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 10 };
const inp = { display: 'block', width: '100%', marginTop: 5, padding: '10px 12px', border: '1.5px solid rgba(0,0,0,.12)', borderRadius: 10, fontSize: 15, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' };
const btn = { width: '100%', padding: '13px 18px', border: 0, borderRadius: 12, background: P, color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer' };
