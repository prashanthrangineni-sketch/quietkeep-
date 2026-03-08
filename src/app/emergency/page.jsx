'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

const RELATIONS = ['spouse', 'parent', 'sibling', 'child', 'friend', 'doctor', 'neighbour', 'other'];

const RELATION_ICONS = {
  spouse: '💑', parent: '👨‍👩‍👧', sibling: '👫', child: '👶',
  friend: '🤝', doctor: '⚕️', neighbour: '🏠', other: '👤',
};

export default function EmergencyPage() {
  const [user, setUser] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editContact, setEditContact] = useState(null);
  const [form, setForm] = useState({ name: '', phone: '', relation: 'other', is_primary: false });
  const [error, setError] = useState('');

  // GPS sharing state
  const [gpsState, setGpsState] = useState('idle'); // idle | locating | ready | sending | sent | error
  const [location, setLocation] = useState(null);
  const [gpsError, setGpsError] = useState('');
  const [sentTo, setSentTo] = useState([]);
  const [sosTrigger, setSosTrigger] = useState(false);
  const sosHoldRef = useRef(null);
  const [sosHoldProgress, setSosHoldProgress] = useState(0);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        setUser(user);
        loadContacts(user.id);
      }
    });
  }, []);

  async function loadContacts(uid) {
    setLoading(true);
    const { data, error } = await supabase
      .from('emergency_contacts')
      .select('*')
      .eq('user_id', uid)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true });
    if (!error) setContacts(data || []);
    setLoading(false);
  }

  function openAdd() {
    setEditContact(null);
    setForm({ name: '', phone: '', relation: 'other', is_primary: contacts.length === 0 });
    setError('');
    setShowForm(true);
  }

  function openEdit(c) {
    setEditContact(c);
    setForm({ name: c.name, phone: c.phone, relation: c.relation || 'other', is_primary: c.is_primary || false });
    setError('');
    setShowForm(true);
  }

  async function saveContact() {
    if (!form.name.trim()) return setError('Name is required');
    if (!form.phone.trim()) return setError('Phone is required');
    setSaving(true);
    setError('');

    // If marking as primary, unset others first
    if (form.is_primary && contacts.some(c => c.is_primary && c.id !== editContact?.id)) {
      await supabase
        .from('emergency_contacts')
        .update({ is_primary: false })
        .eq('user_id', user.id)
        .eq('is_primary', true);
    }

    const payload = {
      user_id: user.id,
      name: form.name.trim(),
      phone: form.phone.trim(),
      relation: form.relation,
      is_primary: form.is_primary,
    };

    let err;
    if (editContact) {
      ({ error: err } = await supabase.from('emergency_contacts').update(payload).eq('id', editContact.id));
    } else {
      ({ error: err } = await supabase.from('emergency_contacts').insert(payload));
    }

    setSaving(false);
    if (err) return setError(err.message);
    setShowForm(false);
    loadContacts(user.id);
  }

  async function deleteContact(id) {
    if (!confirm('Remove this emergency contact?')) return;
    await supabase.from('emergency_contacts').delete().eq('id', id);
    loadContacts(user.id);
  }

  // GPS — get current location
  function getLocation() {
    setGpsState('locating');
    setGpsError('');
    if (!navigator.geolocation) {
      setGpsState('error');
      setGpsError('Geolocation not supported on this device.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: Math.round(pos.coords.accuracy) });
        setGpsState('ready');
      },
      (err) => {
        setGpsState('error');
        setGpsError(err.code === 1 ? 'Location permission denied. Please enable in browser settings.' : 'Could not get location. Try again.');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }

  // Share location via WhatsApp deep link
  function shareViaWhatsApp(contact) {
    if (!location) return;
    const mapsUrl = `https://maps.google.com/?q=${location.lat},${location.lng}`;
    const msg = `🚨 EMERGENCY — I need help!\nMy location: ${mapsUrl}\nAccuracy: ~${location.acc}m\nSent from QuietKeep`;
    const wa = `https://wa.me/${contact.phone.replace(/\D/g, '')}?text=${encodeURIComponent(msg)}`;
    window.open(wa, '_blank');
    setSentTo(prev => {
      const next = [...prev, contact.id];
      writeSosEvent(next.length, 'whatsapp');
      return next;
    });
  }

  // Share via SMS fallback
  function shareViaSMS(contact) {
    if (!location) return;
    const mapsUrl = `https://maps.google.com/?q=${location.lat},${location.lng}`;
    const msg = `EMERGENCY — I need help! My location: ${mapsUrl} (accuracy ~${location.acc}m) — Sent from QuietKeep`;
    window.location.href = `sms:${contact.phone}?body=${encodeURIComponent(msg)}`;
    setSentTo(prev => {
      const next = [...prev, contact.id];
      writeSosEvent(next.length, 'sms');
      return next;
    });
  }


  // Write SOS event to sos_events table — non-blocking
  async function writeSosEvent(contactsNotified, channel) {
    if (!user) return;
    try {
      await supabase.from('sos_events').insert({
        user_id: user.id,
        triggered_at: new Date().toISOString(),
        latitude: location?.lat ?? null,
        longitude: location?.lng ?? null,
        location_accuracy: location?.acc ?? null,
        contacts_notified: contactsNotified,
        channel: channel,
        is_resolved: false,
        notes: `SOS via ${channel}. Location: ${location ? `${location.lat.toFixed(5)},${location.lng.toFixed(5)}` : 'unavailable'}`,
      });
    } catch (e) {
      console.error('[SOS write-back]', e);
    }
  }

  // SOS hold button — hold 3 seconds to trigger
  function startSosHold() {
    setSosHoldProgress(0);
    const start = Date.now();
    const duration = 3000;
    sosHoldRef.current = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.min((elapsed / duration) * 100, 100);
      setSosHoldProgress(pct);
      if (elapsed >= duration) {
        clearInterval(sosHoldRef.current);
        setSosHoldProgress(0);
        triggerSOS();
      }
    }, 50);
  }

  function stopSosHold() {
    if (sosHoldRef.current) {
      clearInterval(sosHoldRef.current);
      sosHoldRef.current = null;
      setSosHoldProgress(0);
    }
  }

  function triggerSOS() {
    setSosTrigger(true);
    getLocation();
  }

  const primaryContacts = contacts.filter(c => c.is_primary);
  const otherContacts = contacts.filter(c => !c.is_primary);

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0f', color: '#f0f0f5', fontFamily: "'DM Sans', -apple-system, sans-serif", paddingBottom: '80px' }}>

      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg, #1a0a0a 0%, #0f0a1a 100%)', borderBottom: '1px solid rgba(255,80,80,0.2)', padding: '20px 16px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
          <span style={{ fontSize: '22px' }}>🆘</span>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#fff', letterSpacing: '-0.3px' }}>Emergency Contacts</h1>
        </div>
        <p style={{ margin: 0, fontSize: '13px', color: 'rgba(255,255,255,0.45)' }}>
          Share your live location instantly in emergencies
        </p>
      </div>

      {/* SOS BUTTON */}
      <div style={{ padding: '20px 16px 8px' }}>
        <div style={{
          background: 'linear-gradient(135deg, rgba(220,30,30,0.15) 0%, rgba(180,20,20,0.08) 100%)',
          border: '1px solid rgba(255,60,60,0.3)',
          borderRadius: '16px',
          padding: '20px',
          textAlign: 'center'
        }}>
          <p style={{ margin: '0 0 14px', fontSize: '12px', color: 'rgba(255,255,255,0.5)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
            Hold 3 seconds to trigger emergency
          </p>

          {/* SOS hold button */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '14px' }}>
            <div style={{ position: 'relative', width: '88px', height: '88px' }}>
              {/* Progress ring */}
              <svg style={{ position: 'absolute', top: 0, left: 0, transform: 'rotate(-90deg)' }} width="88" height="88">
                <circle cx="44" cy="44" r="40" fill="none" stroke="rgba(255,60,60,0.15)" strokeWidth="4" />
                <circle
                  cx="44" cy="44" r="40" fill="none"
                  stroke="#ff3c3c" strokeWidth="4"
                  strokeDasharray={`${2 * Math.PI * 40}`}
                  strokeDashoffset={`${2 * Math.PI * 40 * (1 - sosHoldProgress / 100)}`}
                  style={{ transition: 'stroke-dashoffset 0.05s linear' }}
                />
              </svg>
              <button
                onMouseDown={startSosHold}
                onMouseUp={stopSosHold}
                onMouseLeave={stopSosHold}
                onTouchStart={(e) => { e.preventDefault(); startSosHold(); }}
                onTouchEnd={stopSosHold}
                style={{
                  position: 'absolute', top: '6px', left: '6px',
                  width: '76px', height: '76px', borderRadius: '50%',
                  background: sosHoldProgress > 0
                    ? 'linear-gradient(135deg, #ff3c3c, #cc2020)'
                    : 'linear-gradient(135deg, #cc2020, #991010)',
                  border: 'none',
                  color: '#fff',
                  fontSize: '26px',
                  cursor: 'pointer',
                  userSelect: 'none',
                  WebkitUserSelect: 'none',
                  boxShadow: sosHoldProgress > 0
                    ? '0 0 24px rgba(255,60,60,0.6)'
                    : '0 4px 16px rgba(180,20,20,0.5)',
                  transition: 'box-shadow 0.2s',
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}
              >
                🆘
              </button>
            </div>
          </div>

          {/* GPS status */}
          {gpsState === 'idle' && sosTrigger === false && (
            <p style={{ margin: 0, fontSize: '13px', color: 'rgba(255,255,255,0.4)' }}>
              Or tap below to get location first
            </p>
          )}
          {gpsState === 'locating' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block', fontSize: '16px' }}>📡</span>
              <span style={{ fontSize: '13px', color: '#ffb347' }}>Getting your location...</span>
            </div>
          )}
          {gpsState === 'ready' && location && (
            <div style={{ background: 'rgba(40,200,80,0.1)', border: '1px solid rgba(40,200,80,0.3)', borderRadius: '10px', padding: '10px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginBottom: '4px' }}>
                <span style={{ fontSize: '14px' }}>📍</span>
                <span style={{ fontSize: '13px', color: '#4ade80', fontWeight: 600 }}>Location captured</span>
              </div>
              <p style={{ margin: 0, fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>
                {location.lat.toFixed(5)}, {location.lng.toFixed(5)} · ±{location.acc}m accuracy
              </p>
              <a
                href={`https://maps.google.com/?q=${location.lat},${location.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-block', marginTop: '6px', fontSize: '11px', color: '#60a5fa', textDecoration: 'none' }}
              >
                Verify on Google Maps ↗
              </a>
            </div>
          )}
          {gpsState === 'error' && (
            <div style={{ background: 'rgba(255,60,60,0.1)', border: '1px solid rgba(255,60,60,0.3)', borderRadius: '10px', padding: '10px 14px' }}>
              <p style={{ margin: 0, fontSize: '12px', color: '#ff8080' }}>⚠️ {gpsError}</p>
            </div>
          )}

          {/* Manual location button */}
          {gpsState === 'idle' && (
            <button
              onClick={getLocation}
              style={{
                marginTop: '12px', padding: '9px 20px',
                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: '8px', color: 'rgba(255,255,255,0.7)', fontSize: '13px',
                cursor: 'pointer'
              }}
            >
              📍 Get my location
            </button>
          )}
          {(gpsState === 'ready' || gpsState === 'error') && (
            <button
              onClick={getLocation}
              style={{
                marginTop: '10px', padding: '7px 16px',
                background: 'transparent', border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: '8px', color: 'rgba(255,255,255,0.5)', fontSize: '12px',
                cursor: 'pointer'
              }}
            >
              🔄 Refresh location
            </button>
          )}
        </div>
      </div>
      {/* CONTACTS LIST */}
      <div style={{ padding: '8px 16px' }}>
        {/* Section: Primary */}
        {primaryContacts.length > 0 && (
          <div style={{ marginBottom: '4px' }}>
            <p style={{ margin: '12px 0 8px', fontSize: '11px', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
              ★ Primary Contact
            </p>
            {primaryContacts.map(c => (
              <ContactCard
                key={c.id}
                contact={c}
                location={location}
                sentTo={sentTo}
                onEdit={() => openEdit(c)}
                onDelete={() => deleteContact(c.id)}
                onWhatsApp={() => shareViaWhatsApp(c)}
                onSMS={() => shareViaSMS(c)}
                isPrimary
              />
            ))}
          </div>
        )}

        {/* Section: Others */}
        {otherContacts.length > 0 && (
          <div>
            <p style={{ margin: '12px 0 8px', fontSize: '11px', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
              Other Contacts
            </p>
            {otherContacts.map(c => (
              <ContactCard
                key={c.id}
                contact={c}
                location={location}
                sentTo={sentTo}
                onEdit={() => openEdit(c)}
                onDelete={() => deleteContact(c.id)}
                onWhatsApp={() => shareViaWhatsApp(c)}
                onSMS={() => shareViaSMS(c)}
              />
            ))}
          </div>
        )}

        {!loading && contacts.length === 0 && (
          <div style={{
            textAlign: 'center', padding: '40px 20px',
            background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.1)',
            borderRadius: '16px', marginTop: '16px'
          }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>👤</div>
            <p style={{ margin: '0 0 6px', fontSize: '15px', color: 'rgba(255,255,255,0.6)', fontWeight: 500 }}>No emergency contacts yet</p>
            <p style={{ margin: 0, fontSize: '12px', color: 'rgba(255,255,255,0.3)' }}>Add trusted people who can help in emergencies</p>
          </div>
        )}

        {loading && (
          <div style={{ textAlign: 'center', padding: '40px', color: 'rgba(255,255,255,0.3)', fontSize: '13px' }}>
            Loading contacts...
          </div>
        )}
      </div>

      {/* ADD BUTTON */}
      <div style={{ padding: '12px 16px' }}>
        <button
          onClick={openAdd}
          style={{
            width: '100%', padding: '14px',
            background: 'linear-gradient(135deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.03) 100%)',
            border: '1px dashed rgba(255,255,255,0.2)',
            borderRadius: '12px', color: 'rgba(255,255,255,0.7)',
            fontSize: '14px', cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px'
          }}
        >
          <span style={{ fontSize: '18px' }}>+</span> Add Emergency Contact
        </button>
      </div>

      {/* FORM MODAL */}
      {showForm && (
        <div
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
            display: 'flex', alignItems: 'flex-end', zIndex: 100
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowForm(false); }}
        >
          <div style={{
            background: '#141420', borderRadius: '20px 20px 0 0',
            padding: '20px 20px 36px', width: '100%', maxWidth: '480px', margin: '0 auto',
            border: '1px solid rgba(255,255,255,0.08)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#fff' }}>
                {editContact ? 'Edit Contact' : 'Add Emergency Contact'}
              </h3>
              <button onClick={() => setShowForm(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', fontSize: '20px', cursor: 'pointer', padding: '4px' }}>✕</button>
            </div>

            {/* Name */}
            <label style={{ display: 'block', marginBottom: '14px' }}>
              <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Full Name</span>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Ramesh Kumar"
                style={{
                  display: 'block', width: '100%', marginTop: '6px', padding: '11px 12px',
                  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '10px', color: '#fff', fontSize: '14px', fontFamily: 'inherit',
                  outline: 'none', boxSizing: 'border-box'
                }}
              />
            </label>

            {/* Phone */}
            <label style={{ display: 'block', marginBottom: '14px' }}>
              <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Phone Number</span>
              <input
                type="tel"
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="+91 9876543210"
                style={{
                  display: 'block', width: '100%', marginTop: '6px', padding: '11px 12px',
                  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '10px', color: '#fff', fontSize: '14px', fontFamily: 'inherit',
                  outline: 'none', boxSizing: 'border-box'
                }}
              />
            </label>

            {/* Relation */}
            <label style={{ display: 'block', marginBottom: '14px' }}>
              <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Relation</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                {RELATIONS.map(r => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, relation: r }))}
                    style={{
                      padding: '6px 12px', borderRadius: '20px', fontSize: '12px',
                      background: form.relation === r ? 'rgba(255,80,80,0.2)' : 'rgba(255,255,255,0.05)',
                      border: form.relation === r ? '1px solid rgba(255,80,80,0.5)' : '1px solid rgba(255,255,255,0.1)',
                      color: form.relation === r ? '#ff8080' : 'rgba(255,255,255,0.5)',
                      cursor: 'pointer', fontFamily: 'inherit'
                    }}
                  >
                    {RELATION_ICONS[r]} {r}
                  </button>
                ))}
              </div>
            </label>

            {/* Primary toggle */}
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px', cursor: 'pointer' }}>
              <div
                onClick={() => setForm(f => ({ ...f, is_primary: !f.is_primary }))}
                style={{
                  width: '42px', height: '24px', borderRadius: '12px',
                  background: form.is_primary ? 'rgba(255,80,80,0.7)' : 'rgba(255,255,255,0.1)',
                  position: 'relative', transition: 'background 0.2s', flexShrink: 0
                }}
              >
                <div style={{
                  position: 'absolute', top: '3px',
                  left: form.is_primary ? '21px' : '3px',
                  width: '18px', height: '18px', borderRadius: '50%',
                  background: '#fff', transition: 'left 0.2s',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.3)'
                }} />
              </div>
              <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)' }}>
                ★ Mark as primary contact
              </span>
            </label>

            {error && (
              <p style={{ margin: '0 0 12px', fontSize: '12px', color: '#ff8080', background: 'rgba(255,80,80,0.1)', padding: '8px 12px', borderRadius: '8px' }}>
                {error}
              </p>
            )}

            <button
              onClick={saveContact}
              disabled={saving}
              style={{
                width: '100%', padding: '13px',
                background: saving ? 'rgba(255,80,80,0.3)' : 'linear-gradient(135deg, #cc2020, #991010)',
                border: 'none', borderRadius: '12px',
                color: '#fff', fontSize: '14px', fontWeight: 600,
                cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit'
              }}
            >
              {saving ? 'Saving...' : editContact ? 'Save Changes' : 'Add Contact'}
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        * { -webkit-tap-highlight-color: transparent; }
        input::placeholder { color: rgba(255,255,255,0.25); }
        input:focus { border-color: rgba(255,80,80,0.4) !important; box-shadow: 0 0 0 3px rgba(255,60,60,0.1); }
      `}</style>
    </div>
  );
}

function ContactCard({ contact, location, sentTo, onEdit, onDelete, onWhatsApp, onSMS, isPrimary }) {
  const alreadySent = sentTo.includes(contact.id);

  return (
    <div style={{
      background: isPrimary
        ? 'linear-gradient(135deg, rgba(220,30,30,0.12) 0%, rgba(180,20,20,0.06) 100%)'
        : 'rgba(255,255,255,0.04)',
      border: isPrimary ? '1px solid rgba(255,80,80,0.25)' : '1px solid rgba(255,255,255,0.08)',
      borderRadius: '14px',
      padding: '14px',
      marginBottom: '10px'
    }}>
      {/* Top row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <div style={{
            width: '40px', height: '40px', borderRadius: '50%',
            background: isPrimary ? 'rgba(255,80,80,0.2)' : 'rgba(255,255,255,0.07)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '18px', flexShrink: 0
          }}>
            {RELATION_ICONS[contact.relation] || '👤'}
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '15px', fontWeight: 600, color: '#fff' }}>{contact.name}</span>
              {isPrimary && <span style={{ fontSize: '10px', color: '#ff8080', background: 'rgba(255,80,80,0.15)', padding: '2px 6px', borderRadius: '10px', letterSpacing: '0.3px' }}>PRIMARY</span>}
            </div>
            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.45)', marginTop: '1px' }}>
              {contact.relation} · {contact.phone}
            </div>
          </div>
        </div>
        {/* Edit / Delete */}
        <div style={{ display: 'flex', gap: '4px' }}>
          <button onClick={onEdit} style={{ background: 'rgba(255,255,255,0.07)', border: 'none', borderRadius: '8px', padding: '6px 10px', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: '12px' }}>
            ✏️
          </button>
          <button onClick={onDelete} style={{ background: 'rgba(255,60,60,0.08)', border: 'none', borderRadius: '8px', padding: '6px 10px', color: 'rgba(255,80,80,0.6)', cursor: 'pointer', fontSize: '12px' }}>
            🗑️
          </button>
        </div>
      </div>

      {/* Share buttons — only show when location is ready */}
      {location && (
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={onWhatsApp}
            style={{
              flex: 1, padding: '9px 12px',
              background: alreadySent ? 'rgba(37,211,102,0.08)' : 'rgba(37,211,102,0.15)',
              border: `1px solid ${alreadySent ? 'rgba(37,211,102,0.2)' : 'rgba(37,211,102,0.35)'}`,
              borderRadius: '10px', color: alreadySent ? 'rgba(37,211,102,0.5)' : '#25d366',
              fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px'
            }}
          >
            <span>📱</span> {alreadySent ? 'Sent via WhatsApp ✓' : 'Send via WhatsApp'}
          </button>
          <button
            onClick={onSMS}
            style={{
              padding: '9px 14px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: '10px', color: 'rgba(255,255,255,0.5)',
              fontSize: '12px', cursor: 'pointer', fontFamily: 'inherit'
            }}
          >
            💬 SMS
          </button>
        </div>
      )}

      {/* If no location yet, show call button */}
      {!location && (
        <a
          href={`tel:${contact.phone}`}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
            padding: '9px', background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '10px', color: 'rgba(255,255,255,0.55)',
            fontSize: '12px', textDecoration: 'none', fontWeight: 500
          }}
        >
          📞 Call {contact.name.split(' ')[0]}
        </a>
      )}
    </div>
  );
}
