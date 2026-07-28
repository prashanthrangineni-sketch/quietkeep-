'use client';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context/auth';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import NavbarClient from '@/components/NavbarClient';

function fmt(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function duration(start, end) {
  if (!start || !end) return null;
  const secs = Math.round((new Date(end) - new Date(start)) / 1000);
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60); const s = secs % 60;
  return `${m}m ${s}s`;
}

export default function SOSPage() {
  const router = useRouter();
  const { user, accessToken, loading: authLoading } = useAuth();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
    loadEvents(user?.id);
  }, [user]);

  async function loadEvents(uid) {
    setLoading(true);
    const { data } = await supabase
      .from('sos_events')
      .select('*')
      .eq('user_id', uid)
      .order('triggered_at', { ascending: false });
    setEvents(data || []);
    setLoading(false);
  }

  async function markResolved(id) {
    setResolving(id);
    await supabase.from('sos_events').update({
      resolved_at: new Date().toISOString(),
    }).eq('id', id);
    setEvents(events.map(e => e.id === id ? { ...e, resolved_at: new Date().toISOString() } : e));
    setResolving(null);
  }

  const unresolved = events.filter(e => !e.resolved_at);
  const resolved = events.filter(e => e.resolved_at);

  return (
    <>
      <NavbarClient />
      <div style={{ minHeight: '100vh', background: '#0d1117', color: '#f0f0f5', fontFamily: "'DM Sans', -apple-system, sans-serif", paddingBottom: '80px', paddingTop: '96px' }}>

      {/* Header */}
      <div style={{ background: 'linear-gradient(135deg, #160a0a, #100a14)', borderBottom: '1px solid rgba(255,80,80,0.2)', padding: '20px 16px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
          <span style={{ fontSize: '22px' }}>🆘</span>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#fff', letterSpacing: '-0.3px' }}>SOS History</h1>
          {unresolved.length > 0 && (
            <span style={{ fontSize: '11px', background: 'rgba(255,80,80,0.25)', color: '#ff8080', padding: '2px 8px', borderRadius: '10px', fontWeight: 600 }}>
              {unresolved.length} unresolved
            </span>
          )}
        </div>
        <p style={{ margin: 0, fontSize: '13px', color: 'rgba(255,255,255,0.4)' }}>
          {events.length} SOS event{events.length !== 1 ? 's' : ''} total
        </p>
      </div>

      <div style={{ padding: '16px' }}>

        {loading && <div style={{ textAlign: 'center', padding: '40px', color: 'rgba(255,255,255,0.3)', fontSize: '13px' }}>Loading...</div>}

        {!loading && events.length === 0 && (
          <div style={{ textAlign: 'center', padding: '56px 20px', background: 'rgba(255,255,255,0.03)', border: '1px dashed rgba(255,255,255,0.1)', borderRadius: '16px' }}>
            <div style={{ fontSize: '48px', marginBottom: '14px' }}>🛡️</div>
            <p style={{ margin: '0 0 8px', fontSize: '15px', color: 'rgba(255,255,255,0.6)', fontWeight: 500 }}>No SOS events</p>
            <p style={{ margin: 0, fontSize: '12px', color: 'rgba(255,255,255,0.35)' }}>Stay safe. Your SOS history will appear here.</p>
          </div>
        )}

        {/* Unresolved first */}
        {unresolved.length > 0 && (
          <div style={{ marginBottom: '20px' }}>
            <p style={{ margin: '0 0 10px', fontSize: '11px', color: '#ff8080', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
              ⚠️ Unresolved
            </p>
            {unresolved.map(e => <SOSCard key={e.id} event={e} onResolve={() => markResolved(e.id)} resolving={resolving === e.id} />)}
          </div>
        )}

        {/* Resolved */}
        {resolved.length > 0 && (
          <div>
            <p style={{ margin: '0 0 10px', fontSize: '11px', color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
              Resolved
            </p>
            {resolved.map(e => <SOSCard key={e.id} event={e} resolved />)}
          </div>
        )}
      </div>
    </div>
    </>
  );
}

function SOSCard({ event: e, onResolve, resolving, resolved }) {
  const mapsUrl = e.location_lat && e.location_lng
    ? `https://maps.google.com/?q=${e.location_lat},${e.location_lng}`
    : null;

  return (
    <div style={{
      background: resolved ? 'rgba(255,255,255,0.03)' : 'rgba(255,60,60,0.08)',
      border: `1px solid ${resolved ? 'rgba(255,255,255,0.08)' : 'rgba(255,80,80,0.3)'}`,
      borderLeft: `3px solid ${resolved ? '#4ade80' : '#ff4040'}`,
      borderRadius: '14px', padding: '14px', marginBottom: '10px',
      opacity: resolved ? 0.7 : 1,
    }}>
      {/* Top row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={{ fontSize: '13px', fontWeight: 700, color: resolved ? '#4ade80' : '#ff8080' }}>
              {resolved ? '✅ Resolved' : '🆘 Active SOS'}
            </span>
          </div>
          <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.45)' }}>
            Triggered: {fmt(e.triggered_at)}
          </div>
          {e.resolved_at && (
            <div style={{ fontSize: '12px', color: 'rgba(255,255,255,0.35)', marginTop: '2px' }}>
              Resolved: {fmt(e.resolved_at)}
              {duration(e.triggered_at, e.resolved_at) && (
                <span style={{ color: 'rgba(255,255,255,0.25)' }}> · {duration(e.triggered_at, e.resolved_at)}</span>
              )}
            </div>
          )}
        </div>
        {!resolved && (
          <button
            onClick={onResolve}
            disabled={resolving}
            style={{ padding: '7px 14px', background: 'rgba(74,222,128,0.2)', border: '1px solid rgba(74,222,128,0.4)', borderRadius: '8px', color: '#4ade80', fontSize: '12px', fontWeight: 600, cursor: resolving ? 'not-allowed' : 'pointer', fontFamily: 'inherit' }}
          >
            {resolving ? '...' : '✓ Resolve'}
          </button>
        )}
      </div>

      {/* Meta */}
      <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', marginBottom: mapsUrl || e.notes ? '10px' : '0' }}>
        {e.contacts_notified > 0 && (
          <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.45)' }}>
            📱 {e.contacts_notified} contact{e.contacts_notified > 1 ? 's' : ''} notified
          </span>
        )}
        {e.location_lat && (
          <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.45)' }}>
            📍 {parseFloat(e.location_lat).toFixed(4)}, {parseFloat(e.location_lng).toFixed(4)}
          </span>
        )}
      </div>

      {e.notes && (
        <p style={{ margin: '0 0 10px', fontSize: '12px', color: 'rgba(255,255,255,0.45)', fontStyle: 'italic' }}>
          "{e.notes}"
        </p>
      )}

      {/* Map link */}
      {mapsUrl && (
        <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: '#60a5fa', textDecoration: 'none', background: 'rgba(96,165,250,0.1)', padding: '5px 12px', borderRadius: '8px', border: '1px solid rgba(96,165,250,0.2)' }}>
          🗺️ View location on map
        </a>
      )}
    </div>
  );
}
