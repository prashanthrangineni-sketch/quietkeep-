'use client';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import NavbarClient from '@/components/NavbarClient';

// ─────────────────────────────────────────────────────────
// FILE: src/app/daily-brief/page.jsx  |  BLOCK 1 of 2
// Paste this block first, then paste BLOCK 2 immediately after
// ─────────────────────────────────────────────────────────

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

    const [
      { data: profile },
    ] = await Promise.all([
      supabase.from('profiles').select('full_name, persona_type, selected_calendar, user_state').eq('user_id', uid).single(),
    ]);

    const calType = profile?.selected_calendar || 'gregorian';

    const [
      { data: keeps },
      { data: reminders },
      { data: subs },
      { data: trips },
      { data: nudges },
      { data: todayEvents },
      { data: todayPanchang },
    ] = await Promise.all([
      supabase.from('keeps').select('id,content,category,intent_type,color,reminder_at').eq('user_id', uid).eq('show_on_brief', true).eq('status', 'open').order('created_at', { ascending: false }).limit(8),
      supabase.from('keeps').select('id,content,reminder_at').eq('user_id', uid).eq('status', 'open').not('reminder_at', 'is', null).gte('reminder_at', today).lte('reminder_at', in7).order('reminder_at').limit(5),
      supabase.from('subscriptions').select('name,amount,currency,next_due').eq('user_id', uid).eq('is_active', true).lte('next_due', in7).gte('next_due', today).order('next_due').limit(5),
      supabase.from('trip_plans').select('destination,start_date,end_date').eq('user_id', uid).gte('start_date', today).order('start_date').limit(3),
      supabase.rpc('get_unread_nudges', { p_limit: 3 }),
      supabase.from('calendar_events').select('event_name,event_type,tithi,nakshatra,paksha,calendar_type').eq('event_date', today).in('event_type', ['festival','national_holiday','bank_holiday','other']).limit(6),
      supabase.from('calendar_events').select('tithi,nakshatra,paksha,traditional_month,calendar_type').eq('event_date', today).eq('event_type', 'panchangam').limit(3),
    ]);

    setBrief({
      keeps: keeps || [],
      reminders: reminders || [],
      subs: subs || [],
      trips: trips || [],
      nudges: nudges || [],
      todayEvents: todayEvents || [],
      todayPanchang: todayPanchang || [],
      profile,
    });
  }

  async function generateAISummary() {
    if (!brief) return;
    setLoadingAI(true);
    setAiSummary('');
    try {
      const res = await fetch('/api/daily-brief-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setAiSummary(data.summary || 'Could not generate summary. Please try again.');
    } catch {
      setAiSummary('Error generating summary. Check your connection.');
    }
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
    <div style={{ minHeight: '100vh', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui,sans-serif' }}>
      <div style={{ color: '#64748b', fontSize: 15 }}>Loading your brief...</div>
    </div>
  );

  const today = new Date();
  const hour = today.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const dateStr = today.toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const name = brief?.profile?.full_name?.split(' ')[0] || '';

  // ── Styles (shared across both blocks) ──────────────────────────────────────
  const page = { minHeight: '100vh', background: '#0f172a', padding: '24px 16px 100px', fontFamily: 'system-ui,sans-serif' };
  const card = { background: '#1e293b', borderRadius: 12, padding: 16, marginBottom: 14, border: '1px solid #334155' };
  const cardTitle = { color: '#64748b', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 };
  const item = { background: '#0f172a', borderRadius: 8, padding: '10px 14px', marginBottom: 8 };
  const itemText = { color: '#cbd5e1', fontSize: 14, lineHeight: 1.5 };
  const itemMeta = { color: '#475569', fontSize: 12, marginTop: 3 };
  const btn = { padding: '10px 18px', borderRadius: 8, border: 'none', fontWeight: 600, fontSize: 14, cursor: 'pointer' };

  return (
    <div style={page}>
      <NavbarClient />
      <div style={{ maxWidth: 480, margin: '0 auto' }}>

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ color: '#f1f5f9', fontSize: 22, fontWeight: 700 }}>{greeting}{name ? `, ${name}` : ''} 👋</div>
          <div style={{ color: '#64748b', fontSize: 14, marginTop: 4 }}>{dateStr}</div>
        </div>

        {/* Today's Panchang — tithi / nakshatra */}
        {brief?.todayPanchang?.length > 0 && (() => {
          const p = brief.todayPanchang[0];
          const parts = [p.tithi && `${p.tithi} Tithi`, p.nakshatra && `${p.nakshatra} Nakshatra`, p.traditional_month && `${p.traditional_month} Masa`].filter(Boolean);
      if (!parts.length) return null;
          return (
            <div style={{ background: '#1a1000', border: '1px solid #f59e0b33', borderRadius: 12, padding: '10px 16px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 18 }}>🪔</span>
              <div style={{ color: '#fcd34d', fontSize: 13 }}>{parts.join(' · ')}</div>
            </div>
          );
        })()}

        {/* Today's holidays / festivals */}
        {brief?.todayEvents?.length > 0 && (
          <div style={{ ...card, background: '#0d1f0d', border: '1px solid #166534' }}>
            {brief.todayEvents.map((e, i) => (
              <div key={i} style={{ color: '#86efac', fontSize: 14, fontWeight: 600 }}>🎉 {e.event_name}</div>
            ))}
          </div>
        )}

        {/* AI Summary box */}
        <div style={{ background: '#0d1a2e', border: '1px solid #1e3a5f', borderRadius: 12, padding: 18, marginBottom: 14 }}>
          <div style={{ color: '#60a5fa', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>AI Brief Summary</div>
          {aiSummary ? (
            <div style={{ color: '#93c5fd', fontSize: 15, lineHeight: 1.7, whiteSpace: 'pre-wrap', marginBottom: 12 }}>{aiSummary}</div>
          ) : (
            <div style={{ color: '#475569', fontSize: 14, marginBottom: 12 }}>Generate a natural language summary of your day with Claude.</div>
          )}
          <button
            onClick={generateAISummary}
            disabled={loadingAI}
            style={{ ...btn, background: loadingAI ? '#1e3a5f' : '#6366f1', color: '#fff' }}
          >{loadingAI ? 'Generating...' : aiSummary ? 'Regenerate' : 'Generate Summary'}</button>
        </div>

        {/* Smart Nudges */}
        {brief?.nudges?.length > 0 && (
          <div style={card}>
            <div style={cardTitle}>Smart Nudges</div>
            {brief.nudges.map((n, i) => (
              <div key={i} style={{ background: '#1c1400', border: '1px solid #f59e0b22', borderRadius: 8, padding: '10px 14px', marginBottom: 8 }}
                onClick={() => markNudgeRead(n.id)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: '#fbbf24', fontSize: 14, fontWeight: 600 }}>{n.title}</div>
                    <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 4 }}>{n.body}</div>
                    {n.action_url && <a href={n.action_url} style={{ color: '#60a5fa', fontSize: 12, textDecoration: 'none', display: 'inline-block', marginTop: 6 }}>Go there →</a>}
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); dismissNudge(n.id); }} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 16, marginLeft: 8 }}>✕</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* END OF BLOCK 1 — continue with BLOCK 2 */}
        {/* Keeps on brief */}
        {brief?.keeps?.length > 0 && (
          <div style={card}>
            <div style={cardTitle}>On Your Brief ({brief.keeps.length})</div>
            {brief.keeps.map((k, i) => (
              <div key={i} style={{ ...item, borderLeft: `3px solid ${k.color || '#334155'}`, paddingLeft: 12, background: 'transparent' }}>
                <div style={itemText}>{k.content}</div>
                <div style={itemMeta}>{k.category} · {k.intent_type}</div>
              </div>
            ))}
          </div>
        )}

        {/* Upcoming reminders */}
        {brief?.reminders?.length > 0 && (
          <div style={card}>
            <div style={cardTitle}>Reminders This Week</div>
            {brief.reminders.map((r, i) => (
              <div key={i} style={item}>
                <div style={itemText}>{r.content}</div>
                <div style={{ ...itemMeta, color: '#f59e0b' }}>
                  {new Date(r.reminder_at).toLocaleString('en-IN', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Subscription renewals */}
        {brief?.subs?.length > 0 && (
          <div style={card}>
            <div style={cardTitle}>Renewals This Week</div>
            {brief.subs.map((s, i) => (
              <div key={i} style={item}>
                <div style={itemText}>{s.name}</div>
                <div style={itemMeta}>{s.currency} {s.amount} · due {s.next_due}</div>
              </div>
            ))}
          </div>
        )}

        {/* Upcoming trips */}
        {brief?.trips?.length > 0 && (
          <div style={card}>
            <div style={cardTitle}>Upcoming Trips</div>
            {brief.trips.map((t, i) => (
              <div key={i} style={item}>
                <div style={itemText}>{t.destination}</div>
                <div style={itemMeta}>{t.start_date} → {t.end_date}</div>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {brief && !brief.keeps?.length && !brief.reminders?.length && !brief.subs?.length && !brief.trips?.length && !brief.nudges?.length && (
          <div style={{ ...card, textAlign: 'center', padding: 40 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🌅</div>
            <div style={{ color: '#64748b', fontSize: 15 }}>Your day is clear — nothing on brief right now.</div>
            <a href="/dashboard" style={{ display: 'inline-block', marginTop: 16, color: '#6366f1', fontSize: 14, textDecoration: 'none' }}>Add a keep →</a>
          </div>
        )}

        {/* Share section */}
        <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'stretch' }}>
          <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Share Today's Brief</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={shareThisBrief}
              style={{ flex: 1, padding: '10px 0', background: '#1e293b', color: '#94a3b8', border: '1px solid #334155', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}
            >🔗 Copy Link</button>
            <button
              onClick={shareViaWhatsApp}
              style={{ flex: 1, padding: '10px 0', background: '#14532d', color: '#86efac', border: '1px solid #166534', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}
            >💬 WhatsApp</button>
          </div>
          {shareMsg && <div style={{ color: '#86efac', fontSize: 13, textAlign: 'center' }}>{shareMsg}</div>}
        </div>

      </div>
    </div>
  );
}
// ─────────────────────────────────────────────────────────
// END OF FILE5 BLOCK 2 — this completes daily-brief/page.jsx
// ─────────────────────────────────────────────────────────
