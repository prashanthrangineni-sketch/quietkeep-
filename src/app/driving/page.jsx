'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import NavbarClient from '@/components/NavbarClient';

export default function Driving() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [isActive, setIsActive] = useState(false);
  const [sessionStart, setSessionStart] = useState(null);
  const [sessionTime, setSessionTime] = useState(0);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.replace('/login'); }
      setUser(session?.user || null);
    });
  }, [router]);

  useEffect(() => {
    let interval;
    if (isActive) {
      interval = setInterval(() => {
        setSessionTime(Math.floor((Date.now() - sessionStart) / 1000));
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isActive, sessionStart]);

  const startSession = () => {
    setSessionStart(Date.now());
    setSessionTime(0);
    setIsActive(true);
  };

  const endSession = async () => {
    setIsActive(false);
    await supabase.from('driving_sessions').insert({
      user_id: user.id,
      start_time: new Date(sessionStart).toISOString(),
      end_time: new Date().toISOString(),
      duration_seconds: sessionTime,
    });
  };

  const formatTime = (seconds) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  return (
    <>
      <NavbarClient />
      <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', color: '#f1f5f9', padding: '24px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: '64px', marginBottom: '24px' }}>🚗</div>

        <div style={{ fontSize: '32px', fontWeight: '800', marginBottom: '12px', color: isActive ? '#ef4444' : '#94a3b8' }}>
          {isActive ? '⚠️ DRIVING MODE' : 'Ready to drive?'}
        </div>

        <div style={{ fontSize: '48px', fontWeight: '900', marginBottom: '32px', color: '#6366f1', fontFamily: 'monospace' }}>
          {formatTime(sessionTime)}
        </div>

        {!isActive ? (
          <button onClick={startSession} style={{ width: '100%', maxWidth: '300px', padding: '20px', backgroundColor: '#6366f1', color: '#fff', border: 'none', borderRadius: '16px', fontSize: '18px', fontWeight: '800', cursor: 'pointer', marginBottom: '20px' }}>
            🟢 START DRIVING
          </button>
        ) : (
          <button onClick={endSession} style={{ width: '100%', maxWidth: '300px', padding: '20px', backgroundColor: '#ef4444', color: '#fff', border: 'none', borderRadius: '16px', fontSize: '18px', fontWeight: '800', cursor: 'pointer', marginBottom: '20px' }}>
            ⏹ END DRIVING
          </button>
        )}

        <div style={{ width: '100%', maxWidth: '300px', backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '14px', padding: '20px', marginTop: '32px', textAlign: 'center' }}>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '12px' }}>Features</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <button style={{ backgroundColor: '#1a1a2e', border: '1px solid #334155', color: '#f1f5f9', padding: '12px', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
              📍 Maps
            </button>
            <button style={{ backgroundColor: '#1a1a2e', border: '1px solid #334155', color: '#f1f5f9', padding: '12px', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
              🎵 Music
            </button>
            <button style={{ backgroundColor: '#1a1a2e', border: '1px solid #334155', color: '#f1f5f9', padding: '12px', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
              ☎️ Calls
            </button>
            <button style={{ backgroundColor: '#1a1a2e', border: '1px solid #334155', color: '#f1f5f9', padding: '12px', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
              💬 Messages
            </button>
          </div>
        </div>

        <style>{`@keyframes glow { 0%,100% { box-shadow: 0 0 40px rgba(99,102,241,0.4); } 50% { box-shadow: 0 0 60px rgba(99,102,241,0.7); } }`}</style>
      </div>
    </>
  );
}
