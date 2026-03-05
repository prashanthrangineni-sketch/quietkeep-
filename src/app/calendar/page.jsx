'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import NavbarClient from '@/components/NavbarClient';

export default function Calendar() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [intents, setIntents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/login'); return; }
      setUser(session.user);
      const { data } = await supabase.from('intents').select('*').eq('user_id', session.user.id);
      setIntents(data || []);
      setLoading(false);
    });
  }, [router]);

  const getDaysInMonth = (date) => new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const getFirstDayOfMonth = (date) => new Date(date.getFullYear(), date.getMonth(), 1).getDay();

  const daysInMonth = getDaysInMonth(currentDate);
  const firstDay = getFirstDayOfMonth(currentDate);
  const days = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(i);

  const getIntentsForDay = (day) => {
    if (!day) return [];
    const date = new Date(currentDate.getFullYear(), currentDate.getMonth(), day).toISOString().split('T')[0];
    return intents.filter(i => i.created_at?.split('T')[0] === date);
  };

  if (loading) {
    return (
      <>
        <NavbarClient />
        <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', color: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div>Loading...</div>
        </div>
      </>
    );
  }

  return (
    <>
      <NavbarClient />
      <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', color: '#f1f5f9', padding: '24px 16px' }}>
        <div style={{ maxWidth: '600px', margin: '0 auto' }}>
          <div style={{ marginBottom: '32px' }}>
            <h1 style={{ fontSize: '32px', fontWeight: '800', margin: '0 0 8px' }}>📅 Calendar</h1>
            <div style={{ fontSize: '14px', color: '#94a3b8' }}>Your keeps timeline</div>
          </div>

          <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '14px', padding: '20px', marginBottom: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <button onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1))} style={{ backgroundColor: 'transparent', border: 'none', color: '#6366f1', fontSize: '18px', cursor: 'pointer' }}>
                ← 
              </button>
              <div style={{ fontSize: '16px', fontWeight: '700' }}>
                {currentDate.toLocaleString('default', { month: 'long', year: 'numeric' })}
              </div>
              <button onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1))} style={{ backgroundColor: 'transparent', border: 'none', color: '#6366f1', fontSize: '18px', cursor: 'pointer' }}>
                →
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '8px' }}>
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                <div key={day} style={{ textAlign: 'center', fontSize: '11px', fontWeight: '700', color: '#94a3b8', padding: '8px' }}>
                  {day}
                </div>
              ))}

              {days.map((day, idx) => (
                <div
                  key={idx}
                  style={{
                    backgroundColor: day ? '#1a1a2e' : 'transparent',
                    border: day ? '1px solid #334155' : 'none',
                    borderRadius: '8px',
                    padding: '8px',
                    textAlign: 'center',
                    fontSize: '12px',
                    fontWeight: '600',
                    cursor: day ? 'pointer' : 'default',
                    color: getIntentsForDay(day).length > 0 ? '#6366f1' : '#f1f5f9',
                  }}
                >
                  {day}
                  {getIntentsForDay(day).length > 0 && <div style={{ fontSize: '8px', color: '#10b981', marginTop: '2px' }}>●</div>}
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: '24px' }}>
            <h2 style={{ fontSize: '14px', fontWeight: '700', marginBottom: '12px' }}>Legend</h2>
            <div style={{ display: 'grid', gap: '8px' }}>
              {[
                { color: '#6366f1', label: 'Has keeps', icon: '●' },
                { color: '#64748b', label: 'No keeps', icon: '○' },
              ].map((item, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                  <span style={{ color: item.color, fontSize: '16px' }}>{item.icon}</span>
                  <span style={{ color: '#94a3b8' }}>{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
                  }
