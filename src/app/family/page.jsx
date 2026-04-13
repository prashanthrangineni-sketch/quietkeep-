'use client';
import { useAuth } from '@/lib/context/auth';
import { apiPost } from '@/lib/safeFetch';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
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
      <div style={{ color: 'var(--text-subtle)', fontSize: 11, marginTop: 6 }}>Your location is only shared when you tap this button — never automatically.</div>
    </div>
  );
}

export default function FamilyPage() {
  const router = useRouter();
  const { user, accessToken, loading: authLoading } = useAuth();
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState({ text: '', type: 'success' });
  const [pendingToken, setPendingToken] = useState(null);
  const [accepting, setAccepting] = useState(false);
  const [pendingInviteLink, setPendingInviteLink] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('invite');
    if (token) setPendingToken(token);
    if (!authLoading) init();
  }, [authLoading]);

  async function init() {
    if (!user) { setLoading(false); router.replace('/login'); return; }
    await Promise.all([loadMembers(user.id), loadInvites(user.id)]);
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
      const { data: emailData } = await apiPost('/api/family/invite', {
        inviteeEmail: email.trim().toLowerCase(),
        inviteLink: link,
        inviterName: user.user_metadata?.full_name || user.email,
        role,
      }, accessToken);
      if (emailData?.sent) {
        setMsg({ text: `✅ Invite email sent to ${email.trim()}`, type: 'success' });
        setPendingInviteLink('');
      } else {
        // Email service not configured — show shareable link UI
        setPendingInviteLink(link);
        setMsg({ text: 'Email not configured. Share the link below:', type: 'warn' });
      }
    } catch {
      // Network error — show shareable link UI
      setPendingInviteLink(link);
      setMsg({ text: 'Could not send email. Share the link below:', type: 'warn' });
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
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: 'var(--text-muted)', fontSize: 16 }}>Loading...</div>
    </div>
  );

  return (
    <>
      <NavbarClient />
      <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '96px 16px 80px', fontFamily: 'system-ui,sans-serif' }}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>

        <div style={{ color: 'var(--text)', fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Family Space</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 24 }}>Invite family members to share your QuietKeep</div>

        {/* Pending invite accept banner */}
        {pendingToken && (
          <div style={{ background: '#1c1400', border: '1px solid #f59e0b', borderRadius: 12, padding: 20, marginBottom: 16 }}>
            <div style={{ color: '#fbbf24', fontWeight: 700, fontSize: 15, marginBottom: 8 }}>You have a family invite!</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 14 }}>Someone invited you to join their QuietKeep family space.</div>
            <button
              onClick={acceptInvite}
              disabled={accepting}
              style={{ width: '100%', padding: 12, background: accepting ? '#334155' : '#f59e0b', color: '#0d1117', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 15, cursor: 'pointer' }}
            >{accepting ? 'Accepting...' : 'Accept Invite'}</button>
          </div>
        )}

        {/* Message */}
        {msg.text && (
          <div style={{
            background: msg.type === 'error' ? 'var(--red-dim)' : msg.type === 'warn' ? 'var(--amber-dim)' : 'var(--accent-dim)',
            border: `1px solid ${msg.type === 'error' ? 'rgba(220,38,38,0.3)' : msg.type === 'warn' ? 'rgba(217,119,6,0.3)' : 'rgba(5,150,105,0.3)'}`,
            borderRadius: 8, padding: 12,
            color: msg.type === 'error' ? 'var(--red)' : msg.type === 'warn' ? 'var(--amber)' : 'var(--accent)',
            fontSize: 13, marginBottom: 12, fontWeight: 500,
          }}>
            {msg.text}
          </div>
        )}

        {/* Invite link fallback panel — visible copy + WhatsApp share */}
        {pendingInviteLink && (
          <div className="qk-card" style={{ padding: 16, marginBottom: 16, borderColor: 'var(--primary)', borderWidth: 1.5 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
              📎 Share Invite Link
            </div>
            <div style={{
              background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
              padding: '8px 12px', fontSize: 12, color: 'var(--text-muted)',
              wordBreak: 'break-all', marginBottom: 12, fontFamily: 'monospace',
            }}>
              {pendingInviteLink}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(pendingInviteLink)
                    .then(() => { setMsg({ text: '✅ Link copied to clipboard!', type: 'success' }); setPendingInviteLink(''); })
                    .catch(() => setMsg({ text: 'Copy failed — please copy the link manually above', type: 'warn' }));
                }}
                className="qk-btn qk-btn-primary qk-btn-sm"
                style={{ flex: 1 }}
              >
                📋 Copy Link
              </button>
              <button
                onClick={() => {
                  const waText = encodeURIComponent(`Join my QuietKeep family space: ${pendingInviteLink}`);
                  window.open(`https://wa.me/?text=${waText}`, '_blank', 'noopener,noreferrer');
                  setMsg({ text: '💬 WhatsApp opened', type: 'success' });
                  setPendingInviteLink('');
                }}
                style={{
                  flex: 1, padding: '7px 14px', borderRadius: 'var(--radius-sm)', border: 'none',
                  background: '#25d366', color: '#fff', fontSize: 12, fontWeight: 700,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                💬 WhatsApp
              </button>
            </div>
          </div>
        )}

        {/* Send invite */}
        <div className="qk-card" style={{ padding: 20, marginBottom: 16 }}>
          <div style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
            Invite a Family Member
          </div>
          <input
            type="email"
            placeholder="their@email.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="qk-input"
            style={{ marginBottom: 10 }}
          />
          <select
            value={role}
            onChange={e => setRole(e.target.value)}
            className="qk-input"
            style={{ marginBottom: 12 }}
          >
            <option value="member">Member — can view & add keeps</option>
            <option value="viewer">Viewer — read only</option>
            <option value="admin">Admin — full access</option>
          </select>
          <button
            onClick={sendInvite}
            disabled={sending || !email.trim()}
            className="qk-btn qk-btn-primary"
            style={{ width: '100%', justifyContent: 'center', padding: 12 }}
          >
            {sending ? 'Generating…' : '✉️ Send Invite'}
          </button>
        </div>

        {/* Pending invites */}
        {invites.length > 0 && (
          <div className="qk-card" style={{ padding: 20, marginBottom: 16 }}>
            <div style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
              Pending Invites ({invites.length})
            </div>
            {invites.map(inv => (
              <div key={inv.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div style={{ color: 'var(--text)', fontSize: 14, fontWeight: 500 }}>{inv.invitee_email}</div>
                  <div style={{ color: 'var(--text-subtle)', fontSize: 12, marginTop: 2 }}>
                    Expires {new Date(inv.expires_at).toLocaleDateString('en-IN')} · {inv.role}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => copyInviteLink(inv.token)} className="qk-btn qk-btn-ghost qk-btn-sm">Copy</button>
                  <button onClick={() => cancelInvite(inv.id)} className="qk-btn qk-btn-danger qk-btn-sm">Cancel</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Active members */}
        <div className="qk-card" style={{ padding: 20, marginBottom: 16 }}>
          <div style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
            Active Members ({members.length})
          </div>
          {members.length === 0 ? (
            <div style={{ color: 'var(--text-subtle)', fontSize: 14, padding: '8px 0' }}>No members yet. Send an invite above.</div>
          ) : (
            members.map(m => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div style={{ color: 'var(--text)', fontSize: 14, fontWeight: 500 }}>{m.member_email}</div>
                  <div style={{ color: 'var(--text-subtle)', fontSize: 12, marginTop: 2 }}>
                    Joined {m.joined_at ? new Date(m.joined_at).toLocaleDateString('en-IN') : 'pending'} ·
                    <span className="qk-badge qk-badge-primary" style={{ marginLeft: 6 }}>{m.role}</span>
                  </div>
                </div>
                <button onClick={() => removeMember(m.id)} className="qk-btn qk-btn-danger qk-btn-sm">Remove</button>
              </div>
            ))
          )}
        </div>


        {/* Location Sharing — NEW */}
        <div style={{ background: 'var(--surface)', borderRadius: 12, padding: 20, marginBottom: 16, border: '1px solid var(--border)' }}>
          <div style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>📍 Location Sharing (Opt-in)</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 12 }}>Share your live location with family members. Each member controls their own sharing.</div>
          <LocationShare userId={user?.id} />
        </div>

        <div style={{ color: '#334155', fontSize: 12, textAlign: 'center' }}>Invite links expire in 72 hours · Members can be removed anytime</div>
      </div>
    </div>
    </>
  );
                               }
