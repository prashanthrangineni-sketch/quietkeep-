'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export default function CalendarPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [events, setEvents] = useState([]);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [selectedState, setSelectedState] = useState('TG');
  const [showEventForm, setShowEventForm] = useState(false);
  const [formData, setFormData] = useState({
    event_name: '',
    event_date: new Date().toISOString().split('T')[0],
    event_type: 'festival',
    is_annual: false,
  });
  const [saving, setSaving] = useState(false);

  const STATES = ['TG', 'AP', 'KA', 'TN', 'MH', 'DL', 'RJ', 'UP', 'MP', 'GJ'];

  useEffect(() => {
    loadEvents();
  }, [selectedState]);

  const loadEvents = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setUser(session.user);
        const { data, error } = await supabase
          .from('calendar_events')
          .select('*')
          .or(`region.eq.${selectedState},region.eq.all,is_personal_event.eq.true`);

        if (error) throw error;
        setEvents(data || []);
      }
    } catch (error) {
      console.error('Error loading events:', error);
      alert('Error loading calendar events');
    } finally {
      setLoading(false);
    }
  };

  const handleAddEvent = async () => {
    if (!formData.event_name.trim()) {
      alert('Please enter event name');
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('calendar_events')
        .insert({
          event_name: formData.event_name,
          event_date: formData.event_date,
          event_type: 'festival',
          is_personal_event: true,
          is_annual: formData.is_annual,
          user_id: user.id,
          region: 'all',
        })
        .select()
        .single();

      if (error) throw error;

      setEvents([...events, data]);
      setFormData({ event_name: '', event_date: new Date().toISOString().split('T')[0], event_type: 'festival', is_annual: false });
      setShowEventForm(false);
      alert('Event added successfully!');
    } catch (error) {
      console.error('Error:', error);
      alert('Error adding event: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const getDaysInMonth = (date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  };

  const eventsInMonth = events.filter(e => {
    const eventDate = new Date(e.event_date);
    return eventDate.getFullYear() === currentMonth.getFullYear() && 
           eventDate.getMonth() === currentMonth.getMonth();
  });

  const prevMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1));
  const nextMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1));

  if (loading) return <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>;

  const daysInMonth = getDaysInMonth(currentMonth);
  const firstDay = getFirstDayOfMonth(currentMonth);
  const days = [];

  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', color: '#f1f5f9', padding: '20px' }}>
      <div style={{ maxWidth: '600px', margin: '0 auto' }}>
        <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ fontSize: '28px', fontWeight: '800', margin: 0 }}>🗓️ Calendar</h1>
          <button onClick={() => router.push('/dashboard')} style={{ backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>
            ← Back
          </button>
        </div>

        <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '14px', padding: '16px', marginBottom: '20px' }}>
          <label style={{ fontSize: '12px', color: '#94a3b8', display: 'block', marginBottom: '8px' }}>Select State</label>
          <select 
            value={selectedState}
            onChange={(e) => setSelectedState(e.target.value)}
            style={{ width: '100%', padding: '10px', backgroundColor: '#1a1a2e', border: '1px solid #334155', color: '#f1f5f9', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }}
          >
            {STATES.map(state => (<option key={state} value={state}>{state}</option>))}
          </select>
        </div>

        <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '14px', padding: '16px', marginBottom: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <button onClick={prevMonth} style={{ backgroundColor: 'transparent', border: 'none', color: '#6366f1', cursor: 'pointer', fontSize: '20px' }}>←</button>
            <h2 style={{ fontSize: '16px', fontWeight: '600', margin: 0 }}>{currentMonth.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</h2>
            <button onClick={nextMonth} style={{ backgroundColor: 'transparent', border: 'none', color: '#6366f1', cursor: 'pointer', fontSize: '20px' }}>→</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', marginBottom: '12px' }}>
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <div key={day} style={{ textAlign: 'center', fontSize: '11px', fontWeight: '600', color: '#94a3b8', padding: '8px' }}>
                {day}
              </div>
            ))}
            {days.map((day, idx) => {
              const hasEvent = day && eventsInMonth.some(e => parseInt(e.event_date.split('-')[2]) === day);
              return (
                <div 
                  key={idx}
                  style={{ 
                    padding: '8px', 
                    textAlign: 'center', 
                    fontSize: '13px', 
                    fontWeight: '600',
                    backgroundColor: hasEvent ? '#6366f1' : '#1a1a2e',
                    borderRadius: '6px',
                    color: hasEvent ? '#fff' : '#e2e8f0'
                  }}
                >
                  {day}
                </div>
              );
            })}
          </div>
        </div>

        {eventsInMonth.length > 0 && (
          <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '14px', padding: '16px', marginBottom: '20px' }}>
            <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px' }}>Events This Month</h3>
            {eventsInMonth.map(event => (
              <div key={event.id} style={{ backgroundColor: '#1a1a2e', borderRadius: '8px', padding: '10px', marginBottom: '8px', fontSize: '12px' }}>
                <div style={{ fontWeight: '600' }}>{event.event_name}</div>
                <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '4px' }}>
                  {new Date(event.event_date).toLocaleDateString('en-IN')} • {event.event_type}
                </div>
              </div>
            ))}
          </div>
        )}

        <button 
          onClick={() => setShowEventForm(!showEventForm)}
          style={{ width: '100%', backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '12px', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: '600', marginBottom: '16px' }}
        >
          + Add Event
        </button>

        {showEventForm && (
          <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '14px', padding: '16px' }}>
            <input 
              type="text" 
              placeholder="Event name (Birthday, Anniversary, etc)" 
              value={formData.event_name}
              onChange={(e) => setFormData({ ...formData, event_name: e.target.value })}
              style={{ width: '100%', padding: '10px', marginBottom: '10px', backgroundColor: '#1a1a2e', border: '1px solid #334155', color: '#f1f5f9', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }}
            />
            <input 
              type="date" 
              value={formData.event_date}
              onChange={(e) => setFormData({ ...formData, event_date: e.target.value })}
              style={{ width: '100%', padding: '10px', marginBottom: '10px', backgroundColor: '#1a1a2e', border: '1px solid #334155', color: '#f1f5f9', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }}
            />
            <label style={{ display: 'flex', alignItems: 'center', marginBottom: '10px', cursor: 'pointer' }}>
              <input 
                type="checkbox" 
                checked={formData.is_annual}
                onChange={(e) => setFormData({ ...formData, is_annual: e.target.checked })}
                style={{ marginRight: '8px', cursor: 'pointer' }}
              />
              <span style={{ fontSize: '12px' }}>Yearly reminder</span>
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button 
                onClick={handleAddEvent}
                disabled={saving}
                style={{ flex: 1, backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '10px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}
              >
                {saving ? 'Saving...' : 'Add Event'}
              </button>
              <button 
                onClick={() => setShowEventForm(false)}
                style={{ flex: 1, backgroundColor: '#1a1a2e', color: '#94a3b8', border: '1px solid #334155', padding: '10px', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
