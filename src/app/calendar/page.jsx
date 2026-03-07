'use client';
import { useState, useEffect } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import AddEventModal from './AddEventModal';

const CALENDAR_TYPES = [
  { id: 'gregorian', label: 'Gregorian', emoji: '📅' },
  { id: 'telugu', label: 'Telugu Panchangam', emoji: '🌸' },
  { id: 'hindi', label: 'Hindi Vikram Samvat', emoji: '🪔' },
  { id: 'islamic', label: 'Islamic Hijri', emoji: '☪️' },
  { id: 'christian', label: 'Christian', emoji: '✝️' },
  { id: 'tamil', label: 'Tamil', emoji: '🌺' },
];

const INDIAN_STATES = [
  'All India','Andhra Pradesh','Telangana','Maharashtra','Karnataka',
  'Tamil Nadu','Kerala','Gujarat','Rajasthan','Punjab','Uttar Pradesh',
  'West Bengal','Bihar','Odisha','Madhya Pradesh','Delhi','Goa',
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

const STATIC_HOLIDAYS = {
  'Andhra Pradesh': [
    { date: '2026-01-01', name: "New Year's Day" },
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
    { date: '2026-01-01', name: "New Year's Day" },
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
    { date: '2026-01-01', name: "New Year's Day" },
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

function getDaysInMonth(year, month) { return new Date(year, month + 1, 0).getDate(); }
function getFirstDayOfMonth(year, month) { return new Date(year, month, 1).getDay(); }
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

const BLANK_FORM = {
  event_name: '', event_date: '', event_type: 'personal', category: 'personal',
  is_annual: false, is_personal_event: true, religion: 'all', reminder_time: '09:00',
  timezone: 'Asia/Kolkata', state: 'Andhra Pradesh', calendar_type: 'gregorian',
  description: '', color: '#6366f1',
};

export default function CalendarPage() {
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  const router = useRouter();
  const today = new Date();

  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [selectedDate, setSelectedDate] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [activeCalendarType, setActiveCalendarType] = useState('gregorian');
  const [selectedState, setSelectedState] = useState('Andhra Pradesh');
  const [selectedTimezone, setSelectedTimezone] = useState('Asia/Kolkata');
  const [activeTab, setActiveTab] = useState('month');
  const [form, setForm] = useState(BLANK_FORM);

  useEffect(() => { fetchEvents(); }, [currentMonth, currentYear]);

  async function fetchEvents() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    const { data } = await supabase
      .from('calendar_events')
      .select('*')
      .or(`is_personal_event.eq.false,user_id.eq.${user.id}`);
    setEvents(data || []);
    setLoading(false);
  }

  async function saveEvent() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase.from('calendar_events').insert({ ...form, user_id: user.id, is_personal_event: true });
    if (!error) { setShowAddModal(false); setForm(BLANK_FORM); fetchEvents(); }
    else alert('Error saving: ' + error.message);
  }

  async function deleteEvent(id) {
    await supabase.from('calendar_events').delete().eq('id', id);
    fetchEvents();
  }

  function getEventsForDate(day) {
    const dateStr = `${currentYear}-${String(currentMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const mmdd = dateStr.slice(5);
    return events.filter(e => e.event_date === dateStr || (e.is_annual && e.event_date?.slice(5) === mmdd));
  }

  function getHolidaysForDate(day) {
    const dateStr = `${currentYear}-${String(currentMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    return (STATIC_HOLIDAYS[selectedState] || []).filter(h => h.date === dateStr);
  }

  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDay = getFirstDayOfMonth(currentYear, currentMonth);
  const prevMonth = () => { if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear(y => y-1); } else setCurrentMonth(m => m-1); };
  const nextMonth = () => { if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear(y => y+1); } else setCurrentMonth(m => m+1); };

  const selEvents = selectedDate ? getEventsForDate(selectedDate) : [];
  const selHolidays = selectedDate ? getHolidaysForDate(selectedDate) : [];

  const S = {
    page: { minHeight:'100vh', background:'#0a0a0f', color:'#fff', fontFamily:'system-ui,sans-serif', paddingBottom:'80px' },
    header: { padding:'16px', borderBottom:'1px solid #1e1e2e', display:'flex', alignItems:'center', justifyContent:'space-between' },
    backBtn: { background:'#6366f1', border:'none', color:'#fff', padding:'8px 16px', borderRadius:'10px', cursor:'pointer', fontSize:'14px' },
    scrollRow: { padding:'12px 16px 0', overflowX:'auto' },
    innerRow: { display:'flex', gap:'8px', minWidth:'max-content' },
    tabRow: { padding:'12px 16px', display:'flex', gap:'8px' },
    filterRow: { padding:'0 16px 12px', display:'flex', gap:'8px', flexWrap:'wrap' },
    select: { background:'#1e1e2e', color:'#fff', border:'1px solid #333', borderRadius:'8px', padding:'6px 10px', fontSize:'12px' },
    card: { background:'#12121a', borderRadius:'16px', padding:'16px' },
    navBtn: { background:'none', border:'1px solid #333', color:'#aaa', padding:'6px 12px', borderRadius:'8px', cursor:'pointer' },
    fab: { position:'fixed', bottom:'20px', left:'16px', right:'16px' },
    fabBtn: { width:'100%', padding:'16px', background:'#6366f1', border:'none', color:'#fff', borderRadius:'14px', fontSize:'16px', fontWeight:700, cursor:'pointer' },
    eventRow: { display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px', background:'#1e1e2e', borderRadius:'8px', marginBottom:'6px' },
    holidayRow: { display:'flex', alignItems:'center', gap:'8px', padding:'8px', background:'#1a2a2a', borderRadius:'8px', marginBottom:'6px' },
    listItem: { background:'#12121a', borderRadius:'12px', padding:'12px', marginBottom:'8px', display:'flex', alignItems:'center', justifyContent:'space-between' },
    catIcon: (color) => ({ width:'36px', height:'36px', borderRadius:'10px', background: color || '#333', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'18px' }),
    delBtn: { background:'none', border:'none', color:'#555', cursor:'pointer', fontSize:'18px' },
  };

  function chipBtn(isActive, label, onClick) {
    return (
      <button onClick={onClick} style={{ padding:'6px 12px', borderRadius:'20px', border:'none', cursor:'pointer', fontSize:'12px', whiteSpace:'nowrap',
        background: isActive ? '#6366f1' : '#1e1e2e', color: isActive ? '#fff' : '#aaa' }}>
        {label}
      </button>
    );
  }

  function tabBtn(id, label, isActive) {
    return (
      <button onClick={() => setActiveTab(id)} style={{ padding:'6px 14px', borderRadius:'8px', border:'none', cursor:'pointer', fontSize:'13px',
        background: isActive ? '#6366f1' : '#1e1e2e', color: isActive ? '#fff' : '#aaa' }}>
        {label}
      </button>
    );
  }

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
          <span style={{ fontSize:'28px' }}>📅</span>
          <span style={{ fontSize:'22px', fontWeight:700 }}>Calendar</span>
        </div>
        <button onClick={() => router.back()} style={S.backBtn}>← Back</button>
      </div>

      {/* Calendar type chips */}
      <div style={S.scrollRow}>
        <div style={S.innerRow}>
          {CALENDAR_TYPES.map(ct => chipBtn(activeCalendarType === ct.id, `${ct.emoji} ${ct.label}`, () => setActiveCalendarType(ct.id)))}
        </div>
      </div>

      {/* View tabs */}
      <div style={S.tabRow}>
        {tabBtn('month', '🗓️ Month', activeTab==='month')}
        {tabBtn('list', '📋 My Events', activeTab==='list')}
        {tabBtn('holidays', '🏦 Holidays', activeTab==='holidays')}
      </div>

      {/* Filters */}
      <div style={S.filterRow}>
        <select value={selectedState} onChange={e => setSelectedState(e.target.value)} style={S.select}>
          {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={selectedTimezone} onChange={e => setSelectedTimezone(e.target.value)} style={S.select}>
          {TIMEZONES.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
        </select>
      </div>

      {/* MONTH VIEW */}
      {activeTab === 'month' && (
        <div style={{ padding:'0 16px' }}>
          <div style={S.card}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'16px' }}>
              <button onClick={prevMonth} style={S.navBtn}>←</button>
              <span style={{ fontWeight:700, fontSize:'16px' }}>{MONTHS[currentMonth]} {currentYear}</span>
              <button onClick={nextMonth} style={S.navBtn}>→</button>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:'4px', marginBottom:'8px' }}>
              {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
                <div key={d} style={{ textAlign:'center', fontSize:'11px', color:'#666', fontWeight:600 }}>{d}</div>
              ))}
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:'4px' }}>
              {Array.from({ length: firstDay }).map((_,i) => <div key={`e${i}`} />)}
              {Array.from({ length: daysInMonth }).map((_,i) => {
                const day = i + 1;
                const isToday = day===today.getDate() && currentMonth===today.getMonth() && currentYear===today.getFullYear();
                const isSel = selectedDate === day;
                const hasEv = getEventsForDate(day).length > 0;
                const hasHol = getHolidaysForDate(day).length > 0;
                return (
                  <button key={day} onClick={() => setSelectedDate(isSel ? null : day)}
                    style={{ aspectRatio:'1', borderRadius:'10px', border:'none', cursor:'pointer', position:'relative',
                      background: isSel ? '#6366f1' : isToday ? '#2a2a4a' : '#1a1a2e',
                      color: isSel ? '#fff' : isToday ? '#818cf8' : '#ccc',
                      fontWeight: (isToday||isSel) ? 700 : 400, fontSize:'13px' }}>
                    {day}
                    {(hasEv || hasHol) && (
                      <div style={{ position:'absolute', bottom:'3px', left:'50%', transform:'translateX(-50%)', display:'flex', gap:'2px' }}>
                        {hasHol && <div style={{ width:'4px', height:'4px', borderRadius:'50%', background:'#4ECDC4' }} />}
                        {hasEv && <div style={{ width:'4px', height:'4px', borderRadius:'50%', background:'#FF6B6B' }} />}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Legend */}
          <div style={{ display:'flex', gap:'12px', padding:'10px 0', flexWrap:'wrap' }}>
            {[['#4ECDC4','Holiday'],['#FF6B6B','My Event']].map(([c,l]) => (
              <div key={l} style={{ display:'flex', alignItems:'center', gap:'4px', fontSize:'11px', color:'#888' }}>
                <div style={{ width:'8px', height:'8px', borderRadius:'50%', background:c }} /> {l}
              </div>
            ))}
          </div>

          {/* Selected date panel */}
          {selectedDate && (
            <div style={{ ...S.card, marginTop:'8px' }}>
              <div style={{ fontWeight:700, marginBottom:'12px', color:'#818cf8' }}>
                {MONTHS[currentMonth]} {selectedDate}, {currentYear}
              </div>
              {selHolidays.map((h,i) => (
                <div key={i} style={S.holidayRow}>
                  <span>🏦</span>
                  <div>
                    <div style={{ fontSize:'13px', fontWeight:600 }}>{h.name}</div>
                    <div style={{ fontSize:'11px', color:'#888' }}>Bank Holiday · {selectedState}</div>
                  </div>
                </div>
              ))}
              {selEvents.map((e,i) => {
                const cat = REMINDER_CATEGORIES.find(c => c.id === e.category);
                return (
                  <div key={i} style={S.eventRow}>
                    <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                      <span>{cat?.emoji || '📌'}</span>
                      <div>
                        <div style={{ fontSize:'13px', fontWeight:600 }}>{e.event_name}</div>
                        {e.is_annual && <div style={{ fontSize:'11px', color:'#FFD700' }}>🔁 Yearly</div>}
                        {e.description && <div style={{ fontSize:'11px', color:'#888' }}>{e.description}</div>}
                      </div>
                    </div>
                    <button onClick={() => deleteEvent(e.id)} style={S.delBtn}>🗑️</button>
                  </div>
                );
              })}
              {selHolidays.length===0 && selEvents.length===0 && (
                <div style={{ color:'#555', fontSize:'13px', textAlign:'center', padding:'8px' }}>No events. Tap + to add one.</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* LIST VIEW */}
      {activeTab === 'list' && (
        <div style={{ padding:'0 16px' }}>
          <div style={{ marginBottom:'12px', color:'#888', fontSize:'13px' }}>All saved events & yearly reminders</div>
          {events.filter(e => e.is_personal_event).length === 0
            ? <div style={{ textAlign:'center', color:'#555', padding:'40px', fontSize:'14px' }}>No events yet. Tap + Add Event.</div>
            : events.filter(e => e.is_personal_event).sort((a,b) => a.event_date > b.event_date ? 1 : -1).map(e => {
                const cat = REMINDER_CATEGORIES.find(c => c.id === e.category);
                return (
                  <div key={e.id} style={S.listItem}>
                    <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                      <div style={S.catIcon(cat?.color)}>{cat?.emoji || '📌'}</div>
                      <div>
                        <div style={{ fontWeight:600, fontSize:'14px' }}>{e.event_name}</div>
                        <div style={{ fontSize:'12px', color:'#888' }}>
                          {e.event_date}{e.is_annual && ' · 🔁 Yearly'}{e.reminder_time && ` · ⏰ ${e.reminder_time}`}
                        </div>
                      </div>
                    </div>
                    <button onClick={() => deleteEvent(e.id)} style={S.delBtn}>🗑️</button>
                  </div>
                );
              })
          }
        </div>
      )}

      {/* HOLIDAYS VIEW */}
      {activeTab === 'holidays' && (
        <div style={{ padding:'0 16px' }}>
          <div style={{ marginBottom:'12px', color:'#888', fontSize:'13px' }}>Bank & public holidays · {selectedState} · {currentYear}</div>
          {(STATIC_HOLIDAYS[selectedState] || []).map((h,i) => (
            <div key={i} style={S.listItem}>
              <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                <div style={S.catIcon('#1a3a3a')}>🏦</div>
                <div>
                  <div style={{ fontWeight:600, fontSize:'14px' }}>{h.name}</div>
                  <div style={{ fontSize:'12px', color:'#888' }}>{h.date}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* FAB */}
      <div style={S.fab}>
        <button onClick={() => {
          const d = selectedDate;
          setForm({ ...BLANK_FORM, event_date: d ? `${currentYear}-${String(currentMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}` : '' });
          setShowAddModal(true);
        }} style={S.fabBtn}>
          + Add Event / Reminder
        </button>
      </div>

      {/* MODAL */}
      {showAddModal && (
        <AddEventModal
          form={form}
          setForm={setForm}
          onSave={saveEvent}
          onClose={() => setShowAddModal(false)}
          categories={REMINDER_CATEGORIES}
          timezones={TIMEZONES}
          calendarTypes={CALENDAR_TYPES}
        />
      )}
    </div>
  );
    }
