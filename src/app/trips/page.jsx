'use client';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context/auth';
/**
 * src/app/trips/page.jsx — AI Trip Planner
 * Day-by-day AI itinerary · Live weather · Budget tracker · Booking links · Packing list
 */
import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import NavbarClient from '@/components/NavbarClient';
import { safeFetch } from '@/lib/safeFetch';

const STATUSES = ['planning', 'confirmed', 'completed', 'cancelled'];
const STATUS_META = {
  planning:  { label: 'Planning',  color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
  confirmed: { label: 'Confirmed', color: '#4ade80', bg: 'rgba(74,222,128,0.12)' },
  completed: { label: 'Done',      color: '#60a5fa', bg: 'rgba(96,165,250,0.12)' },
  cancelled: { label: 'Cancelled', color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
};
const WX = {0:'☀️',1:'🌤',2:'⛅',3:'☁️',45:'🌫',51:'🌦',61:'🌧',71:'🌨',80:'🌦',95:'⛈'};
const wxEmoji = c => WX[c] || WX[Math.floor(c/10)*10] || '🌡️';

function fmt(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
}
function daysUntil(ds) {
  if (!ds) return null;
  const d = Math.ceil((new Date(ds) - new Date()) / 86400000);
  return d < 0 ? null : d === 0 ? 'Today!' : d === 1 ? 'Tomorrow' : `${d} days away`;
}
function buildBookingLinks(dest) {
  const e = encodeURIComponent;
  return [
    { emoji:'✈️', label:'MakeMyTrip Flights',   url:`https://www.makemytrip.com/flights/` },
    { emoji:'✈️', label:'Ixigo Flights',         url:`https://www.ixigo.com/flights/results/` },
    { emoji:'🏨', label:`Hotels in ${dest}`,     url:`https://www.booking.com/searchresults.html?ss=${e(dest)}` },
    { emoji:'🏨', label:'OYO Hotels',            url:`https://www.oyorooms.com/search/?location=${e(dest)}` },
    { emoji:'🚂', label:'IRCTC Train Booking',   url:`https://www.irctc.co.in/nget/train-search` },
    { emoji:'🚌', label:'RedBus',                url:`https://www.redbus.in/` },
    { emoji:'🚕', label:'OLA Cabs',              url:`https://book.olacabs.com/` },
  ];
}

const EMPTY_FORM = {
  destination:'', travel_date:'', return_date:'',
  travelers:1, budget:'', status:'planning', notes:'',
};

export default function TripsPage() {
  const router = useRouter();
  const { user, accessToken, loading: authLoading } = useAuth();
  const [trips, setTrips]             = useState([]);
  const [loading, setLoading]         = useState(true);
  const [view, setView]               = useState('list'); // list | form | detail
  const [editTrip, setEditTrip]       = useState(null);
  const [selected, setSelected]       = useState(null);
  const [form, setForm]               = useState(EMPTY_FORM);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');
  const [filter, setFilter]           = useState('all');
  const [aiPlan, setAiPlan]           = useState(null);
  const [aiLoading, setAiLoading]     = useState(false);
  const [aiQuery, setAiQuery]         = useState('');
  const [weather, setWeather]         = useState(null);
  const [packing, setPacking]         = useState([]);
  const [newPack, setNewPack]         = useState('');
  const [expenses, setExpenses]       = useState([]);
  const [newExp, setNewExp]           = useState({ label:'', amount:'' });
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace('/login'); return; }
          loadTrips(user?.id);
  }, [user]);

  async function loadTrips(uid) {
    setLoading(true);
    const { data } = await supabase.from('trip_plans').select('*')
      .eq('user_id', uid).order('travel_date', { ascending: true });
    setTrips(data || []);
    setLoading(false);
  }

  async function openDetail(trip) {
    setSelected(trip);
    setAiPlan(trip.ai_itinerary || null);
    setPacking(trip.packing_list || []);
    setExpenses(trip.expenses || []);
    setWeather(null);
    setView('detail');
    if (trip.destination) fetchWeather(trip.destination);
  }

  async function fetchWeather(dest) {
    try {
      const geoRes = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(dest)}&format=json&limit=1`
      );
      if (!geoRes.ok) return;
      const geo = await geoRes.json();
      if (!geo?.[0]) return;
      const { lat, lon } = geo[0];
      const wRes = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min,weathercode&timezone=Asia%2FKolkata&forecast_days=7`
      );
      if (!wRes.ok) return;
      const w = await wRes.json();
      setWeather(w?.daily || null);
    } catch {}
  }

  function fallbackPlan(dest, travelers, budget) {
    const n = 3;
    return {
      overview: `A wonderful ${n}-day trip to ${dest} for ${travelers||1} traveler(s).`,
      days: Array.from({length:n},(_, i)=>({
        day: i+1,
        title: ['Arrival & Exploration','Main Attractions','Local Culture & Departure'][i]||`Day ${i+1}`,
        morning: `Explore ${dest} in the morning`,
        afternoon: 'Visit famous landmarks',
        evening: 'Local dinner and evening walk',
        stay: 'Hotel near city centre',
        food: ['Local specialty', 'Street food'],
        cost_estimate: Math.round((parseFloat(budget)||5000)/n),
      })),
      tips: ['Book trains and hotels in advance','Carry cash for local markets','Check local weather'],
      best_time: 'October–March ideal for most Indian destinations',
      total_budget_estimate: parseFloat(budget)||5000,
      packing_essentials: ['ID proof','Medicines','Charger','Comfortable shoes','Camera'],
    };
  }

  async function generateAIItinerary() {
    if (!selected || aiLoading) return;
    setAiLoading(true);
    try {
      const nights = selected.travel_date && selected.return_date
        ? Math.ceil((new Date(selected.return_date) - new Date(selected.travel_date)) / 86400000)
        : 3;
      const prompt = `Create a detailed ${nights}-day travel itinerary for ${selected.destination}, India.
Travelers: ${selected.travelers||1}. Budget: \u20b9${selected.budget||'moderate'}.
${selected.notes ? 'Preferences: '+selected.notes : ''}
${aiQuery ? 'Special requests: '+aiQuery : ''}
Return ONLY valid JSON matching this structure exactly:
{"overview":"string","days":[{"day":1,"title":"string","morning":"string","afternoon":"string","evening":"string","stay":"string","food":["string"],"cost_estimate":0}],"tips":["string"],"best_time":"string","total_budget_estimate":0,"packing_essentials":["string"]}`;

      const { data: _aiData, error: _aiErr } = await safeFetch('/api/ai/summary', {
        method: 'POST',
        body: JSON.stringify({ prompt, type:'trip_itinerary' }),
        token: accessToken,
      });

      let plan = null;
      if (!_aiErr && _aiData) {
        const d = _aiData;
        const text = d.summary || d.result || d.content || '';
        const m = text.match(/\{[\s\S]*\}/);
        if (m) { try { plan = JSON.parse(m[0]); } catch {} }
      }
      if (!plan) plan = fallbackPlan(selected.destination, selected.travelers, selected.budget);

      setAiPlan(plan);
      const merged = [...new Set([...packing, ...(plan.packing_essentials||[])])];
      setPacking(merged);
      await supabase.from('trip_plans').update({
        ai_itinerary: plan, packing_list: merged,
      }).eq('id', selected.id);
      setSelected(s => ({ ...s, ai_itinerary: plan }));
    } catch {}
    setAiLoading(false);
  }

  async function saveTrip() {
    if (!form.destination.trim()) return setError('Destination is required');
    setSaving(true); setError('');
    const p = {
      user_id: user.id, destination: form.destination.trim(),
      travel_date: form.travel_date||null, return_date: form.return_date||null,
      travelers: parseInt(form.travelers)||1,
      budget: form.budget ? parseFloat(form.budget) : null,
      status: form.status, notes: form.notes.trim()||null,
    };
    if (editTrip) await supabase.from('trip_plans').update(p).eq('id', editTrip.id);
    else await supabase.from('trip_plans').insert(p);
    setSaving(false); setView('list'); loadTrips(user.id);
  }

  async function savePacking(list) {
    setPacking(list);
    await supabase.from('trip_plans').update({ packing_list: list }).eq('id', selected.id);
  }

  async function saveExpenses(list) {
    setExpenses(list);
    await supabase.from('trip_plans').update({ expenses: list }).eq('id', selected.id);
  }

  async function deleteTrip(id) {
    if (!confirm('Delete this trip?')) return;
    await supabase.from('trip_plans').delete().eq('id', id);
    setTrips(t => t.filter(x => x.id !== id));
    if (selected?.id === id) setView('list');
  }

  const filtered     = filter === 'all' ? trips : trips.filter(t => t.status === filter);
  const upcoming     = trips.filter(t => t.travel_date && new Date(t.travel_date) >= new Date() && t.status !== 'cancelled');
  const budgetSpent  = expenses.reduce((s,e) => s + (parseFloat(e.amount)||0), 0);

  const inp = {
    width:'100%', background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)',
    borderRadius:10, padding:'10px 12px', color:'#f1f5f9', fontSize:14,
    outline:'none', boxSizing:'border-box', fontFamily:'inherit',
  };

  return (
    <>
      <NavbarClient />
      <div style={{ minHeight:'100dvh', background:'var(--bg)', paddingTop:56, paddingBottom:80,
        fontFamily:"'Inter',-apple-system,sans-serif", color:'var(--text)' }}>

        {/* ── LIST ── */}
        {view === 'list' && (
          <div style={{ maxWidth:520, margin:'0 auto', padding:'20px 16px' }}>
            <div style={{ display:'flex', justifyContent:'space-between',
              alignItems:'flex-start', marginBottom:20 }}>
              <div>
                <div style={{ fontSize:22, fontWeight:900, letterSpacing:'-0.5px' }}>✈️ Trip Plans</div>
                <div style={{ fontSize:13, color:'var(--text-muted)', marginTop:2 }}>
                  {upcoming.length > 0 ? `${upcoming.length} upcoming` : 'AI-powered travel planner'}
                </div>
              </div>
              <button onClick={() => { setEditTrip(null); setForm(EMPTY_FORM); setError(''); setView('form'); }}
                style={{ padding:'9px 18px', borderRadius:10, border:'none',
                  background:'var(--primary)', color:'#fff', fontSize:13, fontWeight:700,
                  cursor:'pointer', fontFamily:'inherit' }}>
                + Plan Trip
              </button>
            </div>

            <div style={{ display:'flex', gap:5, marginBottom:14, overflowX:'auto', paddingBottom:4 }}>
              {['all',...STATUSES].map(s => (
                <button key={s} onClick={() => setFilter(s)}
                  style={{ padding:'4px 12px', borderRadius:20, fontSize:11, flexShrink:0,
                    background: filter===s ? 'var(--primary-dim)' : 'transparent',
                    border:`1px solid ${filter===s ? 'var(--primary-glow)' : 'var(--border)'}`,
                    color: filter===s ? 'var(--primary)' : 'var(--text-muted)',
                    cursor:'pointer', fontFamily:'inherit', textTransform:'capitalize', whiteSpace:'nowrap' }}>
                  {s==='all' ? 'All' : STATUS_META[s]?.label}
                </button>
              ))}
            </div>

            {loading ? (
              <div style={{ textAlign:'center', padding:'48px 0' }}>
                <div className="qk-spinner" style={{ margin:'0 auto 12px' }} />
                <div style={{ color:'var(--text-subtle)', fontSize:13 }}>Loading trips…</div>
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ textAlign:'center', padding:'60px 20px',
                border:'1px dashed var(--border)', borderRadius:20 }}>
                <div style={{ fontSize:52, marginBottom:16 }}>🗺️</div>
                <div style={{ fontSize:16, fontWeight:700, marginBottom:6 }}>No trips yet</div>
                <div style={{ fontSize:13, color:'var(--text-muted)', marginBottom:20 }}>
                  Plan your next adventure with AI itineraries
                </div>
                <button onClick={() => { setEditTrip(null); setForm(EMPTY_FORM); setView('form'); }}
                  style={{ padding:'12px 24px', borderRadius:12, border:'none',
                    background:'var(--primary)', color:'#fff', fontSize:14, fontWeight:700,
                    cursor:'pointer', fontFamily:'inherit' }}>
                  Plan your first trip →
                </button>
              </div>
            ) : filtered.map(trip => {
              const sm = STATUS_META[trip.status]||STATUS_META.planning;
              const countdown = daysUntil(trip.travel_date);
              const nights = trip.travel_date && trip.return_date
                ? Math.ceil((new Date(trip.return_date)-new Date(trip.travel_date))/86400000) : null;
              return (
                <div key={trip.id} onClick={() => openDetail(trip)}
                  style={{ background:'var(--surface)', border:'1px solid var(--border)',
                    borderRadius:16, padding:16, marginBottom:10, cursor:'pointer' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                    <div style={{ flex:1 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4, flexWrap:'wrap' }}>
                        <span style={{ fontSize:15, fontWeight:800 }}>✈️ {trip.destination}</span>
                        <span style={{ fontSize:9, padding:'2px 8px', borderRadius:10,
                          background:sm.bg, color:sm.color, fontWeight:700 }}>{sm.label}</span>
                        {countdown && trip.status !== 'completed' && (
                          <span style={{ fontSize:10, color:'#fbbf24',
                            background:'rgba(251,191,36,0.1)', padding:'2px 8px', borderRadius:10 }}>
                            {countdown}
                          </span>
                        )}
                        {trip.ai_itinerary && (
                          <span style={{ fontSize:9, color:'var(--primary)',
                            background:'var(--primary-dim)', padding:'2px 7px', borderRadius:10 }}>
                            🤖 Plan ready
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize:12, color:'var(--text-subtle)' }}>
                        {fmt(trip.travel_date)}{trip.return_date?` → ${fmt(trip.return_date)}`:''}
                        {nights?` · ${nights}n`:''}
                      </div>
                      <div style={{ display:'flex', gap:12, marginTop:5, flexWrap:'wrap' }}>
                        {trip.travelers > 1 && (
                          <span style={{ fontSize:11, color:'var(--text-subtle)' }}>👥 {trip.travelers}</span>
                        )}
                        {trip.budget && (
                          <span style={{ fontSize:11, color:'var(--text-subtle)' }}>
                            💰 ₹{Number(trip.budget).toLocaleString('en-IN')}
                          </span>
                        )}
                      </div>
                    </div>
                    <span style={{ color:'var(--text-subtle)', fontSize:16 }}>›</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── FORM ── */}
        {view === 'form' && (
          <div style={{ maxWidth:520, margin:'0 auto', padding:'20px 16px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:20 }}>
              <button onClick={() => setView('list')}
                style={{ padding:'7px 14px', borderRadius:8, border:'1px solid var(--border)',
                  background:'transparent', color:'var(--text-muted)', fontSize:13,
                  cursor:'pointer', fontFamily:'inherit' }}>←</button>
              <div style={{ fontSize:18, fontWeight:800 }}>
                {editTrip ? 'Edit Trip' : 'Plan New Trip'}
              </div>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              {[
                { key:'destination', label:'Destination *', type:'text',   ph:'Goa, Kedarnath, Dubai…' },
                { key:'travel_date', label:'Departure',     type:'date',   ph:'' },
                { key:'return_date', label:'Return',        type:'date',   ph:'' },
                { key:'travelers',   label:'Travelers',     type:'number', ph:'1' },
                { key:'budget',      label:'Budget (₹)',    type:'number', ph:'25000' },
              ].map(f => (
                <div key={f.key}>
                  <label style={{ fontSize:11, fontWeight:600, color:'var(--text-muted)',
                    display:'block', marginBottom:5, textTransform:'uppercase', letterSpacing:'0.05em' }}>
                    {f.label}
                  </label>
                  <input type={f.type} value={form[f.key]}
                    onChange={e => setForm(p=>({...p,[f.key]:e.target.value}))}
                    placeholder={f.ph} style={inp} />
                </div>
              ))}
              <div>
                <label style={{ fontSize:11, fontWeight:600, color:'var(--text-muted)',
                  display:'block', marginBottom:6, textTransform:'uppercase' }}>STATUS</label>
                <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                  {STATUSES.map(s => (
                    <button key={s} onClick={() => setForm(p=>({...p,status:s}))}
                      style={{ padding:'5px 12px', borderRadius:20, fontSize:12,
                        background: form.status===s ? STATUS_META[s].bg : 'transparent',
                        border:`1px solid ${form.status===s ? STATUS_META[s].color : 'rgba(255,255,255,0.1)'}`,
                        color: form.status===s ? STATUS_META[s].color : 'rgba(255,255,255,0.4)',
                        cursor:'pointer', fontFamily:'inherit', textTransform:'capitalize' }}>
                      {STATUS_META[s].label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label style={{ fontSize:11, fontWeight:600, color:'var(--text-muted)',
                  display:'block', marginBottom:5 }}>NOTES / PREFERENCES</label>
                <textarea value={form.notes} rows={3}
                  onChange={e => setForm(p=>({...p,notes:e.target.value}))}
                  placeholder="Beach, adventure, vegetarian food, budget hotels…"
                  style={{ ...inp, resize:'vertical', lineHeight:1.5 }} />
              </div>
              {error && (
                <div style={{ background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.3)',
                  borderRadius:10, padding:'9px 14px', fontSize:13, color:'#f87171' }}>
                  {error}
                </div>
              )}
              <button onClick={saveTrip} disabled={saving||!form.destination.trim()}
                style={{ width:'100%', padding:'14px', borderRadius:12, border:'none',
                  background: form.destination.trim() ? 'var(--primary)' : 'var(--surface-hover)',
                  color: form.destination.trim() ? '#fff' : 'var(--text-subtle)',
                  fontSize:15, fontWeight:700,
                  cursor: form.destination.trim() ? 'pointer' : 'not-allowed',
                  fontFamily:'inherit' }}>
                {saving ? 'Saving…' : editTrip ? 'Save Changes' : '✓ Create Trip'}
              </button>
            </div>
          </div>
        )}

        {/* ── DETAIL ── */}
        {view === 'detail' && selected && (
          <div style={{ maxWidth:520, margin:'0 auto', padding:'20px 16px' }}>
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:18 }}>
              <button onClick={() => setView('list')}
                style={{ padding:'7px 14px', borderRadius:8, border:'1px solid var(--border)',
                  background:'transparent', color:'var(--text-muted)', fontSize:13,
                  cursor:'pointer', fontFamily:'inherit' }}>←</button>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:18, fontWeight:900 }}>✈️ {selected.destination}</div>
                <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:1 }}>
                  {fmt(selected.travel_date)}{selected.return_date?` → ${fmt(selected.return_date)}`:''}
                  {selected.budget?` · \u20b9${Number(selected.budget).toLocaleString('en-IN')} budget`:''}
                </div>
              </div>
              <button onClick={() => {
                setEditTrip(selected);
                setForm({
                  destination:selected.destination, travel_date:selected.travel_date||'',
                  return_date:selected.return_date||'', travelers:selected.travelers||1,
                  budget:selected.budget||'', status:selected.status, notes:selected.notes||'',
                });
                setView('form');
              }} style={{ padding:'7px 12px', borderRadius:8, border:'1px solid var(--border)',
                background:'transparent', color:'var(--text-muted)', fontSize:13,
                cursor:'pointer', fontFamily:'inherit' }}>✏️</button>
            </div>

            {/* Weather */}
            {weather && (
              <div style={{ background:'var(--surface)', border:'1px solid var(--border)',
                borderRadius:14, padding:12, marginBottom:14, overflowX:'auto' }}>
                <div style={{ fontSize:10, fontWeight:700, color:'var(--text-subtle)',
                  textTransform:'uppercase', marginBottom:8 }}>
                  🌤 7-Day Weather · {selected.destination}
                </div>
                <div style={{ display:'flex', gap:10 }}>
                  {(weather.time||[]).slice(0,7).map((date,i) => (
                    <div key={date} style={{ textAlign:'center', minWidth:40 }}>
                      <div style={{ fontSize:9, color:'var(--text-subtle)', marginBottom:3 }}>
                        {new Date(date).toLocaleDateString('en-IN',{weekday:'short'})}
                      </div>
                      <div style={{ fontSize:18 }}>{wxEmoji(weather.weathercode?.[i])}</div>
                      <div style={{ fontSize:11, fontWeight:700, marginTop:3 }}>
                        {Math.round(weather.temperature_2m_max?.[i]||0)}°
                      </div>
                      <div style={{ fontSize:9, color:'var(--text-subtle)' }}>
                        {Math.round(weather.temperature_2m_min?.[i]||0)}°
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* AI Itinerary */}
            <div style={{ background:'var(--surface)', border:'1px solid var(--primary-glow)',
              borderRadius:16, padding:16, marginBottom:14 }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                <div style={{ fontSize:14, fontWeight:700 }}>🤖 AI Itinerary</div>
                <button onClick={generateAIItinerary} disabled={aiLoading}
                  style={{ padding:'6px 14px', borderRadius:8, border:'none',
                    background: aiLoading ? 'var(--surface-hover)' : 'var(--primary)',
                    color: aiLoading ? 'var(--text-subtle)' : '#fff',
                    fontSize:12, fontWeight:700,
                    cursor: aiLoading ? 'not-allowed' : 'pointer', fontFamily:'inherit' }}>
                  {aiLoading ? '⏳ Generating…' : aiPlan ? '🔄 Redo' : '✨ Generate'}
                </button>
              </div>
              <input value={aiQuery} onChange={e => setAiQuery(e.target.value)}
                placeholder="Special requirements… (vegetarian, adventure, low budget)"
                style={{ ...inp, fontSize:12, marginBottom:10 }} />

              {!aiPlan && !aiLoading && (
                <div style={{ textAlign:'center', padding:'14px 0', color:'var(--text-subtle)', fontSize:13 }}>
                  Tap Generate for a personalised day-by-day itinerary
                </div>
              )}
              {aiLoading && (
                <div style={{ textAlign:'center', padding:'20px 0' }}>
                  <div className="qk-spinner" style={{ margin:'0 auto 10px' }} />
                  <div style={{ fontSize:13, color:'var(--text-muted)' }}>Building itinerary…</div>
                </div>
              )}
              {aiPlan && !aiLoading && (
                <div>
                  {aiPlan.overview && (
                    <div style={{ fontSize:13, color:'var(--text-muted)', fontStyle:'italic',
                      lineHeight:1.6, marginBottom:12 }}>{aiPlan.overview}</div>
                  )}
                  {aiPlan.best_time && (
                    <div style={{ fontSize:12, color:'#fbbf24',
                      background:'rgba(251,191,36,0.08)', border:'1px solid rgba(251,191,36,0.2)',
                      borderRadius:8, padding:'6px 10px', marginBottom:10 }}>
                      ☀️ Best time: {aiPlan.best_time}
                    </div>
                  )}
                  {(aiPlan.days||[]).map(day => (
                    <div key={day.day} style={{ background:'rgba(255,255,255,0.03)',
                      border:'1px solid var(--border)', borderRadius:12,
                      padding:'12px 14px', marginBottom:8 }}>
                      <div style={{ fontSize:13, fontWeight:800, color:'var(--primary)', marginBottom:8 }}>
                        Day {day.day} — {day.title}
                      </div>
                      {[['🌅 Morning',day.morning],['☀️ Afternoon',day.afternoon],['🌙 Evening',day.evening]].map(([lbl,txt]) =>
                        txt ? (
                          <div key={lbl} style={{ display:'flex', gap:8, marginBottom:5 }}>
                            <span style={{ fontSize:11, color:'var(--text-subtle)', width:74, flexShrink:0 }}>{lbl}</span>
                            <span style={{ fontSize:12, color:'var(--text)', lineHeight:1.5 }}>{txt}</span>
                          </div>
                        ) : null
                      )}
                      {day.stay && <div style={{ fontSize:11, color:'var(--text-subtle)', marginTop:4 }}>🏨 {day.stay}</div>}
                      {day.food?.length > 0 && <div style={{ fontSize:11, color:'var(--text-subtle)', marginTop:2 }}>🍽️ Try: {day.food.join(', ')}</div>}
                      {day.cost_estimate && (
                        <div style={{ fontSize:11, color:'#22c55e', marginTop:4 }}>
                          💰 ~₹{Number(day.cost_estimate).toLocaleString('en-IN')}/person
                        </div>
                      )}
                    </div>
                  ))}
                  {aiPlan.tips?.length > 0 && (
                    <div style={{ background:'rgba(99,102,241,0.06)', border:'1px solid rgba(99,102,241,0.2)',
                      borderRadius:10, padding:'10px 14px', marginBottom:10 }}>
                      <div style={{ fontSize:10, fontWeight:700, color:'var(--primary)',
                        marginBottom:5, textTransform:'uppercase' }}>💡 TIPS</div>
                      {aiPlan.tips.map((t,i) => (
                        <div key={i} style={{ fontSize:12, color:'var(--text-muted)', marginBottom:3 }}>• {t}</div>
                      ))}
                    </div>
                  )}
                  {aiPlan.total_budget_estimate && (
                    <div style={{ textAlign:'center', padding:'10px',
                      background:'rgba(16,185,129,0.06)', border:'1px solid rgba(16,185,129,0.2)',
                      borderRadius:10 }}>
                      <div style={{ fontSize:11, color:'var(--text-subtle)' }}>Estimated total budget</div>
                      <div style={{ fontSize:20, fontWeight:900, color:'#10b981' }}>
                        ₹{Number(aiPlan.total_budget_estimate).toLocaleString('en-IN')}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Booking links */}
            <div style={{ background:'var(--surface)', border:'1px solid var(--border)',
              borderRadius:14, padding:14, marginBottom:14 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--text-subtle)',
                textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:10 }}>
                🔗 Book Now
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:7 }}>
                {buildBookingLinks(selected.destination).map(b => (
                  <a key={b.label} href={b.url} target="_blank" rel="noopener"
                    style={{ display:'flex', alignItems:'center', gap:7, padding:'8px 10px',
                      background:'rgba(255,255,255,0.04)', border:'1px solid var(--border)',
                      borderRadius:9, textDecoration:'none', color:'var(--text-muted)', fontSize:11 }}>
                    <span>{b.emoji}</span>
                    <span style={{ fontSize:10 }}>{b.label}</span>
                  </a>
                ))}
              </div>
            </div>

            {/* Budget tracker */}
            <div style={{ background:'var(--surface)', border:'1px solid var(--border)',
              borderRadius:14, padding:14, marginBottom:14 }}>
              <div style={{ display:'flex', justifyContent:'space-between',
                alignItems:'center', marginBottom:8 }}>
                <div style={{ fontSize:11, fontWeight:700, color:'var(--text-subtle)',
                  textTransform:'uppercase', letterSpacing:'0.06em' }}>💰 Budget Tracker</div>
                {selected.budget && (
                  <div style={{ fontSize:13, fontWeight:700,
                    color: budgetSpent > selected.budget ? '#ef4444' : '#10b981' }}>
                    ₹{budgetSpent.toLocaleString('en-IN')} / ₹{Number(selected.budget).toLocaleString('en-IN')}
                  </div>
                )}
              </div>
              {selected.budget && (
                <div style={{ height:5, background:'var(--border)', borderRadius:3, marginBottom:10, overflow:'hidden' }}>
                  <div style={{ height:'100%', borderRadius:3,
                    background: budgetSpent > selected.budget ? '#ef4444' : '#10b981',
                    width:`${Math.min(100,(budgetSpent/selected.budget)*100)}%`, transition:'width 0.3s' }} />
                </div>
              )}
              {expenses.map((exp, i) => (
                <div key={i} style={{ display:'flex', justifyContent:'space-between',
                  alignItems:'center', fontSize:12, padding:'4px 0',
                  borderBottom:'1px solid var(--border)' }}>
                  <span>{exp.label}</span>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span style={{ color:'#f59e0b', fontWeight:700 }}>₹{Number(exp.amount).toLocaleString('en-IN')}</span>
                    <button onClick={() => saveExpenses(expenses.filter((_,j)=>j!==i))}
                      style={{ background:'none', border:'none', color:'#ef4444', cursor:'pointer', fontSize:14 }}>×</button>
                  </div>
                </div>
              ))}
              <div style={{ display:'flex', gap:6, marginTop:8 }}>
                <input value={newExp.label}
                  onChange={e => setNewExp(p=>({...p,label:e.target.value}))}
                  placeholder="Expense label" style={{ ...inp, flex:2, fontSize:12 }} />
                <input type="number" value={newExp.amount}
                  onChange={e => setNewExp(p=>({...p,amount:e.target.value}))}
                  placeholder="₹" style={{ ...inp, flex:1, fontSize:12 }} />
                <button onClick={() => {
                  if (!newExp.label||!newExp.amount) return;
                  saveExpenses([...expenses, { ...newExp }]);
                  setNewExp({ label:'', amount:'' });
                }} style={{ padding:'8px 12px', borderRadius:8, border:'none',
                  background:'#10b981', color:'#fff', fontSize:13, cursor:'pointer',
                  fontFamily:'inherit', flexShrink:0 }}>+</button>
              </div>
            </div>

            {/* Packing list */}
            <div style={{ background:'var(--surface)', border:'1px solid var(--border)',
              borderRadius:14, padding:14, marginBottom:14 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--text-subtle)',
                textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:10 }}>
                🎒 Packing List ({packing.filter(i=>i.checked).length}/{packing.length})
              </div>
              {packing.map((item, i) => {
                const text    = typeof item === 'string' ? item : item.text;
                const checked = typeof item === 'string' ? false : item.checked;
                return (
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:10, padding:'6px 0',
                    borderBottom: i < packing.length-1 ? '1px solid var(--border)' : 'none' }}>
                    <input type="checkbox" checked={checked}
                      onChange={() => savePacking(packing.map((it,j) => j===i
                        ? (typeof it==='string' ? {text:it,checked:true} : {...it,checked:!it.checked})
                        : it))}
                      style={{ width:16, height:16, cursor:'pointer', accentColor:'#10b981' }} />
                    <span style={{ fontSize:13, flex:1,
                      textDecoration: checked ? 'line-through' : 'none',
                      opacity: checked ? 0.5 : 1 }}>{text}</span>
                    <button onClick={() => savePacking(packing.filter((_,j)=>j!==i))}
                      style={{ background:'none', border:'none', color:'#ef4444',
                        cursor:'pointer', fontSize:14, lineHeight:1 }}>×</button>
                  </div>
                );
              })}
              <div style={{ display:'flex', gap:6, marginTop:8 }}>
                <input value={newPack}
                  onChange={e => setNewPack(e.target.value)}
                  onKeyDown={e => {
                    if (e.key==='Enter' && newPack.trim()) {
                      savePacking([...packing, { text:newPack.trim(), checked:false }]);
                      setNewPack('');
                    }
                  }}
                  placeholder="Add item (Enter to save)"
                  style={{ ...inp, flex:1, fontSize:12 }} />
                <button onClick={() => {
                  if (!newPack.trim()) return;
                  savePacking([...packing, { text:newPack.trim(), checked:false }]);
                  setNewPack('');
                }} style={{ padding:'8px 12px', borderRadius:8, border:'none',
                  background:'var(--primary)', color:'#fff', fontSize:13,
                  cursor:'pointer', fontFamily:'inherit', flexShrink:0 }}>+</button>
              </div>
            </div>

            <button onClick={() => deleteTrip(selected.id)}
              style={{ width:'100%', padding:'12px', borderRadius:12,
                border:'1px solid rgba(239,68,68,0.2)', background:'rgba(239,68,68,0.05)',
                color:'#ef4444', fontSize:14, cursor:'pointer', fontFamily:'inherit' }}>
              🗑 Delete Trip
            </button>
          </div>
        )}
      </div>
    </>
  );
}
