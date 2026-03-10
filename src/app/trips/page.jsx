'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import NavbarClient from '@/components/NavbarClient';

const STATUSES = ['planning', 'confirmed', 'completed', 'cancelled'];
const STATUS_META = {
  planning:  { label: 'Planning',   color: '#fbbf24', bg: 'rgba(251,191,36,0.12)'  },
  confirmed: { label: 'Confirmed',  color: '#4ade80', bg: 'rgba(74,222,128,0.12)'  },
  completed: { label: 'Done',       color: '#60a5fa', bg: 'rgba(96,165,250,0.12)'  },
  cancelled: { label: 'Cancelled',  color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
};

function fmt(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const diff = Math.ceil((new Date(dateStr) - new Date()) / (1000*60*60*24));
  if (diff < 0) return null;
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return `${diff} days away`;
}

const EMPTY_FORM = { destination:'', travel_date:'', return_date:'', travelers:1, budget:'', status:'planning', notes:'' };

export default function TripsPage() {
  const [user, setUser] = useState(null);
  const [trips, setTrips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editTrip, setEditTrip] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) { setUser(user); loadTrips(user.id); }
    });
  }, []);

  async function loadTrips(uid) {
    setLoading(true);
    const { data } = await supabase
      .from('trip_plans')
      .select('*')
      .eq('user_id', uid)
      .order('travel_date', { ascending: true });
    setTrips(data || []);
    setLoading(false);
  }

  function openAdd() {
    setEditTrip(null);
    setForm(EMPTY_FORM);
    setError('');
    setShowForm(true);
  }

  function openEdit(t) {
    setEditTrip(t);
    setForm({
      destination: t.destination || '',
      travel_date: t.travel_date || '',
      return_date: t.return_date || '',
      travelers: t.travelers || 1,
      budget: t.budget || '',
      status: t.status || 'planning',
      notes: t.notes || '',
    });
    setError('');
    setShowForm(true);
  }

  async function saveTrip() {
    if (!form.destination.trim()) return setError('Destination is required');
    setSaving(true);
    setError('');

    const payload = {
      user_id: user.id,
      destination: form.destination.trim(),
      travel_date: form.travel_date || null,
      return_date: form.return_date || null,
      travelers: parseInt(form.travelers) || 1,
      budget: form.budget ? parseFloat(form.budget) : null,
      status: form.status,
      notes: form.notes.trim() || null,
    };

    let err;
    if (editTrip) {
      ({ error: err } = await supabase.from('trip_plans').update(payload).eq('id', editTrip.id));
    } else {
      ({ error: err } = await supabase.from('trip_plans').insert(payload));
    }
    setSaving(false);
    if (err) return setError(err.message);
    setShowForm(false);
    loadTrips(user.id);
  }

  async function deleteTrip(id) {
    if (!confirm('Delete this trip?')) return;
    await supabase.from('trip_plans').delete().eq('id', id);
    setTrips(t => t.filter(x => x.id !== id));
  }

  async function updateStatus(id, status) {
    await supabase.from('trip_plans').update({ status }).eq('id', id);
    setTrips(trips.map(t => t.id === id ? { ...t, status } : t));
  }

  const filtered = filter === 'all' ? trips : trips.filter(t => t.status === filter);
  const upcoming = trips.filter(t => t.travel_date && new Date(t.travel_date) >= new Date() && t.status !== 'cancelled');

  return (
    <>
      <NavbarClient />
      <div style={{ minHeight:'100vh', background:'#0a0f0d', color:'#f0f0f5', fontFamily:"'DM Sans', -apple-system, sans-serif", paddingBottom:'80px', paddingTop:'96px' }}>

      {/* Header */}
      <div style={{ background:'linear-gradient(135deg,#0a1209,#0d1a10)', borderBottom:'1px solid rgba(74,222,128,0.15)', padding:'20px 16px 16px' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'4px' }}>
              <span style={{ fontSize:'22px' }}>✈️</span>
              <h1 style={{ margin:0, fontSize:'20px', fontWeight:700, color:'#fff', letterSpacing:'-0.3px' }}>Trip Plans</h1>
            </div>
            <p style={{ margin:0, fontSize:'13px', color:'rgba(255,255,255,0.4)' }}>
              {upcoming.length > 0 ? `${upcoming.length} upcoming trip${upcoming.length > 1 ? 's' : ''}` : 'Plan your next adventure'}
            </p>
          </div>
          <button
            onClick={openAdd}
            style={{ padding:'9px 16px', background:'rgba(74,222,128,0.2)', border:'1px solid rgba(74,222,128,0.4)', borderRadius:'10px', color:'#4ade80', fontSize:'13px', fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}
          >
            + Add
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div style={{ display:'flex', gap:'6px', padding:'12px 16px', overflowX:'auto', scrollbarWidth:'none' }}>
        {['all', ...STATUSES].map(s => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            style={{
              padding:'6px 14px', borderRadius:'20px', fontSize:'12px', fontWeight:500,
              background: filter === s ? 'rgba(74,222,128,0.2)' : 'rgba(255,255,255,0.05)',
              border: filter === s ? '1px solid rgba(74,222,128,0.4)' : '1px solid rgba(255,255,255,0.1)',
              color: filter === s ? '#4ade80' : 'rgba(255,255,255,0.5)',
              cursor:'pointer', fontFamily:'inherit', whiteSpace:'nowrap', flexShrink:0
            }}
          >
            {s === 'all' ? 'All' : STATUS_META[s]?.label}
          </button>
        ))}
      </div>
      {/* Trip cards */}
      <div style={{ padding:'0 16px' }}>
        {loading && <div style={{ textAlign:'center', padding:'40px', color:'rgba(255,255,255,0.3)', fontSize:'13px' }}>Loading...</div>}

        {!loading && filtered.length === 0 && (
          <div style={{ textAlign:'center', padding:'48px 20px', background:'rgba(255,255,255,0.03)', border:'1px dashed rgba(255,255,255,0.1)', borderRadius:'16px' }}>
            <div style={{ fontSize:'40px', marginBottom:'12px' }}>🗺️</div>
            <p style={{ margin:'0 0 6px', fontSize:'15px', color:'rgba(255,255,255,0.6)', fontWeight:500 }}>No trips here</p>
            <p style={{ margin:0, fontSize:'12px', color:'rgba(255,255,255,0.3)' }}>Add your first trip to get started</p>
          </div>
        )}

        {filtered.map(trip => {
          const sm = STATUS_META[trip.status] || STATUS_META.planning;
          const countdown = daysUntil(trip.travel_date);
          const nights = trip.travel_date && trip.return_date
            ? Math.ceil((new Date(trip.return_date) - new Date(trip.travel_date)) / (1000*60*60*24))
            : null;

          return (
            <div key={trip.id} style={{
              background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)',
              borderRadius:'14px', padding:'14px', marginBottom:'10px'
            }}>
              {/* Top row */}
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'10px' }}>
                <div style={{ flex:1 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'4px', flexWrap:'wrap' }}>
                    <span style={{ fontSize:'16px', fontWeight:700, color:'#fff' }}>✈️ {trip.destination}</span>
                    <span style={{ fontSize:'10px', padding:'2px 8px', borderRadius:'10px', background:sm.bg, color:sm.color, fontWeight:600 }}>
                      {sm.label}
                    </span>
                    {countdown && trip.status !== 'completed' && trip.status !== 'cancelled' && (
                      <span style={{ fontSize:'10px', color:'#fbbf24', background:'rgba(251,191,36,0.1)', padding:'2px 8px', borderRadius:'10px' }}>
                        {countdown}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize:'12px', color:'rgba(255,255,255,0.45)' }}>
                    {fmt(trip.travel_date)}{trip.return_date ? ` → ${fmt(trip.return_date)}` : ''}{nights ? ` · ${nights} night${nights>1?'s':''}` : ''}
                  </div>
                </div>
                <div style={{ display:'flex', gap:'4px' }}>
                  <button onClick={() => openEdit(trip)} style={{ background:'rgba(255,255,255,0.07)', border:'none', borderRadius:'8px', padding:'6px 10px', color:'rgba(255,255,255,0.5)', cursor:'pointer', fontSize:'12px' }}>✏️</button>
                  <button onClick={() => deleteTrip(trip.id)} style={{ background:'rgba(255,60,60,0.08)', border:'none', borderRadius:'8px', padding:'6px 10px', color:'rgba(255,80,80,0.6)', cursor:'pointer', fontSize:'12px' }}>🗑️</button>
                </div>
              </div>

              {/* Meta row */}
              <div style={{ display:'flex', gap:'12px', marginBottom: trip.notes ? '8px' : '0', flexWrap:'wrap' }}>
                {trip.travelers > 0 && (
                  <span style={{ fontSize:'12px', color:'rgba(255,255,255,0.4)' }}>👥 {trip.travelers} traveller{trip.travelers > 1 ? 's' : ''}</span>
                )}
                {trip.budget && (
                  <span style={{ fontSize:'12px', color:'rgba(255,255,255,0.4)' }}>💰 ₹{Number(trip.budget).toLocaleString('en-IN')}</span>
                )}
              </div>

              {trip.notes && (
                <p style={{ margin:'6px 0 10px', fontSize:'12px', color:'rgba(255,255,255,0.45)', fontStyle:'italic' }}>
                  "{trip.notes}"
                </p>
              )}

              {/* Quick status update */}
              {trip.status !== 'completed' && trip.status !== 'cancelled' && (
                <div style={{ display:'flex', gap:'6px', borderTop:'1px solid rgba(255,255,255,0.06)', paddingTop:'10px' }}>
                  {STATUSES.filter(s => s !== trip.status).map(s => (
                    <button
                      key={s}
                      onClick={() => updateStatus(trip.id, s)}
                      style={{
                        padding:'5px 10px', borderRadius:'8px', fontSize:'11px',
                        background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)',
                        color:'rgba(255,255,255,0.45)', cursor:'pointer', fontFamily:'inherit'
                      }}
                    >
                      → {STATUS_META[s]?.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Form modal */}
      {showForm && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.75)', display:'flex', alignItems:'flex-end', zIndex:100 }}
          onClick={e => { if (e.target === e.currentTarget) setShowForm(false); }}>
          <div style={{ background:'#141a13', borderRadius:'20px 20px 0 0', padding:'20px 20px 36px', width:'100%', maxWidth:'480px', margin:'0 auto', border:'1px solid rgba(255,255,255,0.08)', maxHeight:'85vh', overflowY:'auto' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'18px' }}>
              <h3 style={{ margin:0, fontSize:'16px', fontWeight:600, color:'#fff' }}>{editTrip ? 'Edit Trip' : 'New Trip'}</h3>
              <button onClick={() => setShowForm(false)} style={{ background:'none', border:'none', color:'rgba(255,255,255,0.4)', fontSize:'20px', cursor:'pointer' }}>✕</button>
            </div>

            {[
              { key:'destination', label:'Destination', type:'text', placeholder:'e.g. Goa, Dubai, London' },
              { key:'travel_date', label:'Departure Date', type:'date', placeholder:'' },
              { key:'return_date', label:'Return Date', type:'date', placeholder:'' },
              { key:'travelers', label:'No. of Travellers', type:'number', placeholder:'1' },
              { key:'budget', label:'Budget (₹)', type:'number', placeholder:'e.g. 50000' },
            ].map(f => (
              <label key={f.key} style={{ display:'block', marginBottom:'12px' }}>
                <span style={{ fontSize:'11px', color:'rgba(255,255,255,0.4)', textTransform:'uppercase', letterSpacing:'0.5px' }}>{f.label}</span>
                <input
                  type={f.type}
                  value={form[f.key]}
                  onChange={e => setForm(v => ({ ...v, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  style={{ display:'block', width:'100%', marginTop:'5px', padding:'10px 12px', background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:'10px', color:'#fff', fontSize:'14px', fontFamily:'inherit', outline:'none', boxSizing:'border-box', colorScheme:'dark' }}
                />
              </label>
            ))}

            <label style={{ display:'block', marginBottom:'12px' }}>
              <span style={{ fontSize:'11px', color:'rgba(255,255,255,0.4)', textTransform:'uppercase', letterSpacing:'0.5px' }}>Status</span>
              <div style={{ display:'flex', gap:'6px', marginTop:'6px', flexWrap:'wrap' }}>
                {STATUSES.map(s => (
                  <button key={s} type="button" onClick={() => setForm(v => ({ ...v, status: s }))}
                    style={{ padding:'5px 12px', borderRadius:'20px', fontSize:'12px', cursor:'pointer', fontFamily:'inherit',
                      background: form.status === s ? STATUS_META[s].bg : 'rgba(255,255,255,0.04)',
                      border: form.status === s ? `1px solid ${STATUS_META[s].color}` : '1px solid rgba(255,255,255,0.1)',
                      color: form.status === s ? STATUS_META[s].color : 'rgba(255,255,255,0.4)'
                    }}
                  >{STATUS_META[s].label}</button>
                ))}
              </div>
            </label>

            <label style={{ display:'block', marginBottom:'16px' }}>
              <span style={{ fontSize:'11px', color:'rgba(255,255,255,0.4)', textTransform:'uppercase', letterSpacing:'0.5px' }}>Notes</span>
              <textarea value={form.notes} onChange={e => setForm(v => ({ ...v, notes: e.target.value }))} rows={2} placeholder="Any notes..."
                style={{ display:'block', width:'100%', marginTop:'5px', padding:'10px 12px', background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:'10px', color:'#fff', fontSize:'14px', fontFamily:'inherit', outline:'none', boxSizing:'border-box', resize:'vertical' }} />
            </label>

            {error && <p style={{ margin:'0 0 12px', fontSize:'12px', color:'#f87171', background:'rgba(248,113,113,0.1)', padding:'8px 12px', borderRadius:'8px' }}>{error}</p>}

            <button onClick={saveTrip} disabled={saving}
              style={{ width:'100%', padding:'13px', background: saving ? 'rgba(74,222,128,0.2)' : 'linear-gradient(135deg,#166534,#14532d)', border:'none', borderRadius:'12px', color:'#fff', fontSize:'14px', fontWeight:600, cursor: saving ? 'not-allowed' : 'pointer', fontFamily:'inherit' }}>
              {saving ? 'Saving...' : editTrip ? 'Save Changes' : 'Add Trip'}
            </button>
          </div>
        </div>
      )}

      <style>{`
        input::placeholder, textarea::placeholder { color: rgba(255,255,255,0.25); }
        input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(0.7); }
      `}</style>
    </div>
    </>
  );
}
