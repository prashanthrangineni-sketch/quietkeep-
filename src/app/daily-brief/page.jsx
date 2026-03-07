'use client';
import { useState, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export default function DailyBriefPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [weather, setWeather] = useState(null);
  const [keeps, setKeeps] = useState([]);
  const [events, setEvents] = useState([]);

  useEffect(() => { init(); }, []);

  async function init() {
    const supabase = getSupabase();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) { router.push('/login'); return; }
    setUser(user);
    await Promise.all([fetchWeather(), fetchKeeps(user.id), fetchEvents(user.id)]);
    setLoading(false);
  }

  async function fetchWeather() {
    try {
      let lat = 16.5062, lon = 80.6480;
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
    const supabase = getSupabase();
    const { data } = await supabase
      .from('keeps')
      .select('id, content, color, is_pinned, reminder_at')
      .eq('user_id', uid)
      .eq('status', 'open')
      .eq('show_on_brief', true)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(10);
    setKeeps(data || []);
  }

  async function fetchEvents(uid) {
    const supabase = getSupabase();
    const todayStr = new Date().toISOString().split('T')[0];
    const in60Str = new Date(Date.now() + 60*24*60*60*1000).toISOString().split('T')[0];
    const { data } = await supabase
      .from('calendar_events')
      .select('id, event_name, event_date, event_type, is_annual, tithi, nakshatra, traditional_month')
      .or(`is_personal_event.eq.false,user_id.eq.${uid}`)
      .gte('event_date', todayStr)
      .lte('event_date', in60Str)
      .order('event_date', { ascending: true })
      .limit(15);
    const todayDate = new Date(todayStr);
    const expanded = (data || []).map(e => {
      if (e.is_annual) {
        const d = new Date(e.event_date);
        let next = new Date(todayDate.getFullYear(), d.getMonth(), d.getDate());
        if (next < todayDate) next = new Date(todayDate.getFullYear() + 1, d.getMonth(), d.getDate());
        return { ...e, next_date: next.toISOString().split('T')[0] };
      }
      return { ...e, next_date: e.event_date };
    }).sort((a, b) => a.next_date.localeCompare(b.next_date));
    setEvents(expanded);
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
    if (diff === 0) return 'Today! 🎉';
    if (diff === 1) return 'Tomorrow';
    return `In ${diff} days`;
  }

  function greeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good Morning';
    if (h < 17) return 'Good Afternoon';
    return 'Good Evening';
  }

  const TYPE_EMOJI = { birthday:'🎂', anniversary:'💍', festival:'🪔', holiday:'🏦', religious:'🙏', medical:'💊', work:'💼', personal:'⭐', public_holiday:'🏦' };

  const S = {
    page: { minHeight:'100vh', background:'#0a0a0f', color:'#fff', fontFamily:'system-ui,sans-serif', paddingBottom:'80px' },
    header: { padding:'20px 16px 12px', borderBottom:'1px solid #1e1e2e' },
    section: { padding:'12px 16px' },
    card: { background:'#12121a', borderRadius:'16px', padding:'16px', marginBottom:'12px' },
    sectionTitle: { fontSize:'12px', fontWeight:700, color:'#888', letterSpacing:'0.06em', marginBottom:'10px', textTransform:'uppercase' },
    keepItem: (color) => ({ padding:'10px 12px', background:'#1a1a2e', borderRadius:'10px', marginBottom:'6px', borderLeft:`3px solid ${color || '#6366f1'}` }),
    eventRow: { display:'flex', alignItems:'flex-start', gap:'8px', padding:'8px 0', borderBottom:'1px solid #1a1a2a' },
  };

  if (loading) return (
    <div style={{ ...S.page, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ color:'#888' }}>Loading brief...</div>
    </div>
  );

  const todayEvents = events.filter(e => daysUntil(e.next_date) === 'Today! 🎉');
  const upcomingEvents = events.filter(e => daysUntil(e.next_date) !== 'Today! 🎉');

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div style={{ fontSize:'13px', color:'#6366f1', fontWeight:600, marginBottom:'2px' }}>
          {new Date().toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}
        </div>
        <div style={{ fontSize:'22px', fontWeight:800 }}>
          {greeting()}{user?.email ? `, ${user.email.split('@')[0]}` : ''} 👋
        </div>
      </div>

      {weather && (
        <div style={S.section}>
          <div style={{ ...S.card, display:'flex', alignItems:'center', gap:'16px', padding:'14px 16px' }}>
            <div style={{ fontSize:'36px' }}>{weatherIcon(weather.code)}</div>
            <div>
              <div style={{ fontSize:'24px', fontWeight:800 }}>{weather.temp}°C</div>
              <div style={{ fontSize:'12px', color:'#888' }}>Wind {weather.wind} km/h</div>
            </div>
          </div>
        </div>
      )}

      {todayEvents.length > 0 && (
        <div style={S.section}>
          <div style={{ ...S.card, border:'1px solid #3d2a00' }}>
            <div style={{ ...S.sectionTitle, color:'#FFD700' }}>🎉 Today</div>
            {todayEvents.map(e => (
              <div key={e.id} style={{ padding:'6px 0' }}>
                <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                  <span style={{ fontSize:'20px' }}>{TYPE_EMOJI[e.event_type] || '📌'}</span>
                  <div style={{ fontSize:'14px', fontWeight:700 }}>{e.event_name}</div>
                </div>
                {(e.tithi || e.nakshatra || e.traditional_month) && (
                  <div style={{ fontSize:'11px', color:'#888', marginTop:'2px', paddingLeft:'28px' }}>
                    {[e.traditional_month, e.tithi, e.nakshatra].filter(Boolean).join(' · ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {keeps.length > 0 && (
        <div style={S.section}>
          <div style={S.card}>
            <div style={S.sectionTitle}>📌 Your Keeps</div>
            {keeps.map(k => (
              <div key={k.id} style={S.keepItem(k.color)}>
                <div style={{ fontSize:'13px', color:'#eee', lineHeight:'1.5' }}>{k.content}</div>
                {k.reminder_at && (
                  <div style={{ fontSize:'11px', color:'#FFD700', marginTop:'3px' }}>
                    ⏰ {new Date(k.reminder_at).toLocaleString('en-IN')}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {upcomingEvents.length > 0 && (
        <div style={S.section}>
          <div style={S.card}>
            <div style={S.sectionTitle}>📅 Coming Up</div>
            {upcomingEvents.map(e => (
              <div key={e.id} style={S.eventRow}>
                <span style={{ fontSize:'18px', flexShrink:0 }}>{TYPE_EMOJI[e.event_type] || '📌'}</span>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:'13px', fontWeight:600 }}>{e.event_name}</div>
                  <div style={{ fontSize:'11px', color:'#888' }}>
                    {e.next_date}{e.is_annual ? ' · 🔁' : ''}
                    {(e.tithi || e.nakshatra) ? ` · ${[e.tithi, e.nakshatra].filter(Boolean).join(', ')}` : ''}
                  </div>
                </div>
                <div style={{ fontSize:'11px', color:'#6366f1', fontWeight:600, flexShrink:0, marginLeft:'8px' }}>
                  {daysUntil(e.next_date)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {keeps.length === 0 && events.length === 0 && (
        <div style={{ textAlign:'center', padding:'40px 16px', color:'#555' }}>
          <div style={{ fontSize:'32px', marginBottom:'8px' }}>🌅</div>
          <div style={{ fontSize:'14px' }}>Nothing on your brief yet.</div>
          <div style={{ fontSize:'12px', marginTop:'4px' }}>Add keeps from dashboard or events from calendar.</div>
        </div>
      )}

      <div style={{ position:'fixed', bottom:0, left:0, right:0, background:'#0a0a0f', borderTop:'1px solid #1e1e2e', padding:'10px 16px', display:'flex', justifyContent:'space-around' }}>
        {[
          { href:'/dashboard', emoji:'🏠', label:'Home' },
          { href:'/calendar', emoji:'📅', label:'Calendar' },
          { href:'/documents', emoji:'📄', label:'Docs' },
          { href:'/settings', emoji:'⚙️', label:'Settings' },
        ].map(n => (
          <Link key={n.href} href={n.href} style={{ color:'#888', textDecoration:'none', textAlign:'center', fontSize:'10px', display:'flex', flexDirection:'column', alignItems:'center', gap:'2px' }}>
            <span style={{ fontSize:'20px' }}>{n.emoji}</span>{n.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
