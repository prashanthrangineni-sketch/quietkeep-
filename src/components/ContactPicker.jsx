'use client';
// ContactPicker — shows contacts from DB + native phonebook (Contact Picker API)
// Used in: reminders, message groups
import { useState, useEffect } from 'react';

export default function ContactPicker({ supabase, userId, onSelect, onClose, multi = false, title = 'Select Contact' }) {
  const [contacts, setContacts] = useState([]);
  const [selected, setSelected] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [phonebookSupported] = useState(typeof window !== 'undefined' && 'contacts' in navigator && 'ContactsManager' in window);

  useEffect(() => { loadContacts(); }, []);

  async function loadContacts() {
    setLoading(true);
    // Load from contacts table + emergency_contacts
    const [{ data: c1 }, { data: c2 }] = await Promise.all([
      supabase.from('contacts').select('*').eq('user_id', userId).order('name'),
      supabase.from('emergency_contacts').select('id, name, phone, relation').eq('user_id', userId),
    ]);
    const merged = [...(c1 || [])];
    // Add emergency contacts not already in contacts
    (c2 || []).forEach(ec => {
      if (!merged.find(c => c.phone === ec.phone)) {
        merged.push({ ...ec, avatar_emoji: '🆘', _source: 'emergency' });
      }
    });
    setContacts(merged);
    setLoading(false);
  }

  async function importFromPhonebook() {
    try {
      const props = ['name', 'tel'];
      const opts = { multiple: true };
      const picked = await navigator.contacts.select(props, opts);
      if (!picked?.length) return;
      // Save to contacts table
      const toInsert = picked.map(p => ({
        user_id: userId,
        name: p.name?.[0] || 'Unknown',
        phone: p.tel?.[0] || null,
        avatar_emoji: '📱',
      }));
      const { data } = await supabase.from('contacts').insert(toInsert).select();
      if (data) setContacts(prev => [...prev, ...data]);
    } catch (e) {
      alert('Could not access phonebook: ' + e.message);
    }
  }

  function toggle(contact) {
    if (!multi) {
      onSelect([contact]);
      return;
    }
    setSelected(prev => prev.find(c => c.id === contact.id)
      ? prev.filter(c => c.id !== contact.id)
      : [...prev, contact]
    );
  }

  const filtered = contacts.filter(c =>
    !search || c.name?.toLowerCase().includes(search.toLowerCase()) || c.phone?.includes(search)
  );

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-end' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: '#161b27', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '20px 20px 0 0', padding: '20px 16px 40px', width: '100%', maxHeight: '80dvh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#e2e8f0' }}>{title}</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#475569', fontSize: 22, cursor: 'pointer' }}>×</button>
        </div>

        <input
          placeholder="Search name or phone…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: '#e2e8f0', padding: '10px 14px', fontSize: 14, outline: 'none', boxSizing: 'border-box', marginBottom: 10, fontFamily: 'inherit' }}
        />

        {phonebookSupported && (
          <button onClick={importFromPhonebook}
            style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid rgba(99,102,241,0.3)', background: 'rgba(99,102,241,0.1)', color: '#a5b4fc', fontSize: 12, cursor: 'pointer', marginBottom: 10, alignSelf: 'flex-start', fontFamily: 'inherit' }}>
            📱 Import from Phonebook
          </button>
        )}

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {loading && <div style={{ color: '#64748b', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>Loading contacts…</div>}
          {!loading && filtered.length === 0 && (
            <div style={{ color: '#475569', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>
              No contacts yet.{phonebookSupported ? ' Import from phonebook above.' : ' Add contacts in Emergency page.'}
            </div>
          )}
          {filtered.map(c => {
            const isSelected = selected.find(s => s.id === c.id);
            return (
              <div key={c.id} onClick={() => toggle(c)} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '12px 4px',
                borderBottom: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer',
                background: isSelected ? 'rgba(99,102,241,0.08)' : 'transparent',
              }}>
                <div style={{ width: 38, height: 38, borderRadius: '50%', background: isSelected ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0 }}>
                  {isSelected ? '✓' : (c.avatar_emoji || '👤')}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0' }}>{c.name}</div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>{c.phone}{c.relation ? ` · ${c.relation}` : ''}</div>
                </div>
              </div>
            );
          })}
        </div>

        {multi && selected.length > 0 && (
          <button onClick={() => onSelect(selected)}
            style={{ marginTop: 14, padding: '13px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #6366f1, #818cf8)', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
            Confirm {selected.length} contact{selected.length > 1 ? 's' : ''}
          </button>
        )}
      </div>
    </div>
  );
}
