'use client';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import NavbarClient from '@/components/NavbarClient';
import WeatherWidget from '@/components/WeatherWidget';

export default function DailyBriefPage() {
  const [user, setUser] = useState(null);
  const [brief, setBrief] = useState(null);
  const [aiSummary, setAiSummary] = useState('');
  const [loadingData, setLoadingData] = useState(true);
  const [loadingAI, setLoadingAI] = useState(false);
  const [shareMsg, setShareMsg] = useState('');

  useEffect(() => { init(); }, []);

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    setUser(user);
    if (user) await loadBrief(user.id);
    setLoadingData(false);
  }

  async function loadBrief(uid) {
    const today = new Date().toISOString().split('T')[0];
    const in7 = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
    const [{ data: profile }] = await Promise.all([
      supabase.from('profiles').select('full_name, persona_type, selected_calendar, user_state').eq('user_id', uid).single(),
    ]);
    const calType = profile?.selected_calendar || 'gregorian';
    const [
      { data: keeps }, { data: reminders }, { data: subs },
      { data: trips }, { data: nudges }, { data: todayEvents }, { data: todayPanchang },
    ] = await Promise.all([
      supabase.from('keeps').select('id,content,category,intent_type,color,reminder_at').eq('user_id', uid).eq('show_on_brief', true).eq('status', 'open').order('created_at', { ascending: false }).limit(8),
      supabase.from('keeps').select('id,content,reminder_at').eq('user_id', uid).eq('status', 'open').not('reminder_at', 'is', null).gte('reminder_at', today).lte('reminder_at', in7).order('reminder_at').limit(5),
      supabase.from('subscriptions').select('name,amount,currency,next_due').eq('user_id', uid).eq('is_active', true).lte('next_due', in7).gte('next_due', today).order('next_due').limit(5),
      supabase.from('trip_plans').select('destination,start_date,end_date').eq('user_id', uid).gte('start_date', today).order('start_date').limit(3),
      supabase.rpc('get_unread_nudges', { p_limit: 3 }),
      supabase.from('calendar_events').select('event_name,event_type,tithi,nakshatra,paksha,calendar_type').eq('event_date', today).in('event_type', ['festival','national_holiday','bank_holiday','other']).limit(6),
      supabase.from('calendar_events').select('tithi,nakshatra,paksha,traditional_month,calendar_type').eq('event_date', today).eq('event_type', 'panchangam').limit(3),
    ]);
    setBrief({ keeps: keeps || [], reminders: reminders || [], subs: subs || [], trips: trips || [], nudges: nudges || [], todayEvents: todayEvents || [], todayPanchang: todayPanchang || [], profile });
  }

  async function generateAISummary() {
    if (!brief) return;
    setLoadingAI(true); setAiSummary('');
    try {
      const res = await fetch('/api/daily-brief-summary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brief }) });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setAiSummary(data.summary || 'Could not generate summary. Please try again.');
    } catch { setAiSummary('Error generating summary. Check your connection.'); }
    setLoadingAI(false);
  }

  async function shareThisBrief() {
    const { data: token, error } = await supabase.rpc('create_share_token', { p_share_type: 'daily_brief', p_days_valid: 1 });
    if (error || !token) { setShareMsg('Could not create share link'); return; }
    const link = `${window.location.origin}/share/${token}`;
    await navigator.clipboard.writeText(link).catch(() => {});
    setShareMsg('Share link copied! Valid for 24 hours.');
  }

  async function shareViaWhatsApp() {
    const { data: token, error } = await supabase.rpc('create_share_token', { p_share_type: 'daily_brief', p_days_valid: 1 });
    if (error || !token) { setShareMsg('Could not create share link'); return; }
    const link = encodeURIComponent(`${window.location.origin}/share/${token}`);
    const text = encodeURIComponent("Here's my QuietKeep daily brief: ");
    window.open(`https://wa.me/?text=${text}${link}`, '_blank');
    setShareMsg('WhatsApp opened!');
  }

  async function dismissNudge(nudgeId) {
    await supabase.from('proactive_nudges').update({ is_dismissed: true }).eq('id', nudgeId);
    setBrief(prev => ({ ...prev, nudges: prev.nudges.filter(n => n.id !== nudgeId) }));
  }

  async function markNudgeRead(nudgeId) {
    await supabase.from('proactive_nudges').update({ is_read: true }).eq('id', nudgeId);
  }

  if (loadingData) return (
    <div style={{ minHeight: '100dvh', background: '#0b0f19', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="qk-spinner" />
    </div>
  );

  const today = new Date();
  const hour = today.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const dateStr = today.toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const name = brief?.profile?.full_name?.split(' ')[0] || '';

  const Section = ({ title, children }) => (
    <div className="qk-card" style={{ padding: 16, marginBottom: 14 }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#475569', marginBottom: 12 }}>{title}</div>
      {children}
    </div>
  );

  const Item = ({ text, meta, metaColor = '#475569', leftBorder }) => (
    <div style={{
      background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '10px 14px', marginBottom: 8,
      borderLeft: leftBorder ? `3px solid ${leftBorder}` : undefined,
    }}>
      <div style={{ color: '#cbd5e1', fontSize: 14, lineHeight: 1.5 }}>{text}</div>
      {meta && <div style={{ color: metaColor, fontSize: 12, marginTop: 3 }}>{meta}</div>}
    </div>
  );

  return (
    <div className="qk-page">
      <NavbarClient />
      <div className="qk-container">

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#e2e8f0', letterSpacing: '-0.02em' }}>
            {greeting}{name ? `, ${name}` : ''} 👋
          </div>
          <div style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>{dateStr}</div>

          <div style={{ marginTop: 12 }}>
            <WeatherWidget city="Hyderabad" lat={17.385} lon={78.487} />
          </div>
        </div>

        {/* Panchang */}
        {brief?.todayPanchang?.length > 0 && (() => {
          const p = brief.todayPanchang[0];
          const parts = [p.tithi && `${p.tithi} Tithi`, p.nakshatra && `${p.nakshatra} Nakshatra`, p.traditional_month && `${p.traditional_month} Masa`].filter(Boolean);
          if (!parts.length) return null;
          return (
            <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 12, padding: '10px 16px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 18 }}>🪔</span>
              <div style={{ color: '#fcd34d', fontSize: 13 }}>{parts.join(' · ')}</div>
            </div>
          );
        })()}

        {/* Today's festivals */}
        {brief?.todayEvents?.length > 0 && (
          <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 12, padding: '12px 16px', marginBottom: 14 }}>
            {brief.todayEvents.map((e, i) => (
              <div key={i} style={{ color: '#6ee7b7', fontSize: 14, fontWeight: 600 }}>🎉 {e.event_name}</div>
            ))}
          </div>
        )}

        {/* AI Summary */}
        <div style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 12, padding: 18, marginBottom: 14 }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#818cf8', marginBottom: 10 }}>AI Brief Summary</div>
          {aiSummary ? (
            <div style={{ color: '#c4b5fd', fontSize: 14, lineHeight: 1.7, whiteSpace: 'pre-wrap', marginBottom: 12 }}>{aiSummary}</div>
          ) : (
            <div style={{ color: '#475569', fontSize: 13, marginBottom: 12 }}>Generate a natural language summary of your day with Claude.</div>
          )}
          <button
            onClick={generateAISummary}
            disabled={loadingAI}
            className="qk-btn qk-btn-primary qk-btn-sm"
          >
            {loadingAI ? 'Generating…' : aiSummary ? 'Regenerate' : 'Generate Summary'}
          </button>
        </div>

        {/* Smart Nudges */}
        {brief?.nudges?.length > 0 && (
          <Section title="Smart Nudges">
            {brief.nudges.map((n, i) => (
              <div
                key={i}
                style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.15)', borderRadius: 8, padding: '10px 14px', marginBottom: 8 }}
                onClick={() => markNudgeRead(n.id)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: '#fbbf24', fontSize: 14, fontWeight: 600 }}>{n.title}</div>
                    <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 4 }}>{n.body}</div>
                    {n.action_url && <a href={n.action_url} style={{ color: '#818cf8', fontSize: 12, textDecoration: 'none', display: 'inline-block', marginTop: 6 }}>Go there →</a>}
                  </div>
                  <button onClick={e => { e.stopPropagation(); dismissNudge(n.id); }} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 16, marginLeft: 8 }}>✕</button>
                </div>
              </div>
            ))}
          </Section>
        )}

        {/* Keeps on brief */}
        {brief?.keeps?.length > 0 && (
          <Section title={`On Your Brief (${brief.keeps.length})`}>
            {brief.keeps.map((k, i) => <Item key={i} text={k.content} meta={`${k.category} · ${k.intent_type}`} leftBorder={k.color || '#6366f1'} />)}
          </Section>
        )}

        {/* Upcoming reminders */}
        {brief?.reminders?.length > 0 && (
          <Section title="Reminders This Week">
            {brief.reminders.map((r, i) => <Item key={i} text={r.content} meta={new Date(r.reminder_at).toLocaleString('en-IN', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} metaColor="#f59e0b" />)}
          </Section>
        )}

        {/* Subscription renewals */}
        {brief?.subs?.length > 0 && (
          <Section title="Renewals This Week">
            {brief.subs.map((s, i) => <Item key={i} text={s.name} meta={`${s.currency} ${s.amount} · due ${s.next_due}`} />)}
          </Section>
        )}

        {/* Upcoming trips */}
        {brief?.trips?.length > 0 && (
          <Section title="Upcoming Trips">
            {brief.trips.map((t, i) => <Item key={i} text={t.destination} meta={`${t.start_date} → ${t.end_date}`} />)}
          </Section>
        )}

        {/* Empty state */}
        {brief && !brief.keeps?.length && !brief.reminders?.length && !brief.subs?.length && !brief.trips?.length && !brief.nudges?.length && (
          <div className="qk-empty">
            <div className="qk-empty-icon">🌅</div>
            <div className="qk-empty-title">Your day is clear</div>
            <div className="qk-empty-sub">Nothing on brief right now.</div>
            <a href="/dashboard" style={{ display: 'inline-block', marginTop: 14, color: '#818cf8', fontSize: 13, textDecoration: 'none' }}>Add a keep →</a>
          </div>
        )}

        {/* Share section */}
        <div className="qk-card" style={{ padding: 16, marginBottom: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#475569', marginBottom: 12 }}>Share Today&apos;s Brief</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={shareThisBrief} className="qk-btn qk-btn-ghost" style={{ flex: 1, justifyContent: 'center' }}>
              🔗 Copy Link
            </button>
            <button
              onClick={shareViaWhatsApp}
              className="qk-btn"
              style={{ flex: 1, justifyContent: 'center', background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', color: '#6ee7b7' }}
            >
              💬 WhatsApp
            </button>
          </div>
          {shareMsg && <div style={{ color: '#6ee7b7', fontSize: 13, textAlign: 'center', marginTop: 10 }}>{shareMsg}</div>}
        </div>

      </div>
    </div>
  );
}
