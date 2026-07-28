'use client';
// src/app/b/team/invite/page.jsx — issue & manage staff invites
// Owners create an invite → get a shareable /b/join link (copy or WhatsApp).
// Completes the staff invite→accept→auth flow (real users, not HR records).
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';

const G = '#0e9f6e';
const ROLES = [
  { v: 'staff', label: 'Staff' },
  { v: 'supervisor', label: 'Supervisor' },
  { v: 'manager', label: 'Manager' },
  { v: 'accountant', label: 'Accountant' },
];

export default function TeamInvitePage() {
  const [token, setToken] = useState(null);
  const [workspaceId, setWorkspaceId] = useState(null);
  const [members, setMembers] = useState([]);
  const [form, setForm] = useState({ name: '', phone: '', email: '', access_role: 'staff' });
  const [invite, setInvite] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const loadMembers = useCallback(async (wsId) => {
    if (!wsId) return;
    const { data } = await supabase
      .from('business_members')
      .select('id,name,phone,access_role,status,created_at')
      .eq('workspace_id', wsId)
      .order('created_at', { ascending: false });
    setMembers(data || []);
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      setToken(session.access_token);
      const { data: ws } = await supabase
        .from('business_workspaces')
        .select('id')
        .eq('owner_user_id', session.user.id)
        .maybeSingle();
      if (ws) { setWorkspaceId(ws.id); loadMembers(ws.id); }
    })();
  }, [loadMembers]);

  async function submit(e) {
    e.preventDefault();
    setError(''); setInvite(null); setCopied(false);
    if (!form.name && !form.phone && !form.email) { setError('Enter a name, phone or email.'); return; }
    setBusy(true);
    try {
      const res = await fetch('/api/business/team/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create invite.');
      setInvite(data);
      setForm({ name: '', phone: '', email: '', access_role: 'staff' });
      loadMembers(workspaceId);
    } catch (e2) {
      setError(e2.message);
    } finally {
      setBusy(false);
    }
  }

  function copyLink() {
    if (!invite?.invite_url) return;
    navigator.clipboard?.writeText(invite.invite_url).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 1800);
    });
  }

  const waHref = invite
    ? `https://wa.me/?text=${encodeURIComponent(`You're invited to our QuietKeep Business workspace. Tap to join: ${invite.invite_url}`)}`
    : '#';

  return (
    <div style={{ maxWidth: 520, margin: '0 auto', padding: 16, fontFamily: "'Inter',-apple-system,sans-serif" }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <Link href="/b/team" style={{ color: G, textDecoration: 'none', fontWeight: 700, fontSize: 14 }}>← Team</Link>
      </div>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '4px 0' }}>Invite staff</h1>
      <p style={{ color: '#64748b', fontSize: 14, margin: '0 0 16px' }}>
        Send a join link. When they sign in and open it, they become a real member — able to mark their own attendance, chat, and pick up tasks.
      </p>

      <form onSubmit={submit} style={card}>
        <label style={lbl}>Name
          <input style={inp} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Ramesh" />
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label style={lbl}>Phone
            <input style={inp} value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="Optional" inputMode="tel" />
          </label>
          <label style={lbl}>Role
            <select style={inp} value={form.access_role} onChange={e => setForm(f => ({ ...f, access_role: e.target.value }))}>
              {ROLES.map(r => <option key={r.v} value={r.v}>{r.label}</option>)}
            </select>
          </label>
        </div>
        <label style={lbl}>Email
          <input style={inp} value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="Optional — locks the invite to this email" inputMode="email" />
        </label>
        {error && <p style={{ color: '#dc2626', fontSize: 13, margin: 0 }}>{error}</p>}
        <button type="submit" disabled={busy || !token} style={btn}>{busy ? 'Creating…' : 'Create invite link'}</button>
      </form>

      {invite && (
        <div style={{ ...card, borderColor: G, marginTop: 14 }}>
          <strong style={{ fontSize: 15 }}>Invite ready 🎉</strong>
          <div style={{ background: '#f1f5f9', borderRadius: 10, padding: '10px 12px', fontSize: 13, wordBreak: 'break-all' }}>{invite.invite_url}</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={copyLink} style={{ ...btn, flex: 1 }}>{copied ? 'Copied ✓' : 'Copy link'}</button>
            <a href={waHref} target="_blank" rel="noreferrer" style={{ ...btn, flex: 1, textDecoration: 'none', textAlign: 'center', background: '#25D366' }}>WhatsApp</a>
          </div>
          <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>Single-use link. The person must be signed in to QuietKeep, then open it.</p>
        </div>
      )}

      <h2 style={{ fontSize: 16, fontWeight: 800, margin: '22px 0 10px' }}>Team ({members.length})</h2>
      <div style={{ display: 'grid', gap: 8 }}>
        {members.length === 0 && <p style={{ color: '#94a3b8', fontSize: 14 }}>No members yet.</p>}
        {members.map(m => (
          <div key={m.id} style={{ ...card, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{m.name || m.phone || 'Member'}</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>{m.access_role || 'staff'}</div>
            </div>
            <span style={badge(m.status)}>{m.status || 'active'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const card = { display: 'flex', flexDirection: 'column', gap: 12, background: '#fff', border: '1px solid rgba(0,0,0,.09)', borderRadius: 16, padding: 16, boxShadow: '0 6px 20px rgba(80,90,160,.07)' };
const lbl = { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, fontWeight: 600, color: '#334155' };
const inp = { padding: '11px 13px', border: '1.5px solid rgba(0,0,0,.12)', borderRadius: 10, fontSize: 15, outline: 'none', fontFamily: 'inherit' };
const btn = { padding: '12px 18px', border: 0, borderRadius: 12, background: G, color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 15 };
function badge(status) {
  const map = { active: ['#065f46', '#d1fae5'], invited: ['#92400e', '#fef3c7'] };
  const [c, b] = map[String(status || 'active').toLowerCase()] || ['#334155', '#e2e8f0'];
  return { fontSize: 11, fontWeight: 700, color: c, background: b, padding: '4px 10px', borderRadius: 999, textTransform: 'capitalize' };
}
