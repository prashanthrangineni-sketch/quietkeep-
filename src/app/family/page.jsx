'use client';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import NavbarClient from '@/components/NavbarClient';


function LocationShare({ userId }) {
  const [sharing, setSharing] = useState(false);
  const [pos, setPos] = useState(null);
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);

  async function shareLocation() {
    if (!navigator.geolocation) { setErr('Geolocation not supported on this device'); return; }
    setSharing(true); setErr('');
    navigator.geolocation.getCurrentPosition(async (position) => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;
      setPos({ lat, lng });
      const { createBrowserClient } = await import('@supabase/ssr');
      const sb = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
      await sb.from('family_members').update({
        location_sharing: true, last_lat: lat, last_lng: lng,
        last_location_at: new Date().toISOString(),
      }).eq('owner_user_id', userId);
      setSaved(true); setSharing(false);
    }, (e) => { setErr('Location access denied or unavailable'); setSharing(false); });
  }

  return (
    <div>
      {pos && saved && (
        <div style={{ background: '#0d2d1a', border: '1px solid #22c55e33', borderRadius: 8, padding: '10px 14px', marginBottom: 10, fontSize: 13, color: '#22c55e' }}>
          ✓ Location shared — {pos.lat.toFixed(4)}, {pos.lng.toFixed(4)}
          <a href={`https://maps.google.com/?q=${pos.lat},${pos.lng}`} target="_blank" rel="noreferrer" style={{ color: '#22c55e', marginLeft: 8, fontSize: 11 }}>Open in Maps ↗</a>
        </div>
      )}
      {err && <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 8 }}>{err}</div>}
      <button onClick={shareLocation} disabled={sharing} style={{ padding: '9px 16px', background: sharing ? '#334155' : '#10b98122', border: '1px solid #10b98133', borderRadius: 8, color: '#10b981', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
        {sharing ? '📍 Getting location…' : '📍 Share My Current Location'}
      </button>
      <div style={{ color: '#475569', fontSize: 11, marginTop: 6 }}>Your location is only shared when you tap this button — never automatically.</div>
    </div>
  );
}

export default function FamilyPage() {
  const [user, setUser] = useState(null);
  const [accessToken, setAccessToken] = useState('');
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState({ text: '', type: 'success' });
  const [pendingToken, setPendingToken] = useState(null);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('invite');
    if (token) setPendingToken(token);
    init();
  }, []);

  async function init() {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    setUser(user || null);
    if (session?.access_token) setAccessToken(session.access_token);
    if (user) {
      await Promise.all([loadMembers(user.id), loadInvites(user.id)]);
    }
    setLoading(false);
  }

  async function loadMembers(uid) {
    const { data } = await supabase
      .from('family_members')
      .select('*')
      .eq('owner_user_id', uid)
      .order('created_at', { ascending: false });
    setMembers(data || []);
  }

  async function loadInvites(uid) {
    const { data } = await supabase
      .from('family_invites')
      .select('*')
      .eq('owner_user_id', uid)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    setInvites(data || []);
  }

  async function sendInvite() {
    if (!email.trim()) return;
    setSending(true);
    setMsg({ text: '', type: 'success' });
    const { data, error } = await supabase
      .from('family_invites')
      .insert({ owner_user_id: user.id, invitee_email: email.trim().toLowerCase(), role })
      .select()
      .single();
    if (error) {
      setMsg({ text: 'Error: ' + error.message, type: 'error' });
      setSending(false);
      return;
    }
    const link = `${window.location.origin}/family?invite=${data.token}`;

    // Try to send email via API
    try {
      const emailRes = await fetch('/api/family/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
        body: JSON.stringify({
          inviteeEmail: email.trim().toLowerCase(),
          inviteLink: link,
          inviterName: user.user_metadata?.full_name || user.email,
          role,
        }),
      });
      const emailData = await emailRes.json();
      if (emailData.sent) {
        setMsg({ text: `Invite email sent to ${email.trim()} ✓`, type: 'success' });
      } else {
        // Email not configured — fall back to clipboard
        await navigator.clipboard.writeText(link).catch(() => {});
        setMsg({ text: `Invite link copied to clipboard!\n${link}`, type: 'success' });
      }
    } catch {
      // Network error — still copy to clipboard
      await navigator.clipboard.writeText(link).catch(() => {});
      setMsg({ text: `Invite link copied!\n${link}`, type: 'success' });
    }

    setEmail('');
    await loadInvites(user.id);
    setSending(false);
  }

  async function acceptInvite() {
    if (!pendingToken) return;
    setAccepting(true);
    const { data, error } = await supabase.rpc('accept_family_invite', { p_token: pendingToken });
    if (error || !data?.success) {
      setMsg({ text: (data?.error || error?.message || 'Could not accept invite'), type: 'error' });
    } else {
      setMsg({ text: 'You have joined the family space!', type: 'success' });
      setPendingToken(null);
      window.history.replaceState({}, '', '/family');
      await loadMembers(user.id);
    }
    setAccepting(false);
  }

  async function removeMember(memberId) {
    await supabase.from('family_members').delete().eq('id', memberId);
    setMembers(prev => prev.filter(m => m.id !== memberId));
  }

  async function cancelInvite(inviteId) {
    await supabase.from('family_invites').update({ status: 'expired' }).eq('id', inviteId);
    setInvites(prev => prev.filter(i => i.id !== inviteId));
  }

  function copyInviteLink(token) {
    const link = `${window.location.origin}/family?invite=${token}`;
    navigator.clipboard.writeText(link);
    setMsg({ text: 'Invite link copied to clipboard!', type: 'success' });
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: '#94a3b8', fontSize: 16 }}>Loading...</div>
    </div>
  );

  return (
    <>
      <NavbarClient />
      <div style={{ minHeight: '100vh', background: '#0f172a', padding: '96px 16px 80px', fontFamily: 'system-ui,sans-serif' }}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>

        <div style={{ color: '#f1f5f9', fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Family Space</div>
        <div style={{ color: '#64748b', fontSize: 14, marginBottom: 24 }}>Invite family members to share your QuietKeep</div>

        {/* Pending invite accept banner */}
        {pendingToken && (
          <div style={{ background: '#1c1400', border: '1px solid #f59e0b', borderRadius: 12, padding: 20, marginBottom: 16 }}>
            <div style={{ color: '#fbbf24', fontWeight: 700, fontSize: 15, marginBottom: 8 }}>You have a family invite!</div>
            <div style={{ color: '#94a3b8', fontSize: 14, marginBottom: 14 }}>Someone invited you to join their QuietKeep family space.</div>
            <button
              onClick={acceptInvite}
              disabled={accepting}
              style={{ width: '100%', padding: 12, background: accepting ? '#334155' : '#f59e0b', color: '#0f172a', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 15, cursor: 'pointer' }}
            >{accepting ? 'Accepting...' : 'Accept Invite'}</button>
          </div>
        )}

        {/* Message */}
        {msg.text && (
          <div style={{ background: msg.type === 'error' ? '#2a0a0a' : '#0a1f0a', border: `1px solid ${msg.type === 'error' ? '#dc2626' : '#166534'}`, borderRadius: 8, padding: 14, color: msg.type === 'error' ? '#f87171' : '#86efac', fontSize: 13, marginBottom: 16, whiteSpace: 'pre-wrap' }}>
            {msg.text}
          </div>
        )}

        {/* Send invite */}
        <div style={{ background: '#1e293b', borderRadius: 12, padding: 20, marginBottom: 16, border: '1px solid #334155' }}>
          <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Invite a Family Member</div>
          <input
            type="email"
            placeholder="their@email.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '10px 14px', color: '#f1f5f9', fontSize: 15, boxSizing: 'border-box', outline: 'none' }}
          />
          <select
            value={role}
            onChange={e => setRole(e.target.value)}
            style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, padding: '10px 14px', color: '#f1f5f9', fontSize: 15, boxSizing: 'border-box', marginTop: 10 }}
          >
            <option value="member">Member — can view & add keeps</option>
            <option value="viewer">Viewer — read only</option>
            <option value="admin">Admin — full access</option>
          </select>
          <button
            onClick={sendInvite}
            disabled={sending || !email.trim()}
            style={{ width: '100%', padding: 12, background: (sending || !email.trim()) ? '#334155' : '#6366f1', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 15, cursor: 'pointer', marginTop: 12 }}
          >{sending ? 'Generating...' : 'Generate & Copy Invite Link'}</button>
        </div>

        {/* Pending invites */}
        {invites.length > 0 && (
          <div style={{ background: '#1e293b', borderRadius: 12, padding: 20, marginBottom: 16, border: '1px solid #334155' }}>
            <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Pending Invites ({invites.length})</div>
            {invites.map(inv => (
              <div key={inv.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #0f172a' }}>
                <div>
                  <div style={{ color: '#f1f5f9', fontSize: 14 }}>{inv.invitee_email}</div>
                  <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>
                    Expires {new Date(inv.expires_at).toLocaleDateString('en-IN')} · {inv.role}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => copyInviteLink(inv.token)} style={{ background: '#1e3a5f', color: '#60a5fa', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>Copy</button>
                  <button onClick={() => cancelInvite(inv.id)} style={{ background: '#3b1a1a', color: '#f87171', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Active members */}
        <div style={{ background: '#1e293b', borderRadius: 12, padding: 20, marginBottom: 16, border: '1px solid #334155' }}>
          <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>Active Members ({members.length})</div>
          {members.length === 0 ? (
            <div style={{ color: '#475569', fontSize: 14, padding: '8px 0' }}>No members yet. Send an invite above.</div>
          ) : (
            members.map(m => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #0f172a' }}>
                <div>
                  <div style={{ color: '#f1f5f9', fontSize: 14 }}>{m.member_email}</div>
                  <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>
                    Joined {m.joined_at ? new Date(m.joined_at).toLocaleDateString('en-IN') : 'pending'} ·
                    <span style={{ background: '#1e3a5f', color: '#60a5fa', borderRadius: 4, padding: '1px 6px', fontSize: 11, marginLeft: 6 }}>{m.role}</span>
                  </div>
                </div>
                <button onClick={() => removeMember(m.id)} style={{ background: '#3b1a1a', color: '#f87171', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: 13, cursor: 'pointer' }}>Remove</button>
              </div>
            ))
          )}
        </div>


        {/* Location Sharing — NEW */}
        <div style={{ background: '#1e293b', borderRadius: 12, padding: 20, marginBottom: 16, border: '1px solid #334155' }}>
          <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>📍 Location Sharing (Opt-in)</div>
          <div style={{ color: '#64748b', fontSize: 13, marginBottom: 12 }}>Share your live location with family members. Each member controls their own sharing.</div>
          <LocationShare userId={user?.id} />
        </div>

        <div style={{ color: '#334155', fontSize: 12, textAlign: 'center' }}>Invite links expire in 72 hours · Members can be removed anytime</div>
      </div>
    </div>
    </>
  );
                  }
