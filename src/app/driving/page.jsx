'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import NavbarClient from '@/components/NavbarClient';
import { supabase } from '@/lib/supabase';

export default function DrivingPage() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [isDriving, setIsDriving] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkDrivingStatus();
  }, []);

  useEffect(() => {
    if (!isDriving) return;

    const interval = setInterval(() => {
      setElapsed(e => e + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [isDriving]);

  const checkDrivingStatus = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setUser(session.user);

        const { data, error } = await supabase
          .from('driving_sessions')
          .select('*')
          .eq('user_id', session.user.id)
          .is('ended_at', null)
          .order('started_at', { ascending: false })
          .limit(1)
          .single();

        if (data) {
          setIsDriving(true);
          setSessionId(data.id);
          const startTime = new Date(data.started_at).getTime();
          const now = new Date().getTime();
          setElapsed(Math.floor((now - startTime) / 1000));
        }
      }
    } catch (error) {
      console.log('No active driving session');
    } finally {
      setLoading(false);
    }
  };

  const handleStartDriving = async () => {
    try {
      const { data, error } = await supabase
        .from('driving_sessions')
        .insert({ user_id: user.id })
        .select()
        .single();

      if (error) throw error;

      setIsDriving(true);
      setSessionId(data.id);
      setElapsed(0);

      if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance('Driving mode activated. Stay safe!');
        utterance.lang = 'en-IN';
        speechSynthesis.speak(utterance);
      }

      alert('Driving mode activated! Keep your eyes on the road.');
    } catch (error) {
      alert('Error starting driving mode: ' + error.message);
    }
  };

  const handleEndDriving = async () => {
    if (!confirm('End driving mode?')) return;

    try {
      const { error } = await supabase
        .from('driving_sessions')
        .update({ ended_at: new Date().toISOString(), duration_seconds: elapsed })
        .eq('id', sessionId);

      if (error) throw error;

      setIsDriving(false);
      setSessionId(null);
      setElapsed(0);
      alert('Driving mode ended safely!');
    } catch (error) {
      alert('Error ending driving mode: ' + error.message);
    }
  };

  const formatTime = (seconds) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  if (loading) return <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8', minHeight: '100vh', backgroundColor: '#0a0a0f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Loading...</div>;

  return (
    <>
      <NavbarClient />
      <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', color: '#f1f5f9', padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: '112px' }}>
      <div style={{ maxWidth: '500px', textAlign: 'center' }}>
        <h1 style={{ fontSize: '32px', fontWeight: '800', marginBottom: '8px' }}>🚗 Ready to drive?</h1>
        
        <div style={{ fontSize: '48px', fontWeight: '700', color: '#6366f1', margin: '40px 0', fontFamily: 'monospace' }}>
          {formatTime(elapsed)}
        </div>

        {!isDriving ? (
          <button 
            onClick={handleStartDriving}
            style={{ width: '100%', backgroundColor: '#6366f1', color: '#fff', border: 'none', padding: '16px', borderRadius: '12px', cursor: 'pointer', fontSize: '18px', fontWeight: '700', marginBottom: '20px' }}
          >
            🟢 START DRIVING
          </button>
        ) : (
          <>
            <button 
              onClick={handleEndDriving}
              style={{ width: '100%', backgroundColor: '#ef4444', color: '#fff', border: 'none', padding: '16px', borderRadius: '12px', cursor: 'pointer', fontSize: '18px', fontWeight: '700', marginBottom: '20px' }}
            >
              🔴 END DRIVING
            </button>
            <div style={{ backgroundColor: '#0f0f1a', border: '2px solid #6366f1', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
              <div style={{ fontSize: '12px', color: '#6366f1', fontWeight: '600', marginBottom: '12px' }}>DRIVING MODE ACTIVE</div>
              <div style={{ fontSize: '14px', color: '#f1f5f9' }}>Keep your eyes on the road. Voice commands available.</div>
            </div>
          </>
        )}

        <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e293b', borderRadius: '12px', padding: '16px', marginBottom: '20px' }}>
          <h3 style={{ fontSize: '14px', fontWeight: '600', marginBottom: '12px' }}>Features</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <button disabled style={{ backgroundColor: isDriving ? '#6366f1' : '#1a1a2e', color: '#f1f5f9', border: '1px solid #334155', padding: '12px', borderRadius: '8px', cursor: isDriving ? 'pointer' : 'not-allowed', fontSize: '13px', fontWeight: '600', opacity: isDriving ? 1 : 0.5 }}>
              📍 Maps
            </button>
            <button disabled style={{ backgroundColor: isDriving ? '#6366f1' : '#1a1a2e', color: '#f1f5f9', border: '1px solid #334155', padding: '12px', borderRadius: '8px', cursor: isDriving ? 'pointer' : 'not-allowed', fontSize: '13px', fontWeight: '600', opacity: isDriving ? 1 : 0.5 }}>
              🎵 Music
            </button>
            <button disabled style={{ backgroundColor: isDriving ? '#6366f1' : '#1a1a2e', color: '#f1f5f9', border: '1px solid #334155', padding: '12px', borderRadius: '8px', cursor: isDriving ? 'pointer' : 'not-allowed', fontSize: '13px', fontWeight: '600', opacity: isDriving ? 1 : 0.5 }}>
              📞 Calls
            </button>
            <button disabled style={{ backgroundColor: isDriving ? '#6366f1' : '#1a1a2e', color: '#f1f5f9', border: '1px solid #334155', padding: '12px', borderRadius: '8px', cursor: isDriving ? 'pointer' : 'not-allowed', fontSize: '13px', fontWeight: '600', opacity: isDriving ? 1 : 0.5 }}>
              💬 Messages
            </button>
          </div>
        </div>

        <button 
          onClick={() => router.push('/dashboard')}
          style={{ width: '100%', backgroundColor: '#1a1a2e', color: '#94a3b8', border: '1px solid #334155', padding: '12px', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: '600' }}
        >
          ← Back to Dashboard
        </button>
      </div>
    </div>
    </>
  );
}
