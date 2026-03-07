'use client';
import { useState, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

const CAT_EMOJI = { birthday:'🎂', anniversary:'💍', festival:'🪔', holiday:'🏦', religious:'🙏', medical:'💊', work:'💼', personal:'⭐' };
const CAT_COLOR = { birthday:'#FF6B6B', anniversary:'#FF69B4', festival:'#FFD700', holiday:'#4ECDC4', religious:'#9B59B6', medical:'#E74C3C', work:'#3498DB', personal:'#2ECC71' };

const WEATHER_ICONS = { Clear:'☀️', Clouds:'☁️', Rain:'🌧️', Drizzle:'🌦️', Thunderstorm:'⛈️', Snow:'❄️', Mist:'🌫️', Fog:'🌫️', Haze:'🌫️' };

function getDayGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
}

function getDaysUntil(dateStr) {
  const today = new Date(); today.setHours(0,0,0,0);
  const target = new Date(dateStr); target.setHours(0,0,0,0);
  // For annual events, find the next occurrence
  const diff = Math.round((target - today) / (1000*60*60*24));
  if (diff === 0) return 'Today! 🎉';
  if (diff === 1) return 'Tomorrow';
  if (diff < 0) {
    // Already passed this year — find next year
    target.setFullYear(today.getFullYear() + 1);
    const diffNext = Math.round((target - today) / (1000*60*60*24));
    return `In ${diffNext} days`;
  }
  return `In ${diff} days`;
}

export default function DailyBriefPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [briefSettings, setBriefSettings] = useState(null);
  const [keeps, setKeeps] = useState([]);
  const [todayEvents, setTodayEvents] = useState([]);
  const [upcomingEvents, setUpcomingEvents] = useState([]);
  const [weather, setWeather] = useState(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [location, setLocation] = useState(null);

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const todayMMDD = todayStr.slice(5);

  useEffect(() => { init(); }, []);

  async function init() {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { router.push('/login'); return; }
    setUser(user);

    await Promise.all([
      fetchBriefSettings(user.id, supabase),
      fetchKeeps(user.id, supabase),
      fetchEvents(user.id, supabase),
    ]);

    // Get weather via geolocation
    if (navigator.geolocation) {
      setWeatherLoading(true);
      navigator.geolocation.getCurrentPosition(
        pos => {
          setLocation({ lat: pos.coords.latitude, lon: pos.coords.longitude });
          fetchWeather(pos.coords.latitude, pos.coords.longitude);
        },
        () => {
          // fallback to Hyderabad / Vijayawada
          fetchWeather(16.5062, 80.6480);
        }
      );
    } else {
      fetchWeather(16.5062, 80.6480);
    }

    setLoading(false);
  }

  async function fetchBriefSettings(uid, supabase) {
    const { data } = await supabase
      .from('brief_settings')
      .select('*')
      .eq('user_id', uid)
      .single();
    setBriefSettings(data || { show_weather: true, show_reminders: true, show_finance: true });
  }

  async function fetchKeeps(uid, supabase) {
    const { data } = await supabase
      .from('keeps')
      .select('id, content, color, is_pinned, reminder_at, created_at')
      .eq('user_id', uid)
      .eq('status', 'open')
      .eq('show_on_brief', true)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(10);
    setKeeps(data || []);
  }

  async function fetchEvents(uid, supabase) {
    const in60 = new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000);
    const in60Str = in60.toISOString().split('T')[0];

    const { data } = await supabase
      .from('calendar_events')
      .select('id, event_name, event_date, category, is_annual, description, reminder_time')
      .or(`is_personal_event.eq.false,user_id.eq.${uid}`)
      .order('event_date', { ascending: true });

    const events = data || [];

    // Separate today's events vs upcoming (next 60 days)
    const todays = events.filter(e => {
      if (e.event_date === todayStr) return true;
      if (e.is_annual && e.event_date?.slice(5) === todayMMDD) return true;
      return false;
    });

    const upcoming = events.filter(e => {
      if (e.event_date === todayStr) return false;
      if (e.is_annual && e.event_date?.slice(5) === todayMMDD) return false;
      // For annual events check upcoming by MM-DD
      if (e.is_annual) {
        const eventMMDD = e.event_date?.slice(5);
        const thisYearDate = `${today.getFullYear()}-${eventMMDD}`;
        return thisYearDate > todayStr && thisYearDate <= in60Str;
      }
      return e.event_date > todayStr && e.event_date <= in60Str;
    }).slice(0, 8);

    setTodayEvents(todays);
    setUpcomingEvents(upcoming);
  }

  async function fetchWeather(lat, lon) {
    // Uses Open-Meteo — free, no key needed
    try {
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto`
      );
      const data = await res.json();
      const current = data.current;
      const code = current.weather_code;
      // Map WMO code to description
      let desc = 'Clear', icon = '☀️';
      if (code === 0) { desc = 'Clear Sky'; icon = '☀️'; }
      else if (code <= 3) { desc = 'Partly Cloudy'; icon = '⛅'; }
      else if (code <= 49) { desc = 'Foggy'; icon = '🌫️'; }
      else if (code <= 67) { desc = 'Rain'; icon = '🌧️'; }
      else if (code <= 77) { desc = 'Snow'; icon = '❄️'; }
      else if (code <= 82) { desc = 'Showers'; icon = '🌦️'; }
      else if (code <= 99) { desc = 'Thunderstorm'; icon = '⛈️'; }

      setWeather({
        temp: Math.round(current.temperature_2m),
        humidity: current.relative_humidity_2m,
        wind: Math.round(current.wind_speed_10m),
        desc, icon,
      });
    } catch (e) {
      setWeather(null);
    }
    setWeatherLoading(false);
  }

  const S = {
    page: { minHeight:'100vh', background:'#0a0a0f', color:'#fff', fontFamily:'system-ui,sans-serif', paddingBottom:'80px' },
    header: { padding:'16px 16px 0', borderBottom:'1px solid #1e1e2e', paddingBottom:'16px' },
    section: { padding:'12px 16px' },
    card: { background:'#12121a', borderRadius:'16px', padding:'16px', marginBottom:'10px' },
    sectionTitle: { fontSize:'12px', fontWeight:700, color:'#888', letterSpacing:'0.06em', textTransform:'uppercase', marginBottom:'10px' },
    tag: (color) => ({ display:'inline-block', padding:'2px 8px', borderRadius:'20px', fontSize:'11px', background: color || '#333', color:'#fff', fontWeight:600 }),
  };

  if (loading) return (
    <div style={{ ...S.page, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ color:'#888', fontSize:'14px' }}>Loading your brief...</div>
    </div>
  );

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
          <div>
            <div style={{ fontSize:'24px', fontWeight:800 }}>🌅 {getDayGreeting()}</div>
            <div style={{ fontSize:'13px', color:'#888', marginTop:'4px' }}>
              {today.toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}
            </div>
          </div>
          <button onClick={() => router.back()} style={{ background:'#1e1e2e', border:'none', color:'#aaa', padding:'8px 14px', borderRadius:'10px', cursor:'pointer', fontSize:'13px' }}>← Back</button>
        </div>
      </div>

      {/* Weather */}
      {(briefSettings?.show_weather !== false) && (
        <div style={S.section}>
          <div style={{ ...S.card, background: 'linear-gradient(135deg, #1a1a3e, #12121a)' }}>
            <div style={S.sectionTitle}>🌤️ Weather</div>
            {weatherLoading ? (
              <div style={{ color:'#666', fontSize:'13px' }}>Getting weather...</div>
            ) : weather ? (
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                <div>
                  <div style={{ fontSize:'48px', lineHeight:1 }}>{weather.icon}</div>
                  <div style={{ fontSize:'13px', color:'#aaa', marginTop:'4px' }}>{weather.desc}</div>
                </div>
                <div style={{ textAlign:'right' }}>
                  <div style={{ fontSize:'42px', fontWeight:300 }}>{weather.temp}°C</div>
                  <div style={{ fontSize:'12px', color:'#888' }}>
                    💧 {weather.humidity}% · 💨 {weather.wind} km/h
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ color:'#666', fontSize:'13px' }}>Weather unavailable</div>
            )}
          </div>
        </div>
      )}

      {/* Today's Events */}
      {todayEvents.length > 0 && (
        <div style={S.section}>
          <div style={S.card}>
            <div style={S.sectionTitle}>🎉 Today</div>
            {todayEvents.map(e => (
              <div key={e.id} style={{ display:'flex', alignItems:'center', gap:'10px', padding:'8px 0', borderBottom:'1px solid #1e1e2e' }}>
                <div style={{ width:'36px', height:'36px', borderRadius:'10px', background: CAT_COLOR[e.category] || '#333', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'18px', flexShrink:0 }}>
                  {CAT_EMOJI[e.category] || '📌'}
                </div>
                <div>
                  <div style={{ fontWeight:700, fontSize:'15px' }}>{e.event_name}</div>
                  {e.description && <div style={{ fontSize:'12px', color:'#888' }}>{e.description}</div>}
                  {e.reminder_time && <div style={{ fontSize:'12px', color:'#FFD700' }}>⏰ {e.reminder_time}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upcoming Events */}
      {upcomingEvents.length > 0 && (
        <div style={S.section}>
          <div style={S.card}>
            <div style={S.sectionTitle}>📅 Coming Up (Next 60 Days)</div>
            {upcomingEvents.map(e => {
              const dateToUse = e.is_annual
                ? `${today.getFullYear()}-${e.event_date?.slice(5)}`
                : e.event_date;
              return (
                <div key={e.id} style={{ display:'flex', alignItems:'center', gap:'10px', padding:'8px 0', borderBottom:'1px solid #1e1e2e' }}>
                  <div style={{ width:'36px', height:'36px', borderRadius:'10px', background: CAT_COLOR[e.category] || '#333', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'18px', flexShrink:0 }}>
                    {CAT_EMOJI[e.category] || '📌'}
                  </div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:600, fontSize:'14px' }}>{e.event_name}</div>
                    <div style={{ fontSize:'12px', color:'#888' }}>
                      {e.event_date?.slice(5).split('-').reverse().join('/')}
                      {e.is_annual ? ' · 🔁' : ''}
                    </div>
                  </div>
                  <div style={{ fontSize:'12px', color:'#818cf8', fontWeight:600, textAlign:'right', flexShrink:0 }}>
                    {getDaysUntil(dateToUse)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Keeps from dashboard */}
      {keeps.length > 0 && (
        <div style={S.section}>
          <div style={S.card}>
            <div style={S.sectionTitle}>📌 Your Keeps</div>
            {keeps.map(k => (
              <div key={k.id} style={{ padding:'8px', background:'#1a1a2e', borderRadius:'8px', marginBottom:'6px', borderLeft:`3px solid ${k.color || '#6366f1'}` }}>
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

      {/* Empty state if nothing to show */}
      {keeps.length === 0 && upcomingEvents.length === 0 && todayEvents.length === 0 && (
        <div style={{ ...S.section, textAlign:'center', paddingTop:'40px' }}>
          <div style={{ fontSize:'40px' }}>🌟</div>
          <div style={{ color:'#888', marginTop:'12px', fontSize:'14px' }}>
            Your brief is empty. Add keeps from the dashboard and events from the calendar.
          </div>
        </div>
      )}
    </div>
  );
      }
