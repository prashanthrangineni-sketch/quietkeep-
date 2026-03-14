'use client';
import { useState, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import NavbarClient from '@/components/NavbarClient';

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function MessagesPage() {
  const [user, setUser] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [groups, setGroups] = useState([]);
  const [selected, setSelected] = useState([]); // contact ids selected for broadcast
  const [msg, setMsg] = useState('');
  const [tab, setTab] = useState('contacts'); // contacts | groups
  const [newGroupName, setNewGroupName] = useState('');
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { window.location.href = '/login'; return; }
      setUser(user);
      loadAll(user.id);
    });
  }, []);

  async function loadAll(uid) {
    const [{ data: c1 }, { data: c2 }, { data: g1 }] = await Promise.all([
      supabase.from('contacts').select('*').eq('user_id', uid).order('name'),
      supabase.from('emergency_contacts').select('id, name, phone, relation').eq('user_id', uid),
      supabase.from('contact_groups').select(`*, contact_group_members(contact_id, contacts(id, name, phone))`).eq('user_id', uid),
    ]);
    // Merge contacts and emergency_contacts
    const merged = [...(c1 || [])];
    (c2 || []).forEach(ec => {
      if (!merged.find(c => c.phone === ec.phone)) merged.push({ ...ec, avatar_emoji: '🆘' });
    });
    setContacts(merged);
    setGroups(g1 || []);
    setLoading(false);
  }

  function toggleContact(id) {
    setSelected(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  }

  function selectGroup(group) {
    const ids = (group.contact_group_members || []).map(m => m.contact_id);
    setSelected(ids);
    setTab('contacts');
  }

  async function createGroup() {
    if (!newGroupName.trim() || selected.length === 0) return;
    const { data: g } = await supabase.from('contact_groups').insert({
      user_id: user.id, name: newGroupName.trim(), emoji: '👥'
    }).select().single();
    if (g) {
      await supabase.from('contact_group_members').insert(
        selected.map(cid => ({ group_id: g.id, contact_id: cid, user_id: user.id }))
      );
      await loadAll(user.id);
      setNewGroupName(''); setShowNewGroup(false);
    }
  }

  function sendWhatsApp() {
    if (!msg.trim() || selected.length === 0) return;
    const selectedContacts = contacts.filter(c => selected.includes(c.id) && c.phone);
    selectedContacts.forEach(c => {
      const phone = c.phone.replace(/[^0-9]/g, '');
      const url = `https://wa.me/${phone.startsWith('91') ? phone : '91' + phone}?text=${encodeURIComponent(msg)}`;
      window.open(url, '_blank');
    });
    setSent(true);
    setTimeout(() => setSent(false), 3000);
  }

  const inp = { width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: '#e2e8f0', padding: '11px 14px', fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' };

  return (
    <div style={{ minHeight: '100dvh', background: '#0d1117', color: '#e2e8f0', fontFamily: 'system-ui,sans-serif' }}>
      <NavbarClient />
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '6rem 16px 6rem' }}>

        <h1 style={{ fontSize: 22, fontWeight: 800, marginBottom: 4 }}>💬 Send Message</h1>
        <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>
          Select contacts or a group → type message → send via WhatsApp
        </p>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          {[['contacts','👥 Contacts'],['groups','📋 Groups']].map(([k,l]) => (
            <button key={k} onClick={() => setTab(k)} style={{ padding: '7px 16px', borderRadius: 20, border: `1px solid ${tab===k ? '#6366f1' : 'rgba(255,255,255,0.08)'}`, background: tab===k ? 'rgba(99,102,241,0.15)' : 'transparent', color: tab===k ? '#a5b4fc' : '#64748b', fontSize: 13, cursor: 'pointer', fontWeight: tab===k ? 700 : 400 }}>
              {l}
            </button>
          ))}
          {selected.length > 0 && tab === 'contacts' && (
            <button onClick={() => setShowNewGroup(true)} style={{ marginLeft: 'auto', padding: '7px 14px', borderRadius: 20, border: '1px solid rgba(16,185,129,0.3)', background: 'rgba(16,185,129,0.1)', color: '#6ee7b7', fontSize: 12, cursor: 'pointer' }}>
              + Save as Group
            </button>
          )}
        </div>

        {/* Save group form */}
        {showNewGroup && (
          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: 14, marginBottom: 14, display: 'flex', gap: 8 }}>
            <input style={{ ...inp, flex: 1 }} placeholder="Group name (e.g. Family, Office)" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} />
            <button onClick={createGroup} style={{ padding: '0 16px', borderRadius: 10, border: 'none', background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Save</button>
            <button onClick={() => setShowNewGroup(false)} style={{ padding: '0 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)', background: 'transparent', color: '#64748b', cursor: 'pointer' }}>✕</button>
          </div>
        )}

        {/* Contacts tab */}
        {tab === 'contacts' && (
          <div style={{ marginBottom: 20 }}>
            {loading ? (
              <div style={{ color: '#64748b', textAlign: 'center', padding: 30 }}>Loading contacts…</div>
            ) : contacts.length === 0 ? (
              <div style={{ color: '#475569', textAlign: 'center', padding: 30 }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>👤</div>
                No contacts yet. Add in Emergency page or import phonebook.
              </div>
            ) : contacts.map(c => {
              const isSel = selected.includes(c.id);
              return (
                <div key={c.id} onClick={() => toggleContact(c.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 4px', borderBottom: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer', background: isSel ? 'rgba(99,102,241,0.06)' : 'transparent', borderRadius: 8 }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: isSel ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
                    {isSel ? '✓' : (c.avatar_emoji || '👤')}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>{c.name}</div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>{c.phone || 'No phone'}{c.relation ? ` · ${c.relation}` : ''}</div>
                  </div>
                  {!c.phone && <span style={{ fontSize: 10, color: '#f87171', background: 'rgba(239,68,68,0.1)', padding: '2px 6px', borderRadius: 4 }}>No phone</span>}
                </div>
              );
            })}
          </div>
        )}

        {/* Groups tab */}
        {tab === 'groups' && (
          <div style={{ marginBottom: 20 }}>
            {groups.length === 0 ? (
              <div style={{ color: '#475569', textAlign: 'center', padding: 30 }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
                No groups yet. Select contacts and tap Save as Group.
              </div>
            ) : groups.map(g => (
              <div key={g.id} onClick={() => selectGroup(g)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', marginBottom: 8, cursor: 'pointer' }}>
                <div style={{ fontSize: 24 }}>{g.emoji || '👥'}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>{g.name}</div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>{(g.contact_group_members || []).length} members</div>
                </div>
                <div style={{ fontSize: 12, color: '#6366f1', fontWeight: 600 }}>Select →</div>
              </div>
            ))}
          </div>
        )}

        {/* Message compose */}
        {selected.length > 0 && (
          <div style={{ position: 'sticky', bottom: 80, background: '#0d1117', paddingTop: 12 }}>
            <div style={{ marginBottom: 8, fontSize: 12, color: '#64748b' }}>
              Sending to {selected.length} contact{selected.length > 1 ? 's' : ''}: {contacts.filter(c => selected.includes(c.id)).map(c => c.name).join(', ')}
            </div>
            <textarea
              value={msg}
              onChange={e => setMsg(e.target.value)}
              rows={3}
              placeholder="Type your message…"
              style={{ ...inp, resize: 'none', lineHeight: 1.6, marginBottom: 10 }}
            />
            <button onClick={sendWhatsApp} disabled={!msg.trim()}
              style={{ width: '100%', padding: 13, borderRadius: 12, border: 'none', background: !msg.trim() ? 'rgba(255,255,255,0.06)' : 'linear-gradient(135deg, #25D366, #128C7E)', color: !msg.trim() ? '#475569' : '#fff', fontSize: 15, fontWeight: 700, cursor: msg.trim() ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
              {sent ? '✓ Opened in WhatsApp!' : `📱 Send via WhatsApp (${selected.length})`}
            </button>
            <div style={{ fontSize: 11, color: '#334155', textAlign: 'center', marginTop: 6 }}>
              Opens WhatsApp for each recipient — you tap Send
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
