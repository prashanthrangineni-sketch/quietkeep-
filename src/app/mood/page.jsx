'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import NavbarClient from '@/components/NavbarClient';

const MOODS = [
  { value: 5, emoji: '😄', label: 'Great', color: '#4ade80' },
  { value: 4, emoji: '🙂', label: 'Good',  color: '#86efac' },
  { value: 3, emoji: '😐', label: 'Okay',  color: '#fbbf24' },
  { value: 2, emoji: '😕', label: 'Low',   color: '#fb923c' },
  { value: 1, emoji: '😞', label: 'Bad',   color: '#f87171' },
];

function moodMeta(v) { return MOODS.find(m => m.value === v) || MOODS[2]; }

function fmt(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function dayLabel(ts) {
  const d = new Date(ts);
  const today = new Date(); today.setHours(0,0,0,0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate()-1);
  const dd = new Date(d); dd.setHours(0,0,0,0);
  if (dd.getTime() === today.getTime()) return 'Today';
  if (dd.getTime() === yesterday.getTime()) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });
}

export default function MoodPage() {
  const [user, setUser] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedMood, setSelectedMood] = useState(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleting, setDeleting] = useState(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) { setUser(user); loadLogs(user.id); }
    });
  }, []);

  async function loadLogs(uid) {
    setLoading(true);
    const { data } = await supabase
      .from('mood_logs')
      .select('*')
      .eq('user_id', uid)
      .order('logged_at', { ascending: false })
      .limit(60);
    setLogs(data || []);
    setLoading(false);
  }

  async function logMood() {
    if (!selectedMood || !user) return;
    setSaving(true);
    const { error } = await supabase.from('mood_logs').insert({
      user_id: user.id,
      mood: selectedMood,
      note: note.trim() || null,
      logged_at: new Date().toISOString(),
    });
    setSaving(false);
    if (!error) {
      setSaved(true);
      setSelectedMood(null);
      setNote('');
      loadLogs(user.id);
      setTimeout(() => setSaved(false), 2000);
    }
  }

  async function deleteLog(id) {
    setDeleting(id);
    await supabase.from('mood_logs').delete().eq('id', id);
    setLogs(l => l.filter(x => x.id !== id));
    setDeleting(null);
  }

  // Group logs by day
  const grouped = logs.reduce((acc, log) => {
    const key = new Date(log.logged_at).toDateString();
    if (!acc[key]) acc[key] = { label: dayLabel(log.logged_at), items: [] };
    acc[key].items.push(log);
    return acc;
  }, {});

  // 7-day average
  const week = logs.filter(l => new Date(l.logged_at) > new Date(Date.now() - 7*24*60*60*1000));
  const avg = week.length ? (week.reduce((s,l) => s+l.mood, 0) / week.length).toFixed(1) : null;

  return (
    <>
      <NavbarClient />
      <div style={{ minHeight:'100vh', background:'#0d0d16', color:'#f0f0f5', fontFamily:"'DM Sans', -apple-system, sans-serif", paddingBottom:'80px', paddingTop:'96px' }}>

      {/* Header */}
      <div style={{ background:'linear-gradient(135deg,#0d0a1a,#0a0d16)', borderBottom:'1px solid rgba(167,139,250,0.15)', padding:'20px 16px 16px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'4px' }}>
          <span style={{ fontSize:'22px' }}>🌊</span>
          <h1 style={{ margin:0, fontSize:'20px', fontWeight:700, color:'#fff', letterSpacing:'-0.3px' }}>Mood Log</h1>
        </div>
        <p style={{ margin:0, fontSize:'13px', color:'rgba(255,255,255,0.4)' }}>Track how you feel, every day</p>
      </div>

      {/* 7-day summary strip */}
      {avg && (
        <div style={{ margin:'16px 16px 0', background:'rgba(167,139,250,0.08)', border:'1px solid rgba(167,139,250,0.2)', borderRadius:'12px', padding:'12px 16px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <div style={{ fontSize:'11px', color:'rgba(255,255,255,0.4)', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:'4px' }}>7-day average</div>
            <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
              <span style={{ fontSize:'24px' }}>{moodMeta(Math.round(parseFloat(avg))).emoji}</span>
              <span style={{ fontSize:'22px', fontWeight:700, color:moodMeta(Math.round(parseFloat(avg))).color }}>{avg}</span>
              <span style={{ fontSize:'13px', color:'rgba(255,255,255,0.4)' }}>/ 5</span>
            </div>
          </div>
          <div style={{ display:'flex', gap:'4px', alignItems:'flex-end', height:'40px' }}>
            {week.slice(0,7).reverse().map((l, i) => {
              const m = moodMeta(l.mood);
              return (
                <div key={i} style={{ width:'10px', background:m.color, borderRadius:'3px 3px 0 0', height:`${(l.mood/5)*36}px`, opacity:0.7 }} />
              );
            })}
          </div>
        </div>
      )}

      {/* Log mood card */}
      <div style={{ margin:'16px', background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:'16px', padding:'18px' }}>
        <p style={{ margin:'0 0 14px', fontSize:'14px', color:'rgba(255,255,255,0.7)', fontWeight:500 }}>
          How are you feeling right now?
        </p>

        {/* Mood selector */}
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'16px' }}>
          {MOODS.map(m => (
            <button
              key={m.value}
              onClick={() => setSelectedMood(m.value)}
              style={{
                flex:1, marginRight: m.value > 1 ? '0' : '0',
                padding:'10px 4px',
                background: selectedMood === m.value ? `${m.color}22` : 'rgba(255,255,255,0.04)',
                border: selectedMood === m.value ? `1.5px solid ${m.color}` : '1.5px solid rgba(255,255,255,0.08)',
                borderRadius:'12px',
                cursor:'pointer',
                display:'flex', flexDirection:'column', alignItems:'center', gap:'4px',
                margin:'0 3px', transition:'all 0.15s',
                transform: selectedMood === m.value ? 'scale(1.08)' : 'scale(1)'
              }}
            >
              <span style={{ fontSize:'22px' }}>{m.emoji}</span>
              <span style={{ fontSize:'10px', color: selectedMood === m.value ? m.color : 'rgba(255,255,255,0.4)', fontFamily:'inherit' }}>{m.label}</span>
            </button>
          ))}
        </div>

        {/* Note input */}
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="Add a note (optional)..."
          rows={2}
          style={{
            width:'100%', padding:'10px 12px', background:'rgba(255,255,255,0.06)',
            border:'1px solid rgba(255,255,255,0.1)', borderRadius:'10px',
            color:'#fff', fontSize:'13px', fontFamily:'inherit', resize:'vertical',
            outline:'none', boxSizing:'border-box', marginBottom:'12px'
          }}
        />

        <button
          onClick={logMood}
          disabled={!selectedMood || saving}
          style={{
            width:'100%', padding:'12px',
            background: !selectedMood ? 'rgba(255,255,255,0.05)' : saved ? 'rgba(74,222,128,0.3)' : 'rgba(167,139,250,0.3)',
            border: !selectedMood ? '1px solid rgba(255,255,255,0.1)' : saved ? '1px solid rgba(74,222,128,0.5)' : '1px solid rgba(167,139,250,0.5)',
            borderRadius:'10px', color: !selectedMood ? 'rgba(255,255,255,0.3)' : '#fff',
            fontSize:'14px', fontWeight:600, cursor: !selectedMood ? 'not-allowed' : 'pointer', fontFamily:'inherit'
          }}
        >
          {saved ? '✓ Logged!' : saving ? 'Saving...' : 'Log Mood'}
        </button>
      </div>

      {/* History */}
      <div style={{ padding:'0 16px' }}>
        <p style={{ margin:'0 0 12px', fontSize:'11px', color:'rgba(255,255,255,0.35)', textTransform:'uppercase', letterSpacing:'0.8px' }}>
          History
        </p>

        {loading && <div style={{ textAlign:'center', padding:'30px', color:'rgba(255,255,255,0.3)', fontSize:'13px' }}>Loading...</div>}

        {!loading && logs.length === 0 && (
          <div style={{ textAlign:'center', padding:'40px 20px', background:'rgba(255,255,255,0.03)', border:'1px dashed rgba(255,255,255,0.1)', borderRadius:'16px' }}>
            <div style={{ fontSize:'36px', marginBottom:'10px' }}>🌱</div>
            <p style={{ margin:0, fontSize:'14px', color:'rgba(255,255,255,0.4)' }}>No mood logs yet. Start tracking today!</p>
          </div>
        )}

        {Object.values(grouped).map((group, gi) => (
          <div key={gi} style={{ marginBottom:'20px' }}>
            <p style={{ margin:'0 0 8px', fontSize:'11px', color:'rgba(255,255,255,0.35)', textTransform:'uppercase', letterSpacing:'0.5px' }}>
              {group.label}
            </p>
            {group.items.map(log => {
              const m = moodMeta(log.mood);
              return (
                <div key={log.id} style={{
                  display:'flex', alignItems:'center', gap:'12px',
                  background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.07)',
                  borderLeft:`3px solid ${m.color}`, borderRadius:'10px', padding:'11px 12px',
                  marginBottom:'8px'
                }}>
                  <span style={{ fontSize:'22px', flexShrink:0 }}>{m.emoji}</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                      <span style={{ fontSize:'13px', fontWeight:600, color:m.color }}>{m.label}</span>
                      <span style={{ fontSize:'11px', color:'rgba(255,255,255,0.3)' }}>{new Date(log.logged_at).toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' })}</span>
                    </div>
                    {log.note && <p style={{ margin:'3px 0 0', fontSize:'12px', color:'rgba(255,255,255,0.5)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{log.note}</p>}
                  </div>
                  <button
                    onClick={() => deleteLog(log.id)}
                    disabled={deleting === log.id}
                    style={{ background:'none', border:'none', color:'rgba(255,255,255,0.2)', cursor:'pointer', fontSize:'14px', padding:'4px' }}
                  >
                    {deleting === log.id ? '...' : '✕'}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <style>{`
        textarea::placeholder, input::placeholder { color: rgba(255,255,255,0.25); }
        textarea:focus { border-color: rgba(167,139,250,0.4) !important; }
      `}</style>
    </div>
    </>
  );
                      }
