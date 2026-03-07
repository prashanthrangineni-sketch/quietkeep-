'use client';
import { useState, useEffect } from 'react';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter } from 'next/navigation';

const CALENDAR_TYPES = [
  { id: 'gregorian', label: 'Gregorian', emoji: '📅' },
  { id: 'telugu', label: 'Telugu (Panchangam)', emoji: '🌸' },
  { id: 'hindi', label: 'Hindi (Vikram Samvat)', emoji: '🪔' },
  { id: 'islamic', label: 'Islamic (Hijri)', emoji: '☪️' },
  { id: 'christian', label: 'Christian', emoji: '✝️' },
  { id: 'tamil', label: 'Tamil', emoji: '🌺' },
];

const INDIAN_STATES = [
  'All India', 'Andhra Pradesh', 'Telangana', 'Maharashtra', 'Karnataka',
  'Tamil Nadu', 'Kerala', 'Gujarat', 'Rajasthan', 'Punjab', 'Uttar Pradesh',
  'West Bengal', 'Bihar', 'Odisha', 'Madhya Pradesh', 'Delhi', 'Goa',
];

const TIMEZONES = [
  { label: 'IST (India)', value: 'Asia/Kolkata' },
  { label: 'UAE (Dubai)', value: 'Asia/Dubai' },
  { label: 'UK (London)', value: 'Europe/London' },
  { label: 'US Eastern', value: 'America/New_York' },
  { label: 'US Pacific', value: 'America/Los_Angeles' },
  { label: 'Singapore', value: 'Asia/Singapore' },
];

const REMINDER_CATEGORIES = [
  { id: 'birthday', label: 'Birthday', emoji: '🎂', color: '#FF6B6B' },
  { id: 'anniversary', label: 'Anniversary', emoji: '💍', color: '#FF69B4' },
  { id: 'festival', label: 'Festival', emoji: '🪔', color: '#FFD700' },
  { id: 'holiday', label: 'Bank Holiday', emoji: '🏦', color: '#4ECDC4' },
  { id: 'religious', label: 'Religious', emoji: '🙏', color: '#9B59B6' },
  { id: 'medical', label: 'Medical', emoji: '💊', color: '#E74C3C' },
  { id: 'work', label: 'Work', emoji: '💼', color: '#3498DB' },
  { id: 'personal', label: 'Personal', emoji: '⭐', color: '#2ECC71' },
];

// Panchang tithi data (simplified static — in production connect to Drik Panchang API)
const TITHIS = [
  'Pratipada', 'Dwitiya', 'Tritiya', 'Chaturthi', 'Panchami',
  'Shashthi', 'Saptami', 'Ashtami', 'Navami', 'Dashami',
  'Ekadashi', 'Dwadashi', 'Trayodashi', 'Chaturdashi', 'Purnima/Amavasya'
];

// AP/Telangana bank holidays 2026 (sample)
const STATIC_HOLIDAYS = {
  'Andhra Pradesh': [
    { date: '2026-01-01', name: 'New Year\'s Day' },
    { date: '2026-01-14', name: 'Bhogi / Makara Sankranti' },
    { date: '2026-01-26', name: 'Republic Day' },
    { date: '2026-03-17', name: 'Ugadi (Telugu New Year)' },
    { date: '2026-04-14', name: 'Dr. Ambedkar Jayanti' },
    { date: '2026-04-30', name: 'Sri Rama Navami' },
    { date: '2026-05-01', name: 'Labour Day' },
    { date: '2026-08-15', name: 'Independence Day' },
    { date: '2026-10-02', name: 'Gandhi Jayanti' },
    { date: '2026-10-20', name: 'Dasara (Vijayadashami)' },
    { date: '2026-11-01', name: 'AP Formation Day' },
    { date: '2026-11-12', name: 'Diwali' },
    { date: '2026-12-25', name: 'Christmas' },
  ],
  'Telangana': [
    { date: '2026-01-01', name: 'New Year\'s Day' },
    { date: '2026-01-14', name: 'Sankranti' },
    { date: '2026-01-26', name: 'Republic Day' },
    { date: '2026-03-17', name: 'Ugadi' },
    { date: '2026-06-02', name: 'Telangana Formation Day' },
    { date: '2026-08-15', name: 'Independence Day' },
    { date: '2026-10-02', name: 'Gandhi Jayanti' },
    { date: '2026-11-12', name: 'Diwali' },
    { date: '2026-12-25', name: 'Christmas' },
  ],
  'All India': [
    { date: '2026-01-01', name: 'New Year\'s Day' },
    { date: '2026-01-26', name: 'Republic Day' },
    { date: '2026-03-17', name: 'Holi' },
    { date: '2026-04-14', name: 'Dr. Ambedkar Jayanti' },
    { date: '2026-08-15', name: 'Independence Day' },
    { date: '2026-10-02', name: 'Gandhi Jayanti' },
    { date: '2026-10-20', name: 'Dussehra' },
    { date: '2026-11-12', name: 'Diwali' },
    { date: '2026-12-25', name: 'Christmas' },
  ],
};

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}
function getFirstDayOfMonth(year, month) {
  return new Date(year, month, 1).getDay();
}

export default function CalendarPage() {
  const supabase = createClientComponentClient();
  const router = useRouter();

  const today = new Date();
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [selectedDate, setSelectedDate] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showHolidays, setShowHolidays] = useState(false);
  const [activeCalendarType, setActiveCalendarType] = useState('gregorian');
  const [selectedState, setSelectedState] = useState('Andhra Pradesh');
  const [selectedTimezone, setSelectedTimezone] = useState('Asia/Kolkata');
  const [activeTab, setActiveTab] = useState('month'); // month | list | holidays

  const [form, setForm] = useState({
    event_name: '',
    event_date: '',
    event_type: 'personal',
    category: 'personal',
    is_annual: false,
    is_personal_event: true,
    religion: 'all',
    reminder_time: '09:00',
    timezone: 'Asia/Kolkata',
    state: 'Andhra Pradesh',
    calendar_type: 'gregorian',
    description: '',
    tags: [],
    color: '#6366f1',
  });

  useEffect(() => {
    fetchEvents();
  }, [currentMonth, currentYear]);

  async function fetchEvents() {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { router.push('/login'); return; }

    const startDate = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-01`;
    const endDate = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${getDaysInMonth(currentYear, currentMonth)}`;

    const { data } = await supabase
      .from('calendar_events')
      .select('*')
      .or(`is_personal_event.eq.false,user_id.eq.${session.user.id}`)
      .or(`event_date.gte.${startDate},is_annual.eq.true`);

    setEvents(data || []);
    setLoading(false);
  }

  async function saveEvent() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const payload = {
      ...form,
      user_id: session.user.id,
      is_personal_event: true,
    };

    const { error } = await supabase.from('calendar_events').insert(payload);
    if (!error) {
      setShowAddModal(false);
      setForm({ ...form, event_name: '', event_date: '', description: '' });
      fetchEvents();
    } else {
      alert('Error saving: ' + error.message);
    }
  }

  async function deleteEvent(id) {
    await supabase.from('calendar_events').delete().eq('id', id);
    fetchEvents();
  }

  // Get events for a specific date (including annual ones by month-day match)
  function getEventsForDate(day) {
    const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const mmdd = dateStr.slice(5); // MM-DD
    return events.filter(e => {
      if (e.event_date === dateStr) return true;
      if (e.is_annual && e.event_date && e.event_date.slice(5) === mmdd) return true;
      return false;
    });
  }

  function getHolidaysForDate(day) {
    const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const stateHolidays = STATIC_HOLIDAYS[selectedState] || [];
    return stateHolidays.filter(h => h.date === dateStr);
  }

  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDay = getFirstDayOfMonth(currentYear, currentMonth);
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  const selectedDateEvents = selectedDate ? getEventsForDate(selectedDate) : [];
  const selectedDateHolidays = selectedDate ? getHolidaysForDate(selectedDate) : [];

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0f', color: '#fff', fontFamily: 'system-ui, sans-serif', paddingBottom: '80px' }}>
      {/* Header */}
      <div style={{ padding: '16px', borderBottom: '1px solid #1e1e2e', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '28px' }}>📅</span>
          <span style={{ fontSize: '22px', fontWeight: 700 }}>Calendar</span>
        </div>
        <button onClick={() => router.back()} style={{ background: '#6366f1', border: 'none', color: '#fff', padding: '8px 16px', borderRadius: '10px', cursor: 'pointer', fontSize: '14px' }}>← Back</button>
      </div>

      {/* Calendar Type Tabs */}
      <div style={{ padding: '12px 16px 0', overflowX: 'auto' }}>
        <div style={{ display: 'flex', gap: '8px', minWidth: 'max-content' }}>
          {CALENDAR_TYPES.map(ct => (
            <button key={ct.id} onClick={() => setActiveCalendarType(ct.id)}
              style={{ padding: '6px 12px', borderRadius: '20px', border: 'none', cursor: 'pointer', fontSize: '12px', whiteSpace: 'nowrap',
                background: activeCalendarType === ct.id ? '#6366f1' : '#1e1e2e',
                color: activeCalendarType === ct.id ? '#fff' : '#aaa' }}>
              {ct.emoji} {ct.label}
            </button>
          ))}
        </div>
      </div>

      {/* View Tabs */}
      <div style={{ padding: '12px 16px', display: 'flex', gap: '8px' }}>
        {['month', 'list', 'holidays'].map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            style={{ padding: '6px 14px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '13px', textTransform: 'capitalize',
              background: activeTab === tab ? '#6366f1' : '#1e1e2e',
              color: activeTab === tab ? '#fff' : '#aaa' }}>
            {tab === 'month' ? '🗓️ Month' : tab === 'list' ? '📋 My Events' : '🏦 Holidays'}
          </button>
        ))}
      </div>

      {/* State + Timezone selectors */}
      <div style={{ padding: '0 16px 12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <select value={selectedState} onChange={e => setSelectedState(e.target.value)}
          style={{ background: '#1e1e2e', color: '#fff', border: '1px solid #333', borderRadius: '8px', padding: '6px 10px', fontSize: '12px' }}>
          {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={selectedTimezone} onChange={e => setSelectedTimezone(e.target.value)}
          style={{ background: '#1e1e2e', color: '#fff', border: '1px solid #333', borderRadius: '8px', padding: '6px 10px', fontSize: '12px' }}>
          {TIMEZONES.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
        </select>
      </div>

      {/* MONTH VIEW */}
      {activeTab === 'month' && (
        <div style={{ padding: '0 16px' }}>
          {/* Month navigation */}
          <div style={{ background: '#12121a', borderRadius: '16px', padding: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <button onClick={() => { if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear(y => y - 1); } else setCurrentMonth(m => m - 1); }}
                style={{ background: 'none', border: '1px solid #333', color: '#aaa', padding: '6px 12px', borderRadius: '8px', cursor: 'pointer' }}>←</button>
              <span style={{ fontWeight: 700, fontSize: '16px' }}>{monthNames[currentMonth]} {currentYear}</span>
              <button onClick={() => { if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear(y => y + 1); } else setCurrentMonth(m => m + 1); }}
                style={{ background: 'none', border: '1px solid #333', color: '#aaa', padding: '6px 12px', borderRadius: '8px', cursor: 'pointer' }}>→</button>
            </div>

            {/* Day headers */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', marginBottom: '8px' }}>
              {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
                <div key={d} style={{ textAlign: 'center', fontSize: '11px', color: '#666', fontWeight: 600 }}>{d}</div>
              ))}
            </div>

            {/* Calendar grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
              {Array.from({ length: firstDay }).map((_, i) => <div key={`empty-${i}`} />)}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const day = i + 1;
                const isToday = day === today.getDate() && currentMonth === today.getMonth() && currentYear === today.getFullYear();
                const isSelected = selectedDate === day;
                const dayEvents = getEventsForDate(day);
                const dayHolidays = getHolidaysForDate(day);
                const hasContent = dayEvents.length > 0 || dayHolidays.length > 0;

                return (
                  <button key={day} onClick={() => setSelectedDate(isSelected ? null : day)}
                    style={{ aspectRatio: '1', borderRadius: '10px', border: 'none', cursor: 'pointer', position: 'relative',
                      background: isSelected ? '#6366f1' : isToday ? '#2a2a4a' : '#1a1a2e',
                      color: isSelected ? '#fff' : isToday ? '#818cf8' : '#ccc',
                      fontWeight: isToday || isSelected ? 700 : 400, fontSize: '13px' }}>
                    {day}
                    {hasContent && (
                      <div style={{ position: 'absolute', bottom: '3px', left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: '2px' }}>
                        {dayHolidays.length > 0 && <div style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#4ECDC4' }} />}
                        {dayEvents.length > 0 && <div style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#FF6B6B' }} />}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', gap: '12px', padding: '10px 0', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#888' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#4ECDC4' }} /> Holiday
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#888' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#FF6B6B' }} /> My Event
            </div>
          </div>

          {/* Selected date details */}
          {selectedDate && (
            <div style={{ background: '#12121a', borderRadius: '16px', padding: '16px', marginTop: '8px' }}>
              <div style={{ fontWeight: 700, marginBottom: '12px', color: '#818cf8' }}>
                {monthNames[currentMonth]} {selectedDate}, {currentYear}
              </div>
              {selectedDateHolidays.map((h, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', background: '#1a2a2a', borderRadius: '8px', marginBottom: '6px' }}>
                  <span>🏦</span>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600 }}>{h.name}</div>
                    <div style={{ fontSize: '11px', color: '#888' }}>Bank Holiday · {selectedState}</div>
                  </div>
                </div>
              ))}
              {selectedDateEvents.map((e, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px', background: '#1e1e2e', borderRadius: '8px', marginBottom: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>{REMINDER_CATEGORIES.find(c => c.id === e.category)?.emoji || '📌'}</span>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: 600 }}>{e.event_name}</div>
                      {e.is_annual && <div style={{ fontSize: '11px', color: '#FFD700' }}>🔁 Yearly</div>}
                      {e.description && <div style={{ fontSize: '11px', color: '#888' }}>{e.description}</div>}
                    </div>
                  </div>
                  <button onClick={() => deleteEvent(e.id)} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '16px' }}>🗑️</button>
                </div>
              ))}
              {selectedDateHolidays.length === 0 && selectedDateEvents.length === 0 && (
                <div style={{ color: '#555', fontSize: '13px', textAlign: 'center', padding: '8px' }}>No events. Tap + to add one.</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* LIST VIEW — My Events */}
      {activeTab === 'list' && (
        <div style={{ padding: '0 16px' }}>
          <div style={{ marginBottom: '12px', color: '#888', fontSize: '13px' }}>All your saved events & yearly reminders</div>
          {events.filter(e => e.is_personal_event).length === 0 ? (
            <div style={{ textAlign: 'center', color: '#555', padding: '40px', fontSize: '14px' }}>
              No events yet. Tap + Add Event to save birthdays, anniversaries, etc.
            </div>
          ) : (
            events.filter(e => e.is_personal_event).sort((a,b) => a.event_date > b.event_date ? 1 : -1).map(e => {
              const cat = REMINDER_CATEGORIES.find(c => c.id === e.category);
              return (
                <div key={e.id} style={{ background: '#12121a', borderRadius: '12px', padding: '12px', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: cat?.color || '#333', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>
                      {cat?.emoji || '📌'}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '14px' }}>{e.event_name}</div>
                      <div style={{ fontSize: '12px', color: '#888' }}>
                        {e.event_date} {e.is_annual && '· 🔁 Every year'} {e.reminder_time && `· ⏰ ${e.reminder_time}`}
                      </div>
                    </div>
                  </div>
                  <button onClick={() => deleteEvent(e.id)} style={{ background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: '18px' }}>🗑️</button>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* HOLIDAYS VIEW */}
      {activeTab === 'holidays' && (
        <div style={{ padding: '0 16px' }}>
          <div style={{ marginBottom: '12px', color: '#888', fontSize: '13px' }}>Bank & public holidays for {selectedState} · {currentYear}</div>
          {(STATIC_HOLIDAYS[selectedState] || []).map((h, i) => (
            <div key={i} style={{ background: '#12121a', borderRadius: '12px', padding: '12px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: '#1a3a3a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px' }}>🏦</div>
              <div>
                <div style={{ fontWeight: 600, fontSize: '14px' }}>{h.name}</div>
                <div style={{ fontSize: '12px', color: '#888' }}>{h.date}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ADD EVENT BUTTON */}
      <div style={{ position: 'fixed', bottom: '20px', left: '16px', right: '16px' }}>
        <button onClick={()
