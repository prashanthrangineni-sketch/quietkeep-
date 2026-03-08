'use client';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function DailyBriefPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [weather, setWeather] = useState(null);
  const [keeps, setKeeps] = useState([]);
  const [events, setEvents] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [monthSummary, setMonthSummary] = useState(null);
  const [renewals, setRenewals] = useState([]);
  const [moodToday, setMoodToday] = useState(null);
  const [expiringDocs, setExpiringDocs] = useState([]);
  const [upcomingTrips, setUpcomingTrips] = useState([]);

  useEffect(() => { init(); }, []);

  async function init() {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) { router.push('/login'); return; }
    setUser(user);
    await Promise.all([
      fetchWeather(),
      fetchKeeps(user.id),
      fetchEvents(user.id),
      fetchReminders(user.id),
      fetchFinance(user.id),
      fetchMoodToday(user.id),
      fetchExpiringDocs(user.id),
      fetchUpcomingTrips(user.id),
    ]);
    setLoading(false);
  }

  async function fetchWeather() {
    try {
      let lat = 17.3850, lon = 78.4867; // Hyderabad default
      if (navigator.geolocation) {
        await new Promise(res => navigator.geolocation.getCurrentPosition(
          p => { lat = p.coords.latitude; lon = p.coords.longitude; res(); },
          () => res(), { timeout: 3000 }
        ));
      }
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`);
      const d = await r.json();
      setWeather({ temp: Math.round(d.current_weather.temperature), wind: d.current_weather.windspeed, code: d.current_weather.weathercode });
    } catch {}
  }

  async function fetchKeeps(uid) {
    const { data } = await supabase
      .from('keeps')
      .select('id, content, color, is_pinned, reminder_at, intent_type')
      .eq('user_id', uid).eq('status', 'open').eq('show_on_brief', true)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(8);
    setKeeps(data || []);
  }

  async function fetchEvents(uid) {
    const todayStr = new Date().toISOString().split('T')[0];
    const in30Str = new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0];
    const { data } = await supabase
      .from('calendar_events')
      .select('id, event_name, event_date, event_type, is_annual, tithi, nakshatra, traditional_month, calendar_type')
      .or(`is_personal_event.eq.false,user_id.eq.${uid}`)
      .gte('event_date', todayStr).lte('event_date', in30Str)
      .order('event_date', { ascending: true }).limit(12);
    const today = new Date(todayStr);
    const expanded = (data || []).map(e => {
      if (e.is_annual) {
        const d = new Date(e.event_date);
        let next = new Date(today.getFullYear(), d.getMonth(), d.getDate());
        if (next < today) next = new Date(today.getFullYear() + 1, d.getMonth(), d.getDate());
        return { ...e, next_date: next.toISOString().split('T')[0] };
      }
      return { ...e, next_date: e.event_date };
    }).sort((a, b) => a.next_date.localeCompare(b.next_date));
    setEvents(expanded);
  }

  async function fetchReminders(uid) {
    const now = new Date().toISOString();
    const in24 = new Date(Date.now() + 24*60*60*1000).toISOString();
    const { data } = await supabase
      .from('reminders')
      .select('id, reminder_text, scheduled_for, recurrence')
      .eq('user_id', uid).eq('is_active', true)
      .gte('scheduled_for', now).lte('scheduled_for', in24)
      .order('scheduled_for', { ascending: true }).limit(5);
    setReminders(data || []);
  }

  async function fetchFinance(uid) {
    const monthYear = new Date().toISOString().slice(0, 7); // "2026-03"
    // get_monthly_summary RPC
    const { data: summary } = await supabase.rpc('get_monthly_summary', {
      p_user_id: uid,
      p_month_year: monthYear,
    });
    setMonthSummary(summary || null);
    // get_upcoming_renewals RPC — subscriptions due in 7 days
    const { data: upcoming } = await supabase.rpc('get_upcoming_renewals', {
      p_user_id: uid,
      p_days: 7,
    });
    setRenewals(upcoming || []);
  }

  async function fetchMoodToday(uid) {
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const { data } = await supabase
      .from('mood_logs')
      .select('mood, note, logged_at')
      .eq('user_id', uid)
      .gte('logged_at', todayStart.toISOString())
      .order('logged_at', { ascending: false })
      .limit(1).maybeSingle();
    setMoodToday(data || null);
  }

  async function fetchExpiringDocs(uid) {
    const in30 = new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];
    const { data } = await supabase
      .from('documents')
      .select('id, doc_name, expiry_date, doc_type')
      .eq('user_id', uid)
      .not('expiry_date', 'is', null)
      .gte('expiry_date', today).lte('expiry_date', in30)
      .order('expiry_date', { ascending: true }).limit(3);
    setExpiringDocs(data || []);
  }

  async function fetchUpcomingTrips(uid) {
    const today = new Date().toISOString().split('T')[0];
    const in30 = new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0];
    const { data } = await supabase
      .from('trip_plans')
      .select('id, destination, travel_date, status')
      .eq('user_id', uid)
      .in('status', ['planning', 'confirmed'])
      .gte('travel_date', today).lte('travel_date', in30)
      .order('travel_date', { ascending: true }).limit(3);
    setUpcomingTrips(data || []);
  }

  function weatherIcon(code) {
    if (code === 0) return '☀️';
    if (code <= 3) return '⛅';
    if (code <= 67) return '🌧️';
    return '⛈️';
  }

  function daysUntil(dateStr) {
    const today = new Date(); today.setHours(0,0,0,0);
    const d = new Date(dateStr); d.setHours(0,0,0,0);
    const diff = Math.round((d - today) / (1000*60*60*24));
    if (diff === 0) return 'Today 🎉';
    if (diff === 1) return 'Tomorrow';
    return `In ${diff} days`;
  }

  function greeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good Morning';
    if (h < 17) return 'Good Afternoon';
    return 'Good Evening';
  }

  const MOOD_META = { 5:{ emoji:'😄',label:'Great',color:'#4ade80'}, 4:{emoji:'🙂',label:'Good',color:'#86efac'}, 3:{emoji:'😐',label:'Okay',color:'#fbbf24'}, 2:{emoji:'😕',label:'Low',color:'#fb923c'}, 1:{emoji:'😞',label:'Bad',color:'#f87171'} };
  const TYPE_EMOJI = { birthday:'🎂', anniversary:'💍', festival:'🪔', national_holiday:'🏦', bank_holiday:'🏦', religious:'🙏', medical:'💊', work:'💼', personal:'⭐', other:'📌', panchangam:'🌙' };

  const S = {
    page: { minHeight:'100vh', background:'#0a0a0f', color:'#fff', fontFamily:"'DM Sans',-apple-system,sans-serif", paddingBottom:'80px' },
    section: { padding:'0 16px 4px' },
    card: { background:'#12121a', borderRadius:'16px', padding:'16px', marginBottom:'12px', border:'1px solid rgba(255,255,255,0.06)' },
    sectionTitle: { fontSize:'11px', fontWeight:700, color:'rgba(255,255,255,0.4)', letterSpacing:'0.08em', marginBottom:'10px', textTransform:'uppercase' },
  };

  if (loading) return (
    <div style={{ ...S.page, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ color:'rgba(255,255,255,0.4)' }}>Loading brief...</div>
    </div>
  );

  const todayEvents = events.filter(e => daysUntil(e.next_date).startsWith('Today'));
  const upcomingEvents = events.filter(e => !daysUntil(e.next_date).startsWith('Today'));
  const monthTotal = monthSummary?.total ? parseFloat(monthSummary.total) : 0;

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={{ padding:'20px 16px 12px', borderBottom:'1px solid rgba(255,255,255,0.06)', marginBottom:'12px' }}>
        <div style={{ fontSize:'12px', color:'#6366f1', fontWeight:600, marginBottom:'4px' }}>
          {new Date().toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}
        </div>
        <div style={{ fontSize:'22px', fontWeight:800 }}>
          {greeting()}{user?.email ? `, ${user.email.split('@')[0]}` : ''} 👋
        </div>
      </div>

      {/* Weather + Mood row */}
      <div style={{ ...S.section }}>
        <div style={{ display:'flex', gap:'10px', marginBottom:'12px' }}>
          {weather && (
            <div style={{ flex:1, background:'rgba(99,102,241,0.1)', border:'1px solid rgba(99,102,241,0.25)', borderRadius:'14px', padding:'14px', display:'flex', alignItems:'center', gap:'12px' }}>
              <span style={{ fontSize:'30px' }}>{weatherIcon(weather.code)}</span>
              <div>
                <div style={{ fontSize:'22px', fontWeight:800 }}>{weather.temp}°C</div>
                <div style={{ fontSize:'11px', color:'rgba(255,255,255,0.4)' }}>Wind {weather.wind} km/h</div>
              </div>
            </div>
          )}
          <Link href="/mood" style={{ flex:1, background: moodToday ? `${MOOD_META[moodToday.mood]?.color}18` : 'rgba(255,255,255,0.04)', border:`1px solid ${moodToday ? MOOD_META[moodToday.mood]?.color+'44' : 'rgba(255,255,255,0.08)'}`, borderRadius:'14px', padding:'14px', textDecoration:'none', display:'flex', flexDirection:'column', justifyContent:'center', alignItems:'center', gap:'4px' }}>
            {moodToday ? (
              <>
                <span style={{ fontSize:'28px' }}>{MOOD_META[moodToday.mood]?.emoji}</span>
                <span style={{ fontSize:'11px', color: MOOD_META[moodToday.mood]?.color, fontWeight:600 }}>Feeling {MOOD_META[moodToday.mood]?.label}</span>
              </>
            ) : (
              <>
                <span style={{ fontSize:'24px' }}>🌊</span>
                <span style={{ fontSize:'11px', color:'rgba(255,255,255,0.4)' }}>Log mood</span>
              </>
            )}
          </Link>
        </div>
      </div>

      {/* Today's events */}
      {todayEvents.length > 0 && (
        <div style={S.section}>
          <div style={{ ...S.card, border:'1px solid rgba(255,215,0,0.2)', background:'rgba(255,215,0,0.05)' }}>
            <div style={{ ...S.sectionTitle, color:'#FFD700' }}>🎉 Today</div>
            {todayEvents.map(e => (
              <div key={e.id} style={{ padding:'6px 0', borderBottom:'1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                  <span style={{ fontSize:'18px' }}>{TYPE_EMOJI[e.event_type] || '📌'}</span>
                  <span style={{ fontSize:'14px', fontWeight:600 }}>{e.event_name}</span>
                  <span style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)', marginLeft:'auto' }}>{e.calendar_type}</span>
                </div>
                {(e.tithi || e.nakshatra) && (
                  <div style={{ fontSize:'11px', color:'rgba(255,255,255,0.35)', marginTop:'2px', paddingLeft:'26px' }}>
                    {[e.traditional_month, e.tithi, e.nakshatra].filter(Boolean).join(' · ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reminders due today */}
      {reminders.length > 0 && (
        <div style={S.section}>
          <div style={{ ...S.card, border:'1px solid rgba(251,191,36,0.2)' }}>
            <div style={{ ...S.sectionTitle, color:'#fbbf24' }}>⏰ Due Today</div>
            {reminders.map(r => (
              <div key={r.id} style={{ display:'flex', justifyContent:'space-between', padding:'6px 0', borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
                <span style={{ fontSize:'13px', color:'rgba(255,255,255,0.8)', flex:1, marginRight:'8px' }}>{r.reminder_text}</span>
                <span style={{ fontSize:'11px', color:'#fbbf24', flexShrink:0 }}>
                  {new Date(r.scheduled_for).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Keeps */}
      {keeps.length > 0 && (
        <div style={S.section}>
          <div style={S.card}>
            <div style={S.sectionTitle}>📌 Your Keeps</div>
            {keeps.map(k => (
              <div key={k.id} style={{ padding:'9px 11px', background:'rgba(255,255,255,0.04)', borderRadius:'9px', marginBottom:'5px', borderLeft:`3px solid ${k.color || '#6366f1'}` }}>
                <div style={{ fontSize:'13px', color:'rgba(255,255,255,0.85)', lineHeight:'1.5' }}>{k.content}</div>
                {k.reminder_at && (
                  <div style={{ fontSize:'11px', color:'#fbbf24', marginTop:'3px' }}>
                    ⏰ {new Date(k.reminder_at).toLocaleString('en-IN', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Finance snapshot */}
      {(monthTotal > 0 || renewals.length > 0) && (
        <div style={S.section}>
          <div style={S.card}>
            <div style={S.sectionTitle}>💰 Finance</div>
            {monthTotal > 0 && (
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom: renewals.length > 0 ? '10px' : '0', paddingBottom: renewals.length > 0 ? '10px' : '0', borderBottom: renewals.length > 0 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
                <span style={{ fontSize:'13px', color:'rgba(255,255,255,0.55)' }}>Spent this month</span>
                <span style={{ fontSize:'16px', fontWeight:700, color:'#4ade80' }}>₹{monthTotal.toLocaleString('en-IN')}</span>
              </div>
            )}
            {renewals.map(r => (
              <div key={r.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'4px 0' }}>
                <div>
                  <span style={{ fontSize:'13px', color:'rgba(255,255,255,0.75)' }}>{r.service_name}</span>
                  <span style={{ fontSize:'10px', color:'#f87171', background:'rgba(248,113,113,0.1)', padding:'1px 6px', borderRadius:'6px', marginLeft:'6px' }}>Due {r.days_until === 0 ? 'today' : `in ${r.days_until}d`}</span>
                </div>
                <span style={{ fontSize:'13px', fontWeight:600, color:'#fb923c' }}>₹{Number(r.amount).toLocaleString('en-IN')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Expiring documents */}
      {expiringDocs.length > 0 && (
        <div style={S.section}>
          <div style={{ ...S.card, border:'1px solid rgba(248,113,113,0.2)' }}>
            <div style={{ ...S.sectionTitle, color:'#f87171' }}>⚠️ Documents Expiring</div>
            {expiringDocs.map(d => (
              <div key={d.id} style={{ display:'flex', justifyContent:'space-between', padding:'5px 0' }}>
                <span style={{ fontSize:'13px', color:'rgba(255,255,255,0.75)' }}>📄 {d.doc_name}</span>
                <span style={{ fontSize:'11px', color:'#f87171' }}>{daysUntil(d.expiry_date)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upcoming trips */}
      {upcomingTrips.length > 0 && (
        <div style={S.section}>
          <div style={S.card}>
            <div style={S.sectionTitle}>✈️ Upcoming Trips</div>
            {upcomingTrips.map(t => (
              <div key={t.id} style={{ display:'flex', justifyContent:'space-between', padding:'5px 0' }}>
                <span style={{ fontSize:'13px', color:'rgba(255,255,255,0.75)' }}>✈️ {t.destination}</span>
                <span style={{ fontSize:'11px', color:'#60a5fa' }}>{daysUntil(t.travel_date)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upcoming calendar events */}
      {upcomingEvents.length > 0 && (
        <div style={S.section}>
          <div style={S.card}>
            <div style={S.sectionTitle}>📅 Coming Up (30 days)</div>
            {upcomingEvents.map(e => (
              <div key={e.id} style={{ display:'flex', alignItems:'center', gap:'8px', padding:'6px 0', borderBottom:'1px solid rgba(255,255,255,0.04)' }}>
                <span style={{ fontSize:'16px', flexShrink:0 }}>{TYPE_EMOJI[e.event_type] || '📌'}</span>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:'13px', fontWeight:500, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{e.event_name}</div>
                  {(e.tithi || e.nakshatra) && <div style={{ fontSize:'10px', color:'rgba(255,255,255,0.3)' }}>{[e.tithi, e.nakshatra].filter(Boolean).join(' · ')}</div>}
                </div>
                <span style={{ fontSize:'11px', color:'#6366f1', fontWeight:600, flexShrink:0 }}>{daysUntil(e.next_date)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {keeps.length === 0 && events.length === 0 && reminders.length === 0 && (
        <div style={{ textAlign:'center', padding:'48px 16px', color:'rgba(255,255,255,0.3)' }}>
          <div style={{ fontSize:'36px', marginBottom:'10px' }}>🌅</div>
          <div style={{ fontSize:'14px' }}>Nothing on your brief yet.</div>
          <div style={{ fontSize:'12px', marginTop:'4px' }}>Add keeps from dashboard or set reminders.</div>
        </div>
      )}
    </div>
  );
  }
