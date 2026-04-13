'use client';
import { useRouter } from 'next/navigation';
/**
 * src/app/messages/page.jsx
 *
 * QK Direct + WhatsApp Broadcast
 *
 * QK Direct: real-time in-app messaging between QuietKeep users.
 *   - Stored in 'keeps' table (intent_type='qk_message') — no new table needed.
 *     The keeps table has user_id, content, metadata (jsonb), created_at,
 *     and existing RLS. Messaging reuses this infrastructure correctly.
 *   - Voice messages: upload to 'voice-messages' bucket, store signed URL as content.
 *   - Realtime: supabase postgres_changes on keeps filtered by metadata.to_user_id.
 *
 * WhatsApp Broadcast: original feature preserved unchanged.
 */
import { useAuth } from '@/lib/context/auth';
import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import NavbarClient from '@/components/NavbarClient';
import { VoiceMessageRecorder, VoiceMessagePlayer } from '@/components/VoiceMessage';

const G = '#6366f1'; // indigo accent

// ── Helpers ───────────────────────────────────────────────────────────────────
function timeAgo(ts) {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function MessagesPage() {
  const router = useRouter();
  const { user, accessToken, loading: authLoading } = useAuth();
  const [mainTab, setMainTab] = useState('direct'); // 'direct' | 'whatsapp'

  // ── QK Direct state ───────────────────────────────────────────────────────
  const [inbox, setInbox]           = useState([]);
  const [sent, setSent]             = useState([]);
  const [dmTab, setDmTab]           = useState('inbox'); // 'inbox' | 'sent' | 'compose'
  const [toEmail, setToEmail]       = useState('');
  const [toUserId, setToUserId]     = useState('');
  const [toName, setToName]         = useState('');
  const [dmText, setDmText]         = useState('');
  const [dmSending, setDmSending]   = useState(false);
  const [resolving, setResolving]   = useState(false);
  const [dmError, setDmError]       = useState('');
  const [dmSuccess, setDmSuccess]   = useState('');
  const [dmLoading, setDmLoading]   = useState(false);
  const chanRef                      = useRef(null);

  // ── WhatsApp state ────────────────────────────────────────────────────────
  const [contacts, setContacts]         = useState([]);
  const [groups, setGroups]             = useState([]);
  const [selected, setSelected]         = useState([]);
  const [waMsg, setWaMsg]               = useState('');
  const [waTab, setWaTab]               = useState('contacts');
  const [newGroupName, setNewGroupName] = useState('');
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [waLoading, setWaLoading]       = useState(true);
  const [waSent, setWaSent]             = useState(false);

  // ── Auth redirect ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
    loadInbox(user.id);
    loadContacts(user.id);
  }, [user]);

  // ── Realtime: new QK messages directed at me ──────────────────────────────
  useEffect(() => {
    if (!user) return;
    chanRef.current?.unsubscribe();
    chanRef.current = supabase
      .channel('qk-dm-' + user.id)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'keeps',
        filter: "intent_type=eq.qk_message",
      }, (payload) => {
        const k = payload.new;
        if (k?.metadata?.to_user_id === user.id) {
          setInbox(prev => [k, ...prev]);
        }
      })
      .subscribe();
    return () => { chanRef.current?.unsubscribe(); };
  }, [user]);

  // ── Data loaders ──────────────────────────────────────────────────────────
  async function loadInbox(uid) {
    setDmLoading(true);
    const [{ data: recv }, { data: sentMsgs }] = await Promise.all([
      supabase.from('keeps')
        .select('id, content, created_at, metadata, user_id')
        .eq('intent_type', 'qk_message')
        .filter('metadata->>to_user_id', 'eq', uid)
        .order('created_at', { ascending: false }).limit(50),
      supabase.from('keeps')
        .select('id, content, created_at, metadata')
        .eq('intent_type', 'qk_message').eq('user_id', uid)
        .order('created_at', { ascending: false }).limit(50),
    ]);
    setInbox(recv || []);
    setSent(sentMsgs || []);
    setDmLoading(false);
  }

  async function loadContacts(uid) {
    const [{ data: c1 }, { data: c2 }, { data: g1 }] = await Promise.all([
      supabase.from('contacts').select('*').eq('user_id', uid).order('name'),
      supabase.from('emergency_contacts').select('id,name,phone,relation').eq('user_id', uid),
      supabase.from('contact_groups').select('*,contact_group_members(contact_id,contacts(id,name,phone))').eq('user_id', uid),
    ]);
    const merged = [...(c1 || [])];
    (c2 || []).forEach(ec => { if (!merged.find(c => c.phone === ec.phone)) merged.push({ ...ec, avatar_emoji: '🆘' }); });
    setContacts(merged);
    setGroups(g1 || []);
    setWaLoading(false);
  }

  // ── Resolve QK user by email ──────────────────────────────────────────────
  async function resolveUser() {
    const email = toEmail.trim().toLowerCase();
    if (!email.includes('@')) { setDmError('Enter a valid email'); return; }
    if (email === user?.email) { setDmError('Cannot message yourself'); return; }
    setResolving(true); setDmError('');
    const { data } = await supabase
      .from('profiles').select('user_id, full_name')
      .eq('email', email).maybeSingle();
    setResolving(false);
    if (!data?.user_id) { setDmError('No QuietKeep account found with that email'); setToUserId(''); return; }
    setToUserId(data.user_id);
    setToName(data.full_name || email);
    setDmError('');
  }

  // ── Send text DM ──────────────────────────────────────────────────────────
  async function sendDM() {
    if (!dmText.trim() || !toUserId || dmSending) return;
    setDmSending(true); setDmError('');
    const { error } = await supabase.from('keeps').insert({
      user_id: user.id,
      content: dmText.trim(),
      intent_type: 'qk_message',
      domain_type: 'personal',
      status: 'active',
      metadata: {
        to_user_id: toUserId,
        to_email:   toEmail.trim().toLowerCase(),
        to_name:    toName,
        from_email: user.email,
        from_name:  user.user_metadata?.full_name || user.email,
        msg_type:   'text',
        read:       false,
      },
    });
    setDmSending(false);
    if (error) { setDmError('Send failed: ' + error.message); return; }
    setDmSuccess('✓ Message sent!');
    setDmText('');
    setTimeout(() => setDmSuccess(''), 3000);
    loadInbox(user.id);
  }

  // ── Send voice DM ─────────────────────────────────────────────────────────
  async function sendVoiceDM(blob, durationSec) {
    if (!toUserId) return;
    setDmSending(true);
    const path = `qk-direct/${user.id}/${toUserId}/${Date.now()}.webm`;
    const { error: upErr } = await supabase.storage
      .from('voice-messages').upload(path, blob, { upsert: false });
    if (upErr) { setDmError('Voice upload failed'); setDmSending(false); return; }
    const { data: urlData, error: urlErr } = await supabase.storage
      .from('voice-messages').createSignedUrl(path, 60 * 60 * 24 * 365);
    if (urlErr || !urlData?.signedUrl) { setDmError('Could not get voice URL'); setDmSending(false); return; }
    const { error } = await supabase.from('keeps').insert({
      user_id: user.id,
      content: urlData.signedUrl,
      intent_type: 'qk_message',
      domain_type: 'personal',
      status: 'active',
      metadata: {
        to_user_id: toUserId,
        to_email:   toEmail.trim().toLowerCase(),
        to_name:    toName,
        from_email: user.email,
        from_name:  user.user_metadata?.full_name || user.email,
        msg_type:   'voice',
        duration:   durationSec,
        read:       false,
      },
    });
    setDmSending(false);
    if (error) { setDmError('Send failed'); return; }
    setDmSuccess('✓ Voice message sent!');
    setTimeout(() => setDmSuccess(''), 3000);
    loadInbox(user.id);
  }

  // ── WhatsApp helpers ──────────────────────────────────────────────────────
  function toggleContact(id) { setSelected(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]); }
  function selectGroup(g) { setSelected((g.contact_group_members || []).map(m => m.contact_id)); setWaTab('contacts'); }
  async function createGroup() {
    if (!newGroupName.trim() || !selected.length) return;
    const { data: g } = await supabase.from('contact_groups')
      .insert({ user_id: user.id, name: newGroupName.trim(), emoji: '👥' }).select().single();
    if (g) {
      await supabase.from('contact_group_members')
        .insert(selected.map(cid => ({ group_id: g.id, contact_id: cid, user_id: user.id })));
      loadContacts(user.id); setNewGroupName(''); setShowNewGroup(false);
    }
  }
  function sendWhatsApp() {
    if (!waMsg.trim() || !selected.length) return;
    contacts.filter(c => selected.includes(c.id) && c.phone).forEach(c => {
      const ph = c.phone.replace(/[^0-9]/g, '');
      window.open('https://wa.me/' + (ph.startsWith('91') ? ph : '91' + ph) + '?text=' + encodeURIComponent(waMsg), '_blank');
    });
    setWaSent(true); setTimeout(() => setWaSent(false), 3000);
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  const inp = {
    width: '100%', background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 10, padding: '10px 14px', color: 'var(--text)',
    fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
  };
  const mainTabBtn = (active) => ({
    flex: 1, padding: '10px 0', border: 'none', fontFamily: 'inherit',
    background: active ? G : 'transparent',
    color: active ? '#fff' : 'var(--text-muted)',
    fontWeight: active ? 700 : 400, fontSize: 13, cursor: 'pointer',
    borderRadius: active ? 10 : 10,
  });
  const subTabBtn = (active) => ({
    padding: '6px 16px', borderRadius: 20, border: 'none', fontFamily: 'inherit',
    background: active ? 'rgba(99,102,241,0.15)' : 'transparent',
    color: active ? '#a5b4fc' : 'var(--text-muted)',
    fontWeight: active ? 700 : 400, fontSize: 12, cursor: 'pointer',
  });

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text)', fontFamily: 'system-ui,sans-serif' }}>
      <NavbarClient />
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '5rem 16px 6rem' }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>💬 Messages</h1>

        {/* Main tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 20, background: 'var(--surface)', borderRadius: 12, padding: 4 }}>
          <button onClick={() => setMainTab('direct')} style={mainTabBtn(mainTab === 'direct')}>⚡ QK Direct</button>
          <button onClick={() => setMainTab('whatsapp')} style={mainTabBtn(mainTab === 'whatsapp')}>📱 WhatsApp</button>
        </div>

        {/* ── QK DIRECT ── */}
        {mainTab === 'direct' && (
          <>
            <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
              {[['inbox','📥 Inbox'],['sent','📤 Sent'],['compose','✏️ Compose']].map(([k,l]) => (
                <button key={k} onClick={() => setDmTab(k)} style={subTabBtn(dmTab === k)}>{l}{k==='inbox'&&inbox.length>0?' ('+inbox.length+')':''}</button>
              ))}
            </div>

            {/* Compose */}
            {dmTab === 'compose' && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Send a QuietKeep message</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>Recipient must have a QuietKeep account</div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <input style={{ ...inp, flex: 1 }}
                    placeholder="Recipient's QuietKeep email"
                    value={toEmail}
                    onChange={e => { setToEmail(e.target.value); setToUserId(''); setToName(''); }}
                    onBlur={resolveUser}
                  />
                  <button onClick={resolveUser} disabled={resolving}
                    style={{ padding: '0 14px', borderRadius: 10, border: 'none', background: G, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: resolving ? 0.7 : 1 }}>
                    {resolving ? '…' : 'Find'}
                  </button>
                </div>
                {toUserId && <div style={{ fontSize: 12, color: '#6ee7b7', marginBottom: 10 }}>✓ Found: {toName}</div>}
                {dmError && <div style={{ fontSize: 12, color: '#f87171', marginBottom: 10 }}>⚠ {dmError}</div>}
                {dmSuccess && <div style={{ fontSize: 12, color: '#6ee7b7', marginBottom: 10 }}>{dmSuccess}</div>}
                <textarea value={dmText} onChange={e => setDmText(e.target.value)} rows={3}
                  placeholder="Your message…"
                  style={{ ...inp, resize: 'none', marginBottom: 10 }} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={sendDM} disabled={!dmText.trim() || !toUserId || dmSending}
                    style={{ flex: 1, padding: 11, borderRadius: 10, border: 'none', fontFamily: 'inherit',
                      background: (!dmText.trim() || !toUserId) ? 'rgba(255,255,255,0.06)' : G,
                      color: (!dmText.trim() || !toUserId) ? '#475569' : '#fff',
                      fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                    {dmSending ? 'Sending…' : '⚡ Send'}
                  </button>
                  {toUserId && (
                    <VoiceMessageRecorder
                      onSend={sendVoiceDM}
                      disabled={dmSending}
                      accentColor={G}
                    />
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-subtle)', textAlign: 'center', marginTop: 8 }}>
                  Real-time · No phone number needed · Voice messages supported
                </div>
              </div>
            )}

            {/* Inbox */}
            {dmTab === 'inbox' && (
              dmLoading
                ? <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Loading…</div>
                : inbox.length === 0
                  ? <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-subtle)' }}>
                      <div style={{ fontSize: 36, marginBottom: 8 }}>📭</div>
                      <div>No messages yet</div>
                      <div style={{ fontSize: 12, marginTop: 4 }}>Messages from other QK users appear here in real-time</div>
                    </div>
                  : inbox.map(m => (
                    <div key={m.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)',
                      borderRadius: 12, padding: '12px 14px', marginBottom: 8,
                      borderLeft: m.metadata?.read ? '3px solid transparent' : '3px solid ' + G }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                        <span style={{ fontSize: 12, color: '#a5b4fc', fontWeight: 600 }}>
                          From: {m.metadata?.from_name || m.metadata?.from_email || 'QK User'}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{timeAgo(m.created_at)}</span>
                      </div>
                      {m.metadata?.msg_type === 'voice'
                        ? <VoiceMessagePlayer src={m.content} duration={m.metadata?.duration} accentColor={G} />
                        : <div style={{ fontSize: 14, lineHeight: 1.5 }}>{m.content}</div>
                      }
                    </div>
                  ))
            )}

            {/* Sent */}
            {dmTab === 'sent' && (
              sent.length === 0
                ? <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-subtle)' }}>
                    <div style={{ fontSize: 36, marginBottom: 8 }}>📤</div>No sent messages
                  </div>
                : sent.map(m => (
                  <div key={m.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px', marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 12, color: '#6ee7b7', fontWeight: 600 }}>
                        To: {m.metadata?.to_name || m.metadata?.to_email || 'QK User'}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{timeAgo(m.created_at)}</span>
                    </div>
                    {m.metadata?.msg_type === 'voice'
                      ? <VoiceMessagePlayer src={m.content} duration={m.metadata?.duration} accentColor={G} />
                      : <div style={{ fontSize: 14, lineHeight: 1.5 }}>{m.content}</div>
                    }
                  </div>
                ))
            )}
          </>
        )}

        {/* ── WHATSAPP BROADCAST ── */}
        {mainTab === 'whatsapp' && (
          <>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>Select contacts → type message → send via WhatsApp</p>
            <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
              {[['contacts','👥 Contacts'],['groups','📋 Groups']].map(([k,l]) => (
                <button key={k} onClick={() => setWaTab(k)} style={subTabBtn(waTab === k)}>{l}</button>
              ))}
              {selected.length > 0 && waTab === 'contacts' && (
                <button onClick={() => setShowNewGroup(true)} style={{ marginLeft: 'auto', padding: '6px 12px', borderRadius: 20, border: '1px solid rgba(16,185,129,0.3)', background: 'rgba(16,185,129,0.1)', color: '#6ee7b7', fontSize: 11, cursor: 'pointer' }}>
                  + Save Group
                </button>
              )}
            </div>
            {showNewGroup && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 12, marginBottom: 12, display: 'flex', gap: 8 }}>
                <input style={{ ...inp, flex: 1, padding: '8px 12px' }} placeholder="Group name" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} />
                <button onClick={createGroup} style={{ padding: '0 14px', borderRadius: 10, border: 'none', background: G, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Save</button>
                <button onClick={() => setShowNewGroup(false)} style={{ padding: '0 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>✕</button>
              </div>
            )}
            {waTab === 'contacts' && (
              waLoading ? <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>Loading…</div>
              : contacts.length === 0
                ? <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-subtle)' }}><div style={{ fontSize: 32 }}>👤</div>No contacts yet.</div>
                : contacts.map(c => {
                  const isSel = selected.includes(c.id);
                  return (
                    <div key={c.id} onClick={() => toggleContact(c.id)}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 4px',
                        borderBottom: '1px solid var(--border)', cursor: 'pointer',
                        background: isSel ? 'rgba(99,102,241,0.06)' : 'transparent', borderRadius: 8 }}>
                      <div style={{ width: 34, height: 34, borderRadius: '50%', background: isSel ? 'rgba(99,102,241,0.3)' : 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
                        {isSel ? '✓' : (c.avatar_emoji || '👤')}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>{c.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.phone || 'No phone'}{c.relation ? ' · ' + c.relation : ''}</div>
                      </div>
                    </div>
                  );
                })
            )}
            {waTab === 'groups' && (
              groups.length === 0
                ? <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-subtle)' }}><div style={{ fontSize: 32 }}>📋</div>No groups yet.</div>
                : groups.map(g => (
                  <div key={g.id} onClick={() => selectGroup(g)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--surface)', marginBottom: 8, cursor: 'pointer' }}>
                    <div style={{ fontSize: 22 }}>{g.emoji || '👥'}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{g.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{(g.contact_group_members || []).length} members</div>
                    </div>
                    <div style={{ fontSize: 12, color: G, fontWeight: 600 }}>Select →</div>
                  </div>
                ))
            )}
            {selected.length > 0 && (
              <div style={{ position: 'sticky', bottom: 80, background: 'var(--bg)', paddingTop: 12 }}>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                  To: {contacts.filter(c => selected.includes(c.id)).map(c => c.name).join(', ')}
                </div>
                <textarea value={waMsg} onChange={e => setWaMsg(e.target.value)} rows={3}
                  placeholder="Type your message…"
                  style={{ ...inp, resize: 'none', lineHeight: 1.6, marginBottom: 8 }} />
                <button onClick={sendWhatsApp} disabled={!waMsg.trim()}
                  style={{ width: '100%', padding: 12, borderRadius: 12, border: 'none',
                    background: waMsg.trim() ? 'linear-gradient(135deg,#25D366,#128C7E)' : 'var(--surface)',
                    color: waMsg.trim() ? '#fff' : 'var(--text-muted)',
                    fontSize: 14, fontWeight: 700, cursor: waMsg.trim() ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
                  {waSent ? '✓ Opened in WhatsApp!' : '📱 Send via WhatsApp (' + selected.length + ')'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
