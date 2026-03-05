'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import NavbarClient from '@/components/NavbarClient';

export default function DailyBrief() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [intents, setIntents] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { router.replace('/login'); return; }
      setUser(session.user);
      const uid = session.user.id;

      const today = new Date().toISOString().split('T')[0];
      const { data: todayIntents } = await supabase.from('intents').select('*').eq('user_id', uid).gte('created_at', today);
      
      const { data: todayReminders } = await supabase.from('intents').select('*').eq('user_id', uid).not('remind_at', 'is', null);

      setIntents(todayIntents || []);
      setReminders(todayReminders || []);
      setLoading(false);
    });
  }, [router]);

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
            <h1 style={{ fontSize: '32px', fontWeight: '800', margin: '0 0 8px' }}>📋 Daily Brief</h1>
            <div style={{ fontSize: '14px', color: '#94a3b8' }}>Your day at a glance</div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '24px' }}>
            <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
              <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '8px' }}>Today's Keeps</div>
              <div style={{ fontSize: '24px', fontWeight: '700' }}>{intents.length}</div>
            </div>
            <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
              <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '8px' }}>Reminders</div>
              <div style={{ fontSize: '24px', fontWeight: '700' }}>{reminders.length}</div>
            </div>
          </div>

          <div style={{ marginBottom: '24px' }}>
            <h2 style={{ fontSize: '16px', fontWeight: '700', margin: '0 0 12px' }}>Reminders</h2>
            {reminders.length > 0 ? (
              <div style={{ display: 'grid', gap: '10px' }}>
                {reminders.map(r => (
                  <div key={r.id} style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '10px', padding: '12px' }}>
                    <div style={{ fontSize: '13px', fontWeight: '600', color: '#e2e8f0' }}>{r.content}</div>
                    <div style={{ fontSize: '11px', color: '#475569', marginTop: '4px' }}>⏰ {new Date(r.remind_at).toLocaleTimeString()}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '10px', padding: '12px', textAlign: 'center', color: '#64748b' }}>
                No reminders today
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <a href="/dashboard" style={{ display: 'inline-block', backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '12px', padding: '14px', textDecoration: 'none', textAlign: 'center', flex: 1, minWidth: '140px', color: '#f1f5f9', fontSize: '12px', fontWeight: '600' }}>
              📝 My Keeps
            </a>
            <a href="/calendar" style={{ display: 'inline-block', backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '12px', padding: '14px', textDecoration: 'none', textAlign: 'center', flex: 1, minWidth: '140px', color: '#f1f5f9', fontSize: '12px', fontWeight: '600' }}>
              📅 Calendar
            </a>
            <a href="/driving" style={{ display: 'inline-block', backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '12px', padding: '14px', textDecoration: 'none', textAlign: 'center', flex: 1, minWidth: '140px', color: '#f1f5f9', fontSize: '12px', fontWeight: '600' }}>
              🚗 Driving
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
