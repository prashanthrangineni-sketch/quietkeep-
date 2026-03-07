// FILE: src/app/calendar/CalendarDayDetail.jsx
// Add this import in calendar/page.jsx: import CalendarDayDetail from './CalendarDayDetail';
// Then where you handle date click, call: setSelectedDate(dateStr)
// And render: <CalendarDayDetail date={selectedDate} calendarType={calendarType} userId={user?.id} onClose={() => setSelectedDate(null)} />

'use client';
import { useState, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';

function getSupabase() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

// Tithi names for Telugu/Hindi Panchangam
const TITHI_NAMES = ['Pratipada','Dwitiya','Tritiya','Chaturthi','Panchami','Shashti','Saptami','Ashtami','Navami','Dashami','Ekadashi','Dwadashi','Trayodashi','Chaturdashi','Purnima/Amavasya'];
const NAKSHATRA_NAMES = ['Ashwini','Bharani','Krittika','Rohini','Mrigashira','Ardra','Punarvasu','Pushya','Ashlesha','Magha','Purva Phalguni','Uttara Phalguni','Hasta','Chitra','Swati','Vishakha','Anuradha','Jyeshtha','Mula','Purva Ashadha','Uttara Ashadha','Shravana','Dhanishtha','Shatabhisha','Purva Bhadrapada','Uttara Bhadrapada','Revati'];

// Simple lunar day calculation (approximate — for display purposes)
function getLunarDay(dateStr) {
  const date = new Date(dateStr);
  const knownNewMoon = new Date('2026-02-17'); // approximate new moon
  const daysSince = Math.floor((date - knownNewMoon) / (1000 * 60 * 60 * 24));
  const lunarDay = ((daysSince % 30) + 30) % 30;
  const tithiIndex = Math.floor(lunarDay / 2) % 15;
  const nakshatraIndex = Math.floor((daysSince * 27 / 29.5) % 27);
  return {
    tithi: TITHI_NAMES[tithiIndex] || 'Pratipada',
    nakshatra: NAKSHATRA_NAMES[((nakshatraIndex % 27) + 27) % 27],
    paksha: lunarDay < 15 ? 'Shukla Paksha (Waxing)' : 'Krishna Paksha (Waning)',
    lunarDay: lunarDay + 1,
  };
}

// Telugu month names
const TELUGU_MONTHS = ['Chaitra','Vaishakha','Jyeshtha','Ashadha','Shravana','Bhadrapada','Ashwina','Kartika','Margashira','Pushya','Magha','Phalguna'];

export default function CalendarDayDetail({ date, calendarType, userId, onClose }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!date) return;
    loadEvents();
  }, [date]);

  async function loadEvents() {
    setLoading(true);
    const supabase = getSupabase();
    const { data } = await supabase
      .from('calendar_events')
      .select('id, event_name, event_type, tithi, nakshatra, traditional_month, hijri_month, hijri_day, description, reminder_time, is_annual')
      .or(`is_personal_event.eq.false${userId ? `,user_id.eq.${userId}` : ''}`)
      .eq('event_date', date);
    setEvents(data || []);
    setLoading(false);
  }

  if (!date) return null;

  const lunar = getLunarDay(date);
  const dateObj = new Date(date);
  const monthIndex = dateObj.getMonth();

  const showTelugu = calendarType === 'telugu';
  const showHindi = calendarType === 'hindi';
  const showIslamic = calendarType === 'islamic';
  const showPanchang = showTelugu || showHindi;

  const TYPE_EMOJI = { birthday:'🎂', anniversary:'💍', festival:'🪔', holiday:'🏦', religious:'🙏', medical:'💊', work:'💼', personal:'⭐', public_holiday:'🏦' };

  const S = {
    overlay: { position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', zIndex:100, display:'flex', alignItems:'flex-end' },
    sheet: { width:'100%', background:'#12121a', borderRadius:'20px 20px 0 0', padding:'20px 16px 32px', maxHeight:'80vh', overflowY:'auto' },
    handle: { width:'40px', height:'4px', background:'#333', borderRadius:'2px', margin:'0 auto 16px' },
    dateHeader: { fontSize:'18px', fontWeight:800, marginBottom:'4px' },
    sub: { fontSize:'12px', color:'#888', marginBottom:'16px' },
    divider: { height:'1px', background:'#1e1e2e', margin:'12px 0' },
    panchangRow: { display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid #1e1e2e' },
    panchangLabel: { fontSize:'12px', color:'#888' },
    panchangValue: { fontSize:'12px', color:'#c4b5fd', fontWeight:600, textAlign:'right', maxWidth:'60%' },
    eventItem: { display:'flex', alignItems:'flex-start', gap:'10px', padding:'10px', background:'#1a1a2e', borderRadius:'10px', marginBottom:'8px' },
    noEvents: { textAlign:'center', color:'#555', fontSize:'13px', padding:'16px 0' },
    closeBtn: { position:'absolute', top:'16px', right:'16px', background:'#1e1e2e', border:'none', color:'#888', width:'32px', height:'32px', borderRadius:'50%', cursor:'pointer', fontSize:'16px', display:'flex', alignItems:'center', justifyContent:'center' },
  };

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={{ ...S.sheet, position:'relative' }} onClick={e => e.stopPropagation()}>
        <div style={S.handle} />
        <button style={S.closeBtn} onClick={onClose}>✕</button>

        <div style={S.dateHeader}>
          {dateObj.toLocaleDateString('en-IN', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}
        </div>

        {/* Panchang details for Telugu / Hindi */}
        {showPanchang && (
          <>
            <div style={{ fontSize:'12px', color:'#6366f1', fontWeight:700, marginBottom:'8px', textTransform:'uppercase', letterSpacing:'0.05em' }}>
              {showTelugu ? '🌸 Telugu Panchangam' : '🌙 Hindi Vikram Samvat'}
            </div>
            <div style={{ background:'#0f0f1a', borderRadius:'12px', padding:'4px 12px', marginBottom:'12px' }}>
              {[
                { label: showTelugu ? 'Masam (Month)' : 'Maas', value: TELUGU_MONTHS[monthIndex] },
                { label: 'Paksha', value: lunar.paksha },
                { label: 'Tithi', value: lunar.tithi },
                { label: 'Nakshatra', value: lunar.nakshatra },
              ].map(row => (
                <div key={row.label} style={S.panchangRow}>
                  <span style={S.panchangLabel}>{row.label}</span>
                  <span style={S.panchangValue}>{row.value}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Islamic Hijri */}
        {showIslamic && (
          <>
            <div style={{ fontSize:'12px', color:'#6366f1', fontWeight:700, marginBottom:'8px', textTransform:'uppercase' }}>
              ☪️ Islamic Hijri
            </div>
            <div style={{ background:'#0f0f1a', borderRadius:'12px', padding:'4px 12px', marginBottom:'12px' }}>
              <div style={S.panchangRow}>
                <span style={S.panchangLabel}>Hijri Day</span>
                <span style={S.panchangValue}>{lunar.lunarDay}</span>
              </div>
              <div style={S.panchangRow}>
                <span style={S.panchangLabel}>Phase</span>
                <span style={S.panchangValue}>{lunar.paksha}</span>
              </div>
            </div>
          </>
        )}

        {/* Events on this date */}
        <div style={{ fontSize:'12px', color:'#888', fontWeight:700, marginBottom:'8px', textTransform:'uppercase' }}>
          Events on this day
        </div>
        {loading ? (
          <div style={S.noEvents}>Loading...</div>
        ) : events.length === 0 ? (
          <div style={S.noEvents}>No events on this date</div>
        ) : (
          events.map(e => (
            <div key={e.id} style={S.eventItem}>
              <span style={{ fontSize:'20px', flexShrink:0 }}>{TYPE_EMOJI[e.event_type] || '📌'}</span>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:'14px', fontWeight:700 }}>{e.event_name}</div>
                {e.description && <div style={{ fontSize:'12px', color:'#888', marginTop:'2px' }}>{e.description}</div>}
                {(e.tithi || e.nakshatra) && (
                  <div style={{ fontSize:'11px', color:'#6366f1', marginTop:'2px' }}>
                    {[e.tithi, e.nakshatra].filter(Boolean).join(' · ')}
                  </div>
                )}
                {e.reminder_time && (
                  <div style={{ fontSize:'11px', color:'#FFD700', marginTop:'2px' }}>⏰ {e.reminder_time}</div>
                )}
                {e.is_annual && <div style={{ fontSize:'10px', color:'#555', marginTop:'2px' }}>🔁 Yearly</div>}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
    }
