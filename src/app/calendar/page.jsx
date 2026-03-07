'use client';
import { useEffect, useState, useCallback } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import NavbarClient from '@/components/NavbarClient';

const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const CALENDAR_TYPES = [
  { id: 'gregorian',  label: 'Gregorian',         emoji: '📅', dbType: 'gregorian' },
  { id: 'telugu',     label: 'Telugu Panchangam',  emoji: '🪔', dbType: 'telugu' },
  { id: 'hindi',      label: 'Hindi Vikram Samvat',emoji: '🌙', dbType: 'hindi' },
  { id: 'islamic',    label: 'Islamic Hijri',      emoji: '☪️',  dbType: null },  // no data yet
  { id: 'christian',  label: 'Christian',          emoji: '✝️',  dbType: null },  // no data yet
  { id: 'tamil',      label: 'Tamil',              emoji: '🎭', dbType: 'tamil' },
];

const DAYS = ['Su','Mo','Tu','We','Th','Fr','Sa'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function toISO(y, m, d) { return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }

export default function CalendarPage() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedCal, setSelectedCal] = useState('gregorian');
  const [view, setView] = useState('month');
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth());
  const [selectedDate, setSelectedDate] = useState(null);
  const [monthEvents, setMonthEvents] = useState([]);
  const [dayEvents, setDayEvents] = useState([]);
  const [myEvents, setMyEvents] = useState([]);
  const [loadingDay, setLoadingDay] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  const today = new Date();
  const todayISO = toISO(today.getFullYear(), today.getMonth(), today.getDate());

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { window.location.href = '/login'; return; }
      setUser(user);
      setLoading(false);
    });
  }, []);

  // Load dot indicators for the whole month
  useEffect(() => {
    if (!user) return;
    loadMonthEvents();
  }, [user, year, month, selectedCal]);

  async function loadMonthEvents() {
    const start = toISO(year, month, 1);
    const lastDay = new Date(year, month + 1, 0).getDate();
    const end = toISO(year, month, lastDay);

    const calType = CALENDAR_TYPES.find(c => c.id === selectedCal);

    let q = supabase.from('calendar_events').select('event_date, event_type, calendar_type').gte('event_date', start).lte('event_date', end);

    // KEY FIX: filter to selected calendar type only
    if (calType?.dbType) {
      q = q.eq('calendar_type', calType.dbType);
    } else {
      // No data for this calendar type yet — return empty
      setMonthEvents([]);
      return;
    }

    const { data } = await q;
    setMonthEvents(data || []);

    // Also load my personal events for the month
    const { data: personal } = await supabase.from('calendar_events')
      .select('event_date, event_name, event_type')
      .eq('user_id', user.id)
      .eq('is_personal_event', true)
      .gte('event_date', start)
      .lte('event_date', end);
    setMyEvents(personal || []);
  }

  // Load events for a specific clicked date
  async function loadDayEvents(dateISO) {
    setLoadingDay(true);
    setDayEvents([]);

    const calType = CALENDAR_TYPES.find(c => c.id === selectedCal);

    let panchangamEvents = [];
    if (calType?.dbType) {
      const { data } = await supabase.from('calendar_events')
        .select('*')
        .eq('event_date', dateISO)
        .eq('calendar_type', calType.dbType)  // ← KEY FIX: only selected calendar
        .order('event_type', { ascending: true });
      panchangamEvents = data || [];
    }

    // Always also load personal events for this date
    const { data: personal } = await supabase.from('calendar_events')
      .select('*')
      .eq('event_date', dateISO)
      .eq('user_id', user.id)
      .eq('is_personal_event', true);

    setDayEvents([...panchangamEvents, ...(personal || [])]);
    setLoadingDay(false);
  }

  function handleDayClick(dateISO) {
    setSelectedDate(dateISO);
    loadDayEvents(dateISO);
  }

  function prevMonth() { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); }
  function nextMonth() { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); }

  function getDayDots(dateISO) {
    const hasHoliday = monthEvents.some(e => e.event_date === dateISO);
    const hasPersonal = myEvents.some(e => e.event_date === dateISO);
    return { hasHoliday, hasPersonal };
  }

  function buildCalendarGrid() {
    const firstDay = new Date(year, month, 1).getDay();
    const lastDay = new Date(year, month + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= lastDay; d++) cells.push(d);
    return cells;
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: '#6366f1' }}>Loading…</div>
    </div>
  );

  const cells = buildCalendarGrid();
  const selCal = CALENDAR_TYPES.find(c => c.id === selectedCal);
  const hasData = !!selCal?.dbType;

  return (
    <div style={{ minHeight: '100vh', background: '#0f0f0f', color: '#fff' }}>
      <NavbarClient />
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '1rem 0.75rem 4rem' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '1.2rem' }}>📅</span>
            <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>Calendar</span>
          </div>
          <a href="/dashboard" style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 8, color: '#aaa', padding: '0.4rem 0.75rem', textDecoration: 'none', fontSize: '0.82rem' }}>← Back</a>
        </div>
        {/* Calendar type pills */}
        <div style={{ display: 'flex', gap: '0.4rem', overflowX: 'auto', paddingBottom: '0.5rem', marginBottom: '0.75rem', scrollbarWidth: 'none' }}>
          {CALENDAR_TYPES.map(c => (
            <button key={c.id} onClick={() => { setSelectedCal(c.id); setSelectedDate(null); setDayEvents([]); }}
              style={{ flexShrink: 0, padding: '0.3rem 0.75rem', borderRadius: 20, border: 'none', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', background: selectedCal === c.id ? '#6366f1' : '#1a1a1a', color: selectedCal === c.id ? '#fff' : '#666', whiteSpace: 'nowrap' }}>
              {c.emoji} {c.label}
            </button>
          ))}
        </div>

        {/* View tabs */}
        <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.75rem' }}>
          {[['month','📆 Month'],['events','📋 My Events'],['holidays','🎉 Holidays']].map(([v, label]) => (
            <button key={v} onClick={() => setView(v)}
              style={{ padding: '0.3rem 0.75rem', borderRadius: 8, border: 'none', background: view === v ? '#6366f1' : '#1a1a1a', color: view === v ? '#fff' : '#666', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer' }}>
              {label}
            </button>
          ))}
        </div>

        {/* No data notice */}
        {!hasData && (
          <div style={{ background: '#1a1a1a', border: '1px solid #f59e0b44', borderRadius: 10, padding: '0.75rem 1rem', marginBottom: '0.75rem', color: '#f59e0b', fontSize: '0.82rem' }}>
            ⚠️ {selCal?.label} data not yet seeded. Showing calendar structure only.
          </div>
        )}

        {view === 'month' && (
          <>
            {/* Month navigation */}
            <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 12, padding: '0.75rem', marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                <button onClick={prevMonth} style={{ background: '#2a2a2a', border: 'none', color: '#aaa', borderRadius: 6, padding: '0.3rem 0.6rem', cursor: 'pointer', fontSize: '1rem' }}>←</button>
                <span style={{ fontWeight: 700, fontSize: '1rem' }}>{MONTHS[month]} {year}</span>
                <button onClick={nextMonth} style={{ background: '#2a2a2a', border: 'none', color: '#aaa', borderRadius: 6, padding: '0.3rem 0.6rem', cursor: 'pointer', fontSize: '1rem' }}>→</button>
              </div>

              {/* Day headers */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
                {DAYS.map(d => <div key={d} style={{ textAlign: 'center', color: '#444', fontSize: '0.72rem', fontWeight: 600, padding: '0.2rem' }}>{d}</div>)}
              </div>

              {/* Date cells */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
                {cells.map((day, i) => {
                  if (!day) return <div key={i} />;
                  const dateISO = toISO(year, month, day);
                  const isToday = dateISO === todayISO;
                  const isSelected = dateISO === selectedDate;
                  const { hasHoliday, hasPersonal } = getDayDots(dateISO);
                  return (
                    <div key={i} onClick={() => handleDayClick(dateISO)}
                      style={{ background: isSelected ? '#6366f1' : isToday ? '#1e1e3a' : '#111', borderRadius: 8, padding: '0.4rem 0.2rem', textAlign: 'center', cursor: 'pointer', border: isToday && !isSelected ? '1px solid #6366f144' : '1px solid transparent', minHeight: 44, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: isToday ? 700 : 400, color: isSelected ? '#fff' : isToday ? '#6366f1' : '#ccc' }}>{day}</span>
                      <div style={{ display: 'flex', gap: 2, marginTop: 2 }}>
                        {hasHoliday && <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />}
                        {hasPersonal && <span style={{ width: 4, height: 4, borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Legend */}
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.75rem' }}>
              <span style={{ fontSize: '0.75rem', color: '#666', display: 'flex', alignItems: 'center', gap: '0.3rem' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} /> Holiday</span>
              <span style={{ fontSize: '0.75rem', color: '#666', display: 'flex', alignItems: 'center', gap: '0.3rem' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} /> My Event</span>
            </div>

            {/* Day detail */}
            {selectedDate && (
              <div style={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 12, padding: '1rem' }}>
                <div style={{ color: '#6366f1', fontWeight: 700, fontSize: '0.95rem', marginBottom: '0.75rem' }}>
                  {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                </div>
                {loadingDay ? (
                  <div style={{ color: '#555', fontSize: '0.85rem' }}>Loading…</div>
                ) : dayEvents.length === 0 ? (
                  <div style={{ color: '#444', fontSize: '0.85rem' }}>{hasData ? 'No events for this date.' : 'No data available for this calendar type.'}</div>
                ) : dayEvents.map((e, i) => (
                  <div key={e.id || i} style={{ background: '#111', borderRadius: 8, padding: '0.7rem 0.9rem', marginBottom: '0.5rem', borderLeft: `3px solid ${e.is_personal_event ? '#f59e0b' : '#6366f1'}` }}>
                    <div style={{ color: '#fff', fontWeight: 600, fontSize: '0.88rem' }}>
                      {e.event_name || `${e.tithi}${e.nakshatra ? ` · ${e.nakshatra}` : ''}`}
                    </div>
                    <div style={{ color: '#555', fontSize: '0.75rem', marginTop: 3, display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                      {e.paksha && <span>{e.paksha}</span>}
                      {e.tithi && <span>· {e.tithi} Tithi</span>}
                      {e.nakshatra && <span>· {e.nakshatra} Nakshatra</span>}
                      {e.traditional_month && <span>· {e.traditional_month} Masa</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {view === 'events' && (
          <div>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.75rem' }}>My Events</h3>
            {myEvents.length === 0
              ? <div style={{ textAlign: 'center', padding: '3rem', color: '#444' }}>No personal events yet. Add one below.</div>
              : myEvents.map((e, i) => (
                <div key={i} style={{ background: '#1a1a1a', border: '1px solid #222', borderRadius: 10, padding: '0.8rem 1rem', marginBottom: '0.5rem' }}>
                  <div style={{ color: '#fff', fontWeight: 500 }}>{e.event_name}</div>
                  <div style={{ color: '#555', fontSize: '0.78rem', marginTop: 2 }}>{e.event_date}</div>
                </div>
              ))
            }
          </div>
        )}

        {view === 'holidays' && (
          <div>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.75rem' }}>
              {selCal?.emoji} {selCal?.label} — {MONTHS[month]} {year}
            </h3>
            {!hasData
              ? <div style={{ textAlign: 'center', padding: '3rem', color: '#444' }}>No data available for {selCal?.label} yet.</div>
              : monthEvents.filter(e => e.event_type === 'festival' || e.event_type === 'national_holiday' || e.event_type === 'panchangam').length === 0
                ? <div style={{ textAlign: 'center', padding: '3rem', color: '#444' }}>No holidays this month.</div>
                : monthEvents.map((e, i) => (
                  <div key={i} style={{ background: '#1a1a1a', border: '1px solid #222', borderRadius: 10, padding: '0.8rem 1rem', marginBottom: '0.4rem', display: 'flex', justifyContent: 'space-between' }}>
                    <div style={{ color: '#fff', fontSize: '0.88rem' }}>{e.event_name || 'Panchangam'}</div>
                    <div style={{ color: '#555', fontSize: '0.78rem' }}>{e.event_date?.slice(5)}</div>
                  </div>
                ))
            }
          </div>
        )}

        {/* Add Event Button */}
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, padding: '0.75rem 1rem', background: 'linear-gradient(transparent, #0f0f0f 40%)', paddingTop: '1.5rem' }}>
          <button onClick={() => setShowAddModal(true)}
            style={{ width: '100%', maxWidth: 760, display: 'block', margin: '0 auto', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 12, padding: '0.85rem', fontSize: '0.95rem', fontWeight: 600, cursor: 'pointer' }}>
            + Add Event / Reminder
          </button>
        </div>

      </div>
    </div>
  );
              }
