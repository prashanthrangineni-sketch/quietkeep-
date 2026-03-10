// File: src/app/health/page.jsx  NEW FILE — Health Log Streak Tracker (Sprint 1, Step 10)
'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import NavbarClient from '@/components/NavbarClient';

const inp = { width:'100%', background:'#111', border:'1px solid #333', borderRadius:8, color:'#fff', padding:'0.6rem 0.75rem', fontSize:'0.88rem', outline:'none', boxSizing:'border-box' };
const btn1 = { padding:'0.6rem 1.2rem', borderRadius:8, border:'none', background:'#6366f1', color:'#fff', fontSize:'0.88rem', fontWeight:600, cursor:'pointer' };

function today() { return new Date().toISOString().split('T')[0]; }
function weekAgo() { const d = new Date(); d.setDate(d.getDate()-6); return d.toISOString().split('T')[0]; }
function fmtDate(d) { return new Date(d+'T00:00:00').toLocaleDateString('en-IN', { weekday:'short', day:'numeric', month:'short' }); }
function calcStreak(logs) {
  if (!logs.length) return 0;
  const sorted = [...logs].sort((a,b) => new Date(b.log_date) - new Date(a.log_date));
  let streak = 0; const t = today();
  for (let i = 0; i < sorted.length; i++) {
    const expected = new Date(t); expected.setDate(expected.getDate() - i);
    const ex = expected.toISOString().split('T')[0];
    if (sorted[i].log_date === ex) streak++; else break;
  }
  return streak;
}

export default function HealthPage() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState([]);
  const [todayLog, setTodayLog] = useState(null);
  const [saving, setSaving] = useState(false);
  const [water, setWater] = useState(0);
  const [sleep, setSleep] = useState('');
  const [exercise, setExercise] = useState(0);
  const [notes, setNotes] = useState('');
  const [insight, setInsight] = useState('');
  const [loadingInsight, setLoadingInsight] = useState(false);

  useEffect(() => { init(); }, []);

  async function init() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { window.location.href = '/login'; return; }
    setUser(user);
    const { data } = await supabase.from('health_logs').select('*').eq('user_id', user.id).gte('log_date', weekAgo()).order('log_date', { ascending: false });
    const logs7 = data || [];
    setLogs(logs7);
    const t = logs7.find(l => l.log_date === today());
    if (t) { setTodayLog(t); setWater(t.water_glasses); setSleep(t.sleep_hours||''); setExercise(t.exercise_minutes||0); setNotes(t.notes||''); }
    setLoading(false);
  }

  async function saveLog() {
    if (!user) return;
    setSaving(true);
    const payload = { user_id: user.id, log_date: today(), water_glasses: water, sleep_hours: parseFloat(sleep)||0, exercise_minutes: exercise, notes: notes||null };
    let data;
    if (todayLog) {
      const res = await supabase.from('health_logs').update(payload).eq('id', todayLog.id).select().single();
      data = res.data;
    } else {
      const res = await supabase.from('health_logs').insert(payload).select().single();
      data = res.data;
    }
    if (data) {
      setTodayLog(data);
      setLogs(p => todayLog ? p.map(l => l.id === todayLog.id ? data : l) : [data, ...p]);
    }
    setSaving(false);
  }

  async function getAIInsight() {
    if (logs.length < 3) { setInsight('Log at least 3 days to get AI insights.'); return; }
    setLoadingInsight(true); setInsight('');
    const summary = logs.slice(0,7).map(l => `${l.log_date}: water=${l.water_glasses}gl, sleep=${l.sleep_hours}h, exercise=${l.exercise_minutes}min`).join('\n');
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method:'POST',
        headers:{ 'Content-Type':'application/json', 'x-api-key': '', 'anthropic-version':'2023-06-01' },
        body:JSON.stringify({ model:'claude-haiku-4-5-20251001', max_tokens:150, messages:[{ role:'user', content:`User health data last 7 days:\n${summary}\n\nGive 1 short actionable health tip (2 sentences max) based on patterns. Be specific and warm.` }] })
      });
      const d = await res.json();
      setInsight(d?.content?.[0]?.text || 'Keep logging consistently for better insights!');
    } catch { setInsight('Log a few more days for personalized insights.'); }
    setLoadingInsight(false);
  }

  const streak = calcStreak(logs);
  const avgSleep = logs.length ? (logs.reduce((s,l) => s + parseFloat(l.sleep_hours||0), 0) / logs.length).toFixed(1) : 0;
  const avgWater = logs.length ? Math.round(logs.reduce((s,l) => s + (l.water_glasses||0), 0) / logs.length) : 0;
  const avgExercise = logs.length ? Math.round(logs.reduce((s,l) => s + (l.exercise_minutes||0), 0) / logs.length) : 0;

  if (loading) return (<div style={{ minHeight:'100vh', background:'#0f0f0f', display:'flex', alignItems:'center', justifyContent:'center' }}><div style={{ color:'#6366f1' }}>Loading…</div></div>);

  return (
    <div style={{ minHeight:'100vh', background:'#0f0f0f', color:'#fff', paddingTop:'96px', paddingBottom:'80px' }}>
      <NavbarClient />
      <div style={{ maxWidth:640, margin:'0 auto', padding:'1.5rem 1rem 5rem' }}>

        {/* Header + Streak */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'1.5rem' }}>
          <div>
            <h1 style={{ fontSize:'1.4rem', fontWeight:700, marginBottom:4 }}>🏃 Health Log</h1>
            <p style={{ color:'#555', fontSize:'0.85rem' }}>Track daily wellness streak</p>
          </div>
          <div style={{ textAlign:'center', background: streak >= 7 ? '#f59e0b15' : '#6366f110', border:`1px solid ${streak >= 7 ? '#f59e0b40' : '#6366f130'}`, borderRadius:12, padding:'0.6rem 1rem' }}>
            <div style={{ fontSize:'1.5rem', fontWeight:800, color: streak >= 7 ? '#f59e0b' : '#6366f1' }}>{streak}</div>
            <div style={{ fontSize:'0.7rem', color:'#666' }}>{streak === 1 ? 'day streak' : 'day streak'} {streak >= 7 ? '🔥' : streak >= 3 ? '✨' : '💪'}</div>
          </div>
        </div>

        {/* 7-day stats */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'0.75rem', marginBottom:'1.5rem' }}>
          {[['💧', 'Avg Water', avgWater + ' glasses'], ['😴', 'Avg Sleep', avgSleep + ' hrs'], ['🏃', 'Avg Exercise', avgExercise + ' min']].map(([e,l,v]) => (
            <div key={l} style={{ background:'#1a1a1a', border:'1px solid #222', borderRadius:10, padding:'0.75rem', textAlign:'center' }}>
              <div style={{ fontSize:'1.3rem', marginBottom:4 }}>{e}</div>
              <div style={{ fontSize:'0.7rem', color:'#555', marginBottom:2 }}>{l}</div>
              <div style={{ fontSize:'0.95rem', fontWeight:700 }}>{v}</div>
            </div>
          ))}
        </div>

        {/* Today's log */}
        <div style={{ background:'#1a1a1a', border:'1px solid #2a2a2a', borderRadius:12, padding:'1.2rem', marginBottom:'1.5rem' }}>
          <h3 style={{ fontSize:'0.9rem', fontWeight:700, marginBottom:'1rem', color:'#aaa' }}>Today — {fmtDate(today())}</h3>
          
          <div style={{ marginBottom:'1rem' }}>
            <label style={{ color:'#666', fontSize:'0.78rem', display:'block', marginBottom:6 }}>💧 Water intake — {water} glasses</label>
            <div style={{ display:'flex', gap:'6px', flexWrap:'wrap' }}>
              {[0,1,2,3,4,5,6,7,8].map(n => (
                <button key={n} onClick={() => setWater(n)} style={{ width:36, height:36, borderRadius:8, border:`1px solid ${water>=n&&n>0 ? '#06b6d4' : '#333'}`, background: water>=n&&n>0 ? '#06b6d415' : 'transparent', color: water>=n&&n>0 ? '#06b6d4' : '#555', fontSize:'0.8rem', cursor:'pointer', fontWeight:600 }}>{n||'0'}</button>
              ))}
            </div>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem', marginBottom:'0.75rem' }}>
            <div>
              <label style={{ color:'#666', fontSize:'0.78rem', display:'block', marginBottom:4 }}>😴 Sleep hours</label>
              <input style={inp} type="number" min="0" max="12" step="0.5" placeholder="e.g. 7.5" value={sleep} onChange={e => setSleep(e.target.value)} />
            </div>
            <div>
              <label style={{ color:'#666', fontSize:'0.78rem', display:'block', marginBottom:4 }}>🏃 Exercise (minutes)</label>
              <input style={inp} type="number" min="0" max="300" placeholder="e.g. 30" value={exercise} onChange={e => setExercise(parseInt(e.target.value)||0)} />
            </div>
          </div>

          <div style={{ marginBottom:'1rem' }}>
            <label style={{ color:'#666', fontSize:'0.78rem', display:'block', marginBottom:4 }}>📝 Notes</label>
            <input style={inp} placeholder="How are you feeling today?" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>

          <button onClick={saveLog} disabled={saving} style={{ ...btn1, width:'100%', opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Saving…' : todayLog ? '✓ Update Today\'s Log' : '+ Log Today'}
          </button>
        </div>

        {/* AI Insight */}
        <div style={{ background:'#0d0d1a', border:'1px solid #6366f130', borderRadius:12, padding:'1rem', marginBottom:'1.5rem' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.6rem' }}>
            <span style={{ color:'#818cf8', fontSize:'0.85rem', fontWeight:700 }}>✨ AI Weekly Insight</span>
            <button onClick={getAIInsight} disabled={loadingInsight} style={{ ...btn1, fontSize:'0.75rem', padding:'0.35rem 0.75rem', opacity: loadingInsight ? 0.6 : 1 }}>{loadingInsight ? 'Thinking…' : 'Get Insight'}</button>
          </div>
          {insight ? <p style={{ color:'#94a3b8', fontSize:'0.82rem', lineHeight:1.6, margin:0 }}>{insight}</p>
            : <p style={{ color:'#444', fontSize:'0.8rem', margin:0 }}>Log 3+ days then tap "Get Insight" for a personalized tip.</p>}
        </div>

        {/* 7-day history */}
        {logs.length > 0 && (
          <div>
            <h3 style={{ fontSize:'0.85rem', fontWeight:700, color:'#555', marginBottom:'0.75rem' }}>Last 7 Days</h3>
            <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
              {logs.map(log => (
                <div key={log.id} style={{ background:'#1a1a1a', border:'1px solid #222', borderRadius:10, padding:'0.7rem 1rem', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <div style={{ fontSize:'0.8rem', color:'#aaa' }}>{fmtDate(log.log_date)}</div>
                  <div style={{ display:'flex', gap:'1rem', fontSize:'0.78rem', color:'#666' }}>
                    <span>💧{log.water_glasses||0}</span>
                    <span>😴{log.sleep_hours||0}h</span>
                    <span>🏃{log.exercise_minutes||0}m</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
