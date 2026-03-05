'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import NavbarClient from '@/components/NavbarClient';

export default function DailyBrief() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reminders, setReminders] = useState([]);
  const [intents, setIntents] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [weather, setWeather] = useState(null);
  const [greeting, setGreeting] = useState('');

  useEffect(() => {
    const h = new Date().getHours();
    if (h < 12) setGreeting('Good morning');
    else if (h < 17) setGreeting('Good afternoon');
    else setGreeting('Good evening');

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.replace('/login'); return; }
      setUser(session.user);
      Promise.all([
        loadReminders(session.user.id),
        loadIntents(session.user.id),
        loadExpenses(session.user.id),
        loadBudgets(session.user.id),
        loadHolidays(),
        loadWeather(),
      ]).finally(() => setLoading(false));
    });
  }, [router]);

  async function loadReminders(uid) {
    const now = new Date();
    const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(23,59,59);
    const { data } = await supabase.from('intents').select('*')
      .eq('user_id', uid).eq('state', 'open').not('remind_at', 'is', null)
      .lte('remind_at', tomorrow.toISOString()).order('remind_at');
    if (data) setReminders(data);
  }

  async function loadIntents(uid) {
    const { data } = await supabase.from('intents').select('*')
      .eq('user_id', uid).eq('state', 'open').is('remind_at', null)
      .order('created_at', { ascending: false }).limit(5);
    if (data) setIntents(data);
  }

  async function loadExpenses(uid) {
    const now = new Date();
    const startOfMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
    const { data } = await supabase.from('expenses').select('*')
      .eq('user_id', uid).gte('expense_date', startOfMonth).order('created_at', { ascending: false });
    if (data) setExpenses(data);
  }

  async function loadBudgets(uid) {
    const now = new Date();
    const monthYear = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    const { data } = await supabase.from('budgets').select('*').eq('user_id', uid).eq('month_year', monthYear);
    if (data) setBudgets(data);
  }

  async function loadHolidays() {
    const today = new Date();
    const in7 = new Date(today); in7.setDate(in7.getDate() + 7);
    const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const { data } = await supabase.from('calendar_events').select('*')
      .gte('event_date', fmt(today)).lte('event_date', fmt(in7)).order('event_date');
    if (data) setHolidays(data);
  }

  async function loadWeather() {
    try {
      const res = await fetch('https://api.open-meteo.com/v1/forecast?latitude=17.385&longitude=78.4867&current_weather=true&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=Asia/Kolkata&forecast_days=1');
      const data = await res.json();
      if (data?.current_weather) {
        const code = data.current_weather.weathercode;
        const emoji = code <= 1 ? '☀️' : code <= 3 ? '⛅' : code <= 67 ? '🌧️' : code <= 77 ? '❄️' : '⛈️';
        const desc = code <= 1 ? 'Clear' : code <= 3 ? 'Partly cloudy' : code <= 45 ? 'Foggy' : code <= 67 ? 'Rainy' : 'Stormy';
        setWeather({
          temp: Math.round(data.current_weather.temperature),
          emoji,
          desc,
          max: Math.round(data.daily.temperature_2m_max[0]),
          min: Math.round(data.daily.temperature_2m_min[0]),
        });
      }
    } catch (e) { /* weather optional */ }
  }

  const totalSpent = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const todayReminders = reminders.filter(r => r.remind_at?.startsWith(todayStr));
  const tomorrowReminders = reminders.filter(r => !r.remind_at?.startsWith(todayStr));

  const WDAY = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  if (loading) return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '16px' }}>
      <div style={{ width: '36px', height: '36px', border: '3px solid #6366f1', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <span style={{ color: '#475569', fontSize: '14px' }}>Building your brief...</span>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  return (
    <>
      <NavbarClient />
    <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', color: '#f1f5f9' }}>
      {/* Nav */}
      <div style={{ borderBottom: '1px solid #1e1e2e', padding: '10px 16px', backgroundColor: 'rgba(10,10,15,0.98)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <span style={{ fontWeight: '700', fontSize: '14px', color: '#6366f1' }}>🌅 Daily Brief</span>
        <div style={{ display: 'flex', gap: '6px' }}>
          <a href="/dashboard" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: '11px', padding: '5px 10px', border: '1px solid #1e293b', borderRadius: '6px' }}>📋 Keeps</a>
          <a href="/calendar" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: '11px', padding: '5px 10px', border: '1px solid #1e293b', borderRadius: '6px' }}>📅 Calendar</a>
          <a href="/finance" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: '11px', padding: '5px 10px', border: '1px solid #1e293b', borderRadius: '6px' }}>💰 Finance</a>
        </div>
      </div>

      <div style={{ maxWidth: '680px', margin: '0 auto', padding: '20px 16px' }}>

        {/* Greeting + Date + Weather */}
        <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e1e2e', borderRadius: '16px', padding: '20px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '22px', fontWeight: '800', color: '#f1f5f9', marginBottom: '4px' }}>{greeting} 👋</div>
              <div style={{ fontSize: '13px', color: '#475569' }}>{WDAY[today.getDay()]}, {today.getDate()} {MONTH_SHORT[today.getMonth()]} {today.getFullYear()}</div>
            </div>
            {weather && (
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '32px' }}>{weather.emoji}</div>
                <div style={{ fontSize: '20px', fontWeight: '800', color: '#f1f5f9' }}>{weather.temp}°C</div>
                <div style={{ fontSize: '11px', color: '#475569' }}>{weather.desc} · {weather.min}°-{weather.max}°</div>
                <div style={{ fontSize: '10px', color: '#334155' }}>Hyderabad</div>
              </div>
            )}
          </div>
        </div>

        {/* Upcoming holidays */}
        {holidays.length > 0 && (
          <div style={{ backgroundColor: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.2)', borderRadius: '14px', padding: '14px', marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', color: '#a855f7', fontWeight: '700', textTransform: 'uppercase', marginBottom: '10px' }}>🎉 Coming up this week</div>
            {holidays.map((h, i) => {
              const d = new Date(h.event_date);
              const daysAway = Math.ceil((d - today) / (1000*60*60*24));
              return (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: i < holidays.length - 1 ? '1px solid rgba(168,85,247,0.1)' : 'none' }}>
                  <span style={{ fontSize: '13px', color: '#e2e8f0' }}>{h.event_name}</span>
                  <span style={{ fontSize: '11px', color: daysAway === 0 ? '#22c55e' : '#a855f7', fontWeight: '600' }}>{daysAway === 0 ? 'Today!' : daysAway === 1 ? 'Tomorrow' : `${daysAway}d`}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Today's reminders */}
        <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e1e2e', borderRadius: '14px', padding: '16px', marginBottom: '16px' }}>
          <div style={{ fontSize: '11px', color: '#6366f1', fontWeight: '700', textTransform: 'uppercase', marginBottom: '12px' }}>⏰ Today's reminders ({todayReminders.length})</div>
          {todayReminders.length === 0
            ? <div style={{ color: '#334155', fontSize: '13px' }}>No reminders for today. Enjoy!</div>
            : todayReminders.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '8px 0', borderBottom: i < todayReminders.length - 1 ? '1px solid #1a1a2e' : 'none' }}>
                <span style={{ fontSize: '16px' }}>{r.intent_type === 'task' ? '✅' : r.intent_type === 'contact' ? '📞' : '⏰'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '13px', color: '#e2e8f0' }}>{r.content}</div>
                  <div style={{ fontSize: '11px', color: '#475569', marginTop: '2px' }}>
                    {new Date(r.remind_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            ))}
        </div>

        {/* Tomorrow's reminders */}
        {tomorrowReminders.length > 0 && (
          <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e1e2e', borderRadius: '14px', padding: '16px', marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', color: '#f59e0b', fontWeight: '700', textTransform: 'uppercase', marginBottom: '12px' }}>📅 Coming up ({tomorrowReminders.length})</div>
            {tomorrowReminders.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '8px 0', borderBottom: i < tomorrowReminders.length - 1 ? '1px solid #1a1a2e' : 'none' }}>
                <span style={{ fontSize: '14px' }}>📌</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '13px', color: '#e2e8f0' }}>{r.content}</div>
                  <div style={{ fontSize: '11px', color: '#475569', marginTop: '2px' }}>
                    {new Date(r.remind_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · {new Date(r.remind_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Open keeps */}
        {intents.length > 0 && (
          <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e1e2e', borderRadius: '14px', padding: '16px', marginBottom: '16px' }}>
            <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '700', textTransform: 'uppercase', marginBottom: '12px' }}>📋 Open keeps ({intents.length})</div>
            {intents.map((r, i) => (
              <div key={i} style={{ fontSize: '13px', color: '#64748b', padding: '6px 0', borderBottom: i < intents.length - 1 ? '1px solid #1a1a2e' : 'none' }}>
                📝 {r.content.substring(0, 60)}{r.content.length > 60 ? '...' : ''}
              </div>
            ))}
          </div>
        )}

        {/* Finance snapshot */}
        <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e1e2e', borderRadius: '14px', padding: '16px', marginBottom: '16px' }}>
          <div style={{ fontSize: '11px', color: '#22c55e', fontWeight: '700', textTransform: 'uppercase', marginBottom: '12px' }}>💰 This month's spending</div>
          {expenses.length === 0
            ? <div style={{ color: '#334155', fontSize: '13px' }}>No expenses logged yet.</div>
            : (
              <>
                <div style={{ fontSize: '28px', fontWeight: '800', color: '#22c55e', marginBottom: '8px' }}>₹{totalSpent.toLocaleString('en-IN')}</div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {Object.entries(expenses.reduce((acc, e) => { acc[e.category] = (acc[e.category] || 0) + Number(e.amount); return acc; }, {})).map(([cat, amt]) => (
                    <span key={cat} style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '6px', backgroundColor: '#1a1a2e', color: '#64748b' }}>{cat}: ₹{amt.toLocaleString('en-IN')}</span>
                  ))}
                </div>
              </>
            )}
        </div>

        {/* Quick actions */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
          <a href="/dashboard" style={{ display: 'block', backgroundColor: '#0f0f1a', border: '1px solid #1e1e2e', borderRadius: '12px', padding: '14px', textDecoration: 'none', textAlign: 'center' }}>
            <div style={{ fontSize: '24px', marginBottom: '4px' }}>📋</div>
            <div style={{ fontSize: '12px', color: '#94a3b8', fontWeight: '600' }}>Add a Keep</div>
          </a>
          <a href="/driving" style={{ display: 'block', backgroundColor: '#0f0f1a', border: '1px solid #1e1e2e', borderRadius: '12px', padding: '14px', textDecoration: 'none', textAlign: 'center' }}>
            <div style={{ fontSize: '24px', marginBottom: '4px' }}>🚗</div>
            <div style={{ fontSize: '12px', color: '#94a3b8', fontWeight: '600' }}>Driving Mode</div>
          </a>
        </div>
      </div>
    </div>
    </>
  );
}
