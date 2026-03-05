'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import NavbarClient from '@/components/NavbarClient';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const TYPE_COLOR = {
  national_holiday: { bg: 'rgba(239,68,68,0.15)', border: '#ef4444', text: '#ef4444', label: 'ðŸ‡®ðŸ‡³' },
  bank_holiday:     { bg: 'rgba(245,158,11,0.15)', border: '#f59e0b', text: '#f59e0b', label: 'ðŸ¦' },
  festival:         { bg: 'rgba(168,85,247,0.15)',  border: '#a855f7', text: '#a855f7', label: 'ðŸŽ‰' },
  regional:         { bg: 'rgba(34,197,94,0.15)',   border: '#22c55e', text: '#22c55e', label: 'ðŸ“' },
  keep:             { bg: 'rgba(99,102,241,0.15)',   border: '#6366f1', text: '#6366f1', label: 'ðŸ“Œ' },
  reminder:         { bg: 'rgba(59,130,246,0.15)',   border: '#3b82f6', text: '#3b82f6', label: 'â°' },
};

export default function CalendarPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [today] = useState(new Date());
  const [viewDate, setViewDate] = useState(new Date());
  const [holidays, setHolidays] = useState([]);
  const [intents, setIntents] = useState([]);
  const [selected, setSelected] = useState(null);
  const [selectedEvents, setSelectedEvents] = useState([]);
  const [filterType, setFilterType] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.replace('/login'); return; }
      setUser(session.user);
      Promise.all([
        loadHolidays(),
        loadIntents(session.user.id),
      ]).finally(() => setLoading(false));
    });
  }, [router]);

  async function loadHolidays() {
    const { data } = await supabase
      .from('calendar_events')
      .select('*')
      .order('event_date');
    if (data) setHolidays(data);
  }

  async function loadIntents(uid) {
    const { data } = await supabase
      .from('intents')
      .select('id, content, remind_at, intent_type, assist_mode, state')
      .eq('user_id', uid)
      .not('remind_at', 'is', null)
      .neq('state', 'closed');
    if (data) setIntents(data);
  }

  function getDaysInMonth(year, month) {
    return new Date(year, month + 1, 0).getDate();
  }

  function getFirstDayOfMonth(year, month) {
    return new Date(year, month, 1).getDay();
  }

  function getEventsForDate(dateStr) {
    const events = [];
    holidays.filter(h => h.event_date === dateStr).forEach(h => events.push({ ...h, source: 'calendar' }));
    intents.filter(i => i.remind_at?.startsWith(dateStr)).forEach(i => events.push({
      event_name: i.content.substring(0, 40),
      event_type: i.intent_type === 'reminder' ? 'reminder' : 'keep',
      description: i.content,
      source: 'keep',
      id: i.id,
    }));
    if (filterType !== 'all') return events.filter(e => e.event_type === filterType || (filterType === 'keep' && e.source === 'keep'));
    return events;
  }

  function handleDayClick(dateStr, events) {
    setSelected(dateStr);
    setSelectedEvents(events);
  }

  function prevMonth() {
    setViewDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1));
    setSelected(null);
  }

  function nextMonth() {
    setViewDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1));
    setSelected(null);
  }

  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  // Build calendar grid
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    cells.push({ day: d, dateStr, events: getEventsForDate(dateStr) });
  }

  // Upcoming events this month
  const upcomingThisMonth = holidays
    .filter(h => h.event_date >= todayStr && h.event_date <= `${year}-${String(month+1).padStart(2,'0')}-31`)
    .slice(0, 5);

  if (loading) return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: '36px', height: '36px', border: '3px solid #6366f1', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  return (
    <>
      <NavbarClient />
    <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', color: '#f1f5f9' }}>

      {/* Sub-nav */}
      <div style={{ borderBottom: '1px solid #1e1e2e', padding: '10px 16px', backgroundColor: 'rgba(10,10,15,0.98)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <span style={{ fontWeight: '700', fontSize: '14px', color: '#6366f1' }}>ðŸ“… Calendar</span>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <a href="/dashboard" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: '11px', padding: '5px 10px', border: '1px solid #1e293b', borderRadius: '6px' }}>ðŸ“‹ Keeps</a>
          <a href="/daily-brief" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: '11px', padding: '5px 10px', border: '1px solid #1e293b', borderRadius: '6px' }}>ðŸŒ… Brief</a>
          <a href="/finance" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: '11px', padding: '5px 10px', border: '1px solid #1e293b', borderRadius: '6px' }}>ðŸ’° Finance</a>
        </div>
      </div>

      <div style={{ maxWidth: '680px', margin: '0 auto', padding: '20px 16px' }}>

        {/* Month nav */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <button onClick={prevMonth} style={{ background: 'none', border: '1px solid #1e293b', color: '#94a3b8', padding: '8px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '16px' }}>â€¹</button>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '20px', fontWeight: '800', color: '#f1f5f9' }}>{MONTHS[month]}</div>
            <div style={{ fontSize: '12px', color: '#475569' }}>{year}</div>
          </div>
          <button onClick={nextMonth} style={{ background: 'none', border: '1px solid #1e293b', color: '#94a3b8', padding: '8px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '16px' }}>â€º</button>
        </div>

        {/* Filter pills */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', flexWrap: 'wrap' }}>
          {[
            { key: 'all', label: 'âœ¨ All' },
            { key: 'national_holiday', label: 'ðŸ‡®ðŸ‡³ National' },
            { key: 'festival', label: 'ðŸŽ‰ Festival' },
            { key: 'bank_holiday', label: 'ðŸ¦ Bank' },
            { key: 'regional', label: 'ðŸ“ Regional' },
            { key: 'keep', label: 'ðŸ“Œ My Keeps' },
          ].map(f => (
            <button key={f.key} onClick={() => setFilterType(f.key)} style={{
              padding: '5px 12px', borderRadius: '20px', cursor: 'pointer', fontSize: '11px', fontWeight: '600',
              border: `1px solid ${filterType === f.key ? '#6366f1' : '#1e293b'}`,
              backgroundColor: filterType === f.key ? 'rgba(99,102,241,0.15)' : 'transparent',
              color: filterType === f.key ? '#a5b4fc' : '#64748b',
            }}>{f.label}</button>
          ))}
        </div>

        {/* Calendar grid */}
        <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e1e2e', borderRadius: '16px', overflow: 'hidden', marginBottom: '20px' }}>
          {/* Day headers */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', borderBottom: '1px solid #1e1e2e' }}>
            {DAYS.map(d => (
              <div key={d} style={{ padding: '10px 4px', textAlign: 'center', fontSize: '11px', fontWeight: '700', color: d === 'Sun' ? '#ef4444' : d === 'Sat' ? '#6366f1' : '#475569' }}>{d}</div>
            ))}
          </div>

          {/* Calendar cells */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)' }}>
            {cells.map((cell, idx) => {
              if (!cell) return <div key={`empty-${idx}`} style={{ minHeight: '60px', borderBottom: '1px solid #0f0f1a', borderRight: idx % 7 !== 6 ? '1px solid #1a1a2e' : 'none' }} />;

              const isToday = cell.dateStr === todayStr;
              const isSelected = cell.dateStr === selected;
              const isWeekend = (idx % 7 === 0) || (idx % 7 === 6);
              const hasHoliday = cell.events.some(e => e.source === 'calendar');
              const hasKeep = cell.events.some(e => e.source === 'keep');
              const topEvent = cell.events[0];

              return (
                <div key={cell.dateStr}
                  onClick={() => handleDayClick(cell.dateStr, cell.events)}
                  style={{
                    minHeight: '60px', padding: '6px 4px',
                    borderBottom: '1px solid #1a1a2e',
                    borderRight: idx % 7 !== 6 ? '1px solid #1a1a2e' : 'none',
                    cursor: cell.events.length > 0 ? 'pointer' : 'default',
                    backgroundColor: isSelected ? 'rgba(99,102,241,0.1)' : isToday ? 'rgba(99,102,241,0.05)' : 'transparent',
                    position: 'relative',
                  }}>
                  <div style={{
                    width: '24px', height: '24px', borderRadius: '50%',
                    backgroundColor: isToday ? '#6366f1' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '12px', fontWeight: isToday ? '800' : '500',
                    color: isToday ? '#fff' : isWeekend ? (idx % 7 === 0 ? '#ef4444' : '#6366f1') : '#94a3b8',
                    margin: '0 auto 4px',
                  }}>{cell.day}</div>

                  {/* Event dots */}
                  {cell.events.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      {cell.events.slice(0, 2).map((e, ei) => {
                        const style = TYPE_COLOR[e.event_type] || TYPE_COLOR.keep;
                        return (
                          <div key={ei} style={{
                            fontSize: '8px', padding: '1px 3px', borderRadius: '3px',
                            backgroundColor: style.bg, color: style.text,
                            overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
                            lineHeight: '1.4',
                          }}>{style.label} {e.event_name?.substring(0, 10)}</div>
                        );
                      })}
                      {cell.events.length > 2 && (
                        <div style={{ fontSize: '8px', color: '#475569', textAlign: 'center' }}>+{cell.events.length - 2}</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Selected day detail */}
        {selected && selectedEvents.length > 0 && (
          <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e1e2e', borderRadius: '14px', padding: '16px', marginBottom: '20px' }}>
            <div style={{ fontSize: '12px', color: '#6366f1', fontWeight: '700', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {new Date(selected).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {selectedEvents.map((e, i) => {
                const style = TYPE_COLOR[e.event_type] || TYPE_COLOR.keep;
                return (
                  <div key={i} style={{ padding: '10px 12px', borderRadius: '10px', backgroundColor: style.bg, border: `1px solid ${style.border}20` }}>
                    <div style={{ fontSize: '13px', fontWeight: '600', color: '#f1f5f9', marginBottom: '2px' }}>{style.label} {e.event_name}</div>
                    {e.description && e.description !== e.event_name && (
                      <div style={{ fontSize: '11px', color: '#64748b' }}>{e.description}</div>
                    )}
                    <div style={{ fontSize: '10px', color: style.text, marginTop: '4px', textTransform: 'uppercase', fontWeight: '600' }}>{e.event_type?.replace('_', ' ')}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Upcoming this month */}
        {upcomingThisMonth.length > 0 && (
          <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e1e2e', borderRadius: '14px', padding: '16px' }}>
            <div style={{ fontSize: '11px', color: '#475569', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '12px' }}>ðŸ“† Coming up this month</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {upcomingThisMonth.map((e, i) => {
                const style = TYPE_COLOR[e.event_type] || TYPE_COLOR.festival;
                const date = new Date(e.event_date);
                const daysAway = Math.ceil((date - today) / (1000 * 60 * 60 * 24));
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px', borderRadius: '10px', backgroundColor: '#0a0a0f', border: '1px solid #1a1a2e' }}>
                    <div style={{ textAlign: 'center', minWidth: '36px' }}>
                      <div style={{ fontSize: '16px', fontWeight: '800', color: style.text }}>{date.getDate()}</div>
                      <div style={{ fontSize: '9px', color: '#475569' }}>{MONTHS[date.getMonth()].substring(0,3).toUpperCase()}</div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '13px', fontWeight: '600', color: '#f1f5f9' }}>{style.label} {e.event_name}</div>
                      {e.description && <div style={{ fontSize: '11px', color: '#475569' }}>{e.description}</div>}
                    </div>
                    <div style={{ fontSize: '10px', color: daysAway <= 3 ? '#ef4444' : '#475569', fontWeight: '600', whiteSpace: 'nowrap' }}>
                      {daysAway === 0 ? 'Today' : daysAway === 1 ? 'Tomorrow' : `${daysAway}d away`}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Legend */}
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '16px', padding: '12px', backgroundColor: '#0f0f1a', borderRadius: '10px', border: '1px solid #1a1a2e' }}>
          {Object.entries(TYPE_COLOR).map(([key, style]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ fontSize: '12px' }}>{style.label}</span>
              <span style={{ fontSize: '10px', color: style.text, textTransform: 'capitalize' }}>{key.replace('_', ' ')}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
    </>
  );
}
