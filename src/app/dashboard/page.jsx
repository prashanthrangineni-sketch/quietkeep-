'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import NavbarClient from '@/components/NavbarClient';

const TYPE_EMOJI = {
  note: '📝',
  reminder: '⏰',
  contact: '📞',
  task: '✅',
};

const STATE_COLOR = {
  open: '#22c55e',
  active: '#3b82f6',
  blocked: '#ef4444',
  deferred: '#f59e0b',
  closed: '#64748b',
};

function parseDateTime(text) {
  const t = text.toLowerCase();
  const now = new Date();
  let date = null;
  if (/\btoday\b/.test(t)) { date = new Date(now); }
  else if (/\btomorrow\b/.test(t)) { date = new Date(now); date.setDate(date.getDate() + 1); }
  else if (/\bday after tomorrow\b/.test(t)) { date = new Date(now); date.setDate(date.getDate() + 2); }
  else if (/\bnext week\b/.test(t)) { date = new Date(now); date.setDate(date.getDate() + 7); }
  const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  for (let i = 0; i < days.length; i++) {
    if (new RegExp('\\b' + days[i] + '\\b').test(t)) {
      date = new Date(now); const diff = (i - now.getDay() + 7) % 7 || 7; date.setDate(date.getDate() + diff); break;
    }
  }
  const monthNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  for (let m = 0; m < monthNames.length; m++) {
    const re1 = new RegExp('(\\d{1,2})(?:st|nd|rd|th)?\\s+' + monthNames[m]);
    const re2 = new RegExp(monthNames[m] + '\\s+(\\d{1,2})');
    const match = t.match(re1) || t.match(re2);
    if (match) { date = new Date(now.getFullYear(), m, parseInt(match[1])); if (date < now) { date.setFullYear(date.getFullYear() + 1); } break; }
  }
  if (!date) { const numDate = t.match(/(\d{1,2})[\/\-](\d{1,2})/); if (numDate) { date = new Date(now.getFullYear(), parseInt(numDate[2]) - 1, parseInt(numDate[1])); if (date < now) { date.setFullYear(date.getFullYear() + 1); } } }
  if (!date) return null;
  let hours = 9, minutes = 0;
  const timeMatch = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  if (timeMatch) { hours = parseInt(timeMatch[1]); minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0; if (timeMatch[3] === 'pm' && hours < 12) hours += 12; if (timeMatch[3] === 'am' && hours === 12) hours = 0; }
  else if (/\bmidnight\b/.test(t)) { hours = 0; minutes = 0; }
  else if (/\bnoon\b|\bmidday\b/.test(t)) { hours = 12; minutes = 0; }
  else if (/\bmorning\b/.test(t)) { hours = 9; }
  else if (/\bafternoon\b/.test(t)) { hours = 14; }
  else if (/\bevening\b/.test(t)) { hours = 18; }
  else if (/\bnight\b/.test(t)) { hours = 20; }
  else { const plainTime = t.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\b/); if (plainTime) { hours = parseInt(plainTime[1]); minutes = plainTime[2] ? parseInt(plainTime[2]) : 0; if (hours < 7) hours += 12; } }
  date.setHours(hours, minutes, 0, 0);
  const pad = n => String(n).padStart(2, '0');
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + 'T' + pad(hours) + ':' + pad(minutes);
}

function detectCategory(text) {
  const t = text.toLowerCase();
  if (/call|ring|phone|contact|whatsapp|message/.test(t)) return 'contact';
  if (/buy|order|get|purchase|pick up|shop/.test(t)) return 'task';
  if (/meet|meeting|appointment|doctor|dentist|interview|call at|remind/.test(t)) return 'reminder';
  return 'note';
}

function getAISuggestions(text) {
  const t = text.toLowerCase();
  const suggestions = [];
  if (/call|ring|phone|contact/.test(t)) { suggestions.push({ icon: '📞', text: 'Set as Contact type', action: 'contact' }); suggestions.push({ icon: '⏰', text: 'Add a reminder to follow up', action: 'reminder' }); }
  if (/tomorrow|tonight|morning|evening|monday|tuesday|wednesday|thursday|friday|weekend/.test(t)) suggestions.push({ icon: '⏰', text: 'Set a reminder for this', action: 'reminder' });
  if (/buy|order|get|purchase|pick up/.test(t)) suggestions.push({ icon: '🛒', text: 'Mark as a task to complete', action: 'task' });
  if (/meet|meeting|appointment|doctor|dentist|interview/.test(t)) suggestions.push({ icon: '📅', text: 'Add to reminders with time', action: 'reminder' });
  if (/idea|think|consider|maybe|what if/.test(t)) suggestions.push({ icon: '💡', text: 'Save as a note to revisit', action: 'note' });
  if (/email|send|reply|respond/.test(t)) suggestions.push({ icon: '📧', text: 'Add contact info', action: 'contact' });
  return suggestions.slice(0, 2);
}

function IntentCard({ intent, onUpdateState, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const emoji = TYPE_EMOJI[intent.intent_type] || '📝';
  const color = STATE_COLOR[intent.status] || '#22c55e';
  const isClosed = intent.status === 'closed';
  return (
    <div style={{ backgroundColor: '#0f0f1a', border: '1px solid ' + (isClosed ? '#1a1a2e' : '#1e1e2e'), borderRadius: '12px', padding: '14px', opacity: isClosed ? 0.5 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        <span style={{ fontSize: '18px', flexShrink: 0 }}>{emoji}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '14px', color: '#f1f5f9', lineHeight: '1.4', wordBreak: 'break-word', textDecoration: isClosed ? 'line-through' : 'none' }}>{intent.content}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '10px', color: color, fontWeight: '600', textTransform: 'uppercase' }}>{intent.status}</span>
            <span style={{ fontSize: '10px', color: '#334155' }}>{intent.intent_type}</span>
            {intent.reminder_at && <span style={{ fontSize: '10px', color: '#6366f1' }}>⏰ {new Date(intent.reminder_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>}
            <span style={{ fontSize: '10px', color: '#1e293b' }}>{new Date(intent.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
          </div>
        </div>
        <button onClick={() => setExpanded(!expanded)} style={{ background: 'none', border: 'none', color: '#334155', cursor: 'pointer', fontSize: '18px', flexShrink: 0, padding: '0 4px' }}>{expanded ? '▲' : '▼'}</button>
      </div>
      {expanded && (
        <div style={{ marginTop: '12px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {!isClosed && <button onClick={() => onUpdateState(intent.id, 'closed')} style={{ padding: '6px 12px', borderRadius: '7px', border: '1px solid #22c55e', backgroundColor: 'rgba(34,197,94,0.1)', color: '#22c55e', fontSize: '12px', cursor: 'pointer', fontWeight: '600' }}>✓ Done</button>}
          {isClosed && <button onClick={() => onUpdateState(intent.id, 'open')} style={{ padding: '6px 12px', borderRadius: '7px', border: '1px solid #6366f1', backgroundColor: 'rgba(99,102,241,0.1)', color: '#a5b4fc', fontSize: '12px', cursor: 'pointer' }}>↩ Reopen</button>}
          <button onClick={() => onDelete(intent.id)} style={{ padding: '6px 12px', borderRadius: '7px', border: '1px solid #ef444460', backgroundColor: 'rgba(239,68,68,0.08)', color: '#ef4444', fontSize: '12px', cursor: 'pointer' }}>🗑 Delete</button>
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [intents, setIntents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState('');
  const [remindAt, setRemindAt] = useState('');
  const [contactInfo, setContactInfo] = useState('');
  const [assistMode, setAssistMode] = useState('note');
  const [reminderType, setReminderType] = useState('app');
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('open');
  const [listening, setListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [toast, setToast] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [autoDetected, setAutoDetected] = useState(null);
  const recognitionRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => { setVoiceSupported('webkitSpeechRecognition' in window || 'SpeechRecognition' in window); }, []);
  useEffect(() => { if (content.length > 5) setSuggestions(getAISuggestions(content)); else setSuggestions([]); }, [content]);

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(''), 2800); }

  function startVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const recognition = new SR();
    recognition.lang = 'en-IN'; recognition.continuous = false; recognition.interimResults = true;
    recognitionRef.current = recognition;
    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognition.onresult = (e) => {
      const transcript = Array.from(e.results).map(r => r[0].transcript).join('');
      setContent(transcript);
      const detectedDate = parseDateTime(transcript);
      const detectedCategory = detectCategory(transcript);
      const detected = [];
      if (detectedDate) { setRemindAt(detectedDate); detected.push('reminder time'); }
      if (detectedCategory !== 'note') { setAssistMode(detectedCategory); detected.push('type -> ' + detectedCategory); }
      if (detected.length > 0) { setAutoDetected(detected.join(' / ')); setTimeout(() => setAutoDetected(null), 4000); }
    };
    recognition.start();
  }

  function stopVoice() { recognitionRef.current?.stop(); setListening(false); }

  function handleContentChange(val) {
    setContent(val);
    if (val.length > 8) {
      const detectedDate = parseDateTime(val);
      if (detectedDate && !remindAt) { setRemindAt(detectedDate); setAutoDetected('reminder time auto-detected'); setTimeout(() => setAutoDetected(null), 3000); }
    }
  }

  const loadIntents = useCallback(async (uid) => {
    const { data, error } = await supabase.from('keeps').select('*').eq('user_id', uid).order('created_at', { ascending: false });
    if (!error && data) setIntents(data);
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) { router.replace('/login'); return; }
      setUser(user);
      loadIntents(user.id).finally(() => setLoading(false));
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') router.replace('/');
    });
    return () => subscription.unsubscribe();
  }, [router, loadIntents]);

  async function handleSave() {
    if (!content.trim() || !user) return;
    setSaving(true);
    try {
      await fetch('/api/parse-intent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: content.trim(), user_id: user.id }) });
    } catch (e) { /* parser optional */ }
    const { error } = await supabase.from('keeps').insert({
      user_id: user.id, content: content.trim(), status: 'open',
      intent_type: assistMode, voice_text: null,
      reminder_at: remindAt || null, color: '#6366f1',
      show_on_brief: true, is_pinned: false,
    });
    if (!error) {
      setContent(''); setRemindAt(''); setContactInfo(''); setReminderType('app'); setSuggestions([]); setAutoDetected(null);
      showToast('Kept!');
      await loadIntents(user.id);
    } else {
      showToast('Error: ' + error.message);
    }
    setSaving(false);
  }

  async function updateState(id, state) {
    await supabase.from('keeps').update({ status: state }).eq('id', id);
    showToast(state === 'closed' ? 'Marked done!' : 'Moved to ' + state);
    await loadIntents(user.id);
  }

  async function handleDelete(id) {
    await supabase.from('keeps').delete().eq('id', id);
    showToast('Deleted');
    await loadIntents(user.id);
  }

  const openIntents = intents.filter(i => i.status !== 'closed');
  const closedIntents = intents.filter(i => i.status === 'closed');

  const filterIntents = (list) => {
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter(i => i.content?.toLowerCase().includes(q) || i.intent_type?.toLowerCase().includes(q) || i.status?.toLowerCase().includes(q));
  };
  const displayIntents = filterIntents(activeTab === 'open' ? openIntents : closedIntents);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '16px' }}>
        <div style={{ width: '40px', height: '40px', border: '3px solid #6366f1', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
        <span style={{ color: '#475569', fontSize: '14px' }}>Loading your keeps...</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <>
      <NavbarClient />
      <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', color: '#f1f5f9' }}>
        {toast && (
          <div style={{ position: 'fixed', top: '70px', left: '50%', transform: 'translateX(-50%)', backgroundColor: '#1e1e2e', border: '1px solid #6366f1', borderRadius: '10px', padding: '10px 20px', color: '#f1f5f9', fontSize: '14px', zIndex: 9999, boxShadow: '0 4px 24px rgba(99,102,241,0.3)', whiteSpace: 'nowrap' }}>
            {toast}
          </div>
        )}
        <div style={{ borderBottom: '1px solid #1e1e2e', padding: '10px 16px', backgroundColor: 'rgba(10,10,15,0.98)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontWeight: '700', fontSize: '14px', color: '#6366f1' }}>My Keeps</span>
            <span style={{ fontSize: '10px', color: '#334155' }}>{user?.email}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <a href="/calendar" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: '11px', padding: '5px 10px', border: '1px solid #1e293b', borderRadius: '6px' }}>Calendar</a>
            <a href="/daily-brief" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: '11px', padding: '5px 10px', border: '1px solid #1e293b', borderRadius: '6px' }}>Brief</a>
            <a href="/documents" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: '11px', padding: '5px 10px', border: '1px solid #1e293b', borderRadius: '6px' }}>Docs</a>
            <a href="/finance" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: '11px', padding: '5px 10px', border: '1px solid #1e293b', borderRadius: '6px' }}>Finance</a>
            <a href="/settings" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: '11px', padding: '5px 10px', border: '1px solid #1e293b', borderRadius: '6px' }}>Settings</a>
            <a href="/profile" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: '11px', padding: '5px 10px', border: '1px solid #1e293b', borderRadius: '6px' }}>Profile</a>
            <button onClick={() => supabase.auth.signOut()} style={{ backgroundColor: 'transparent', border: '1px solid #1e293b', color: '#64748b', padding: '5px 10px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer' }}>Sign Out</button>
          </div>
        </div>

        <div style={{ maxWidth: '680px', margin: '0 auto', padding: '20px 16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '10px', marginBottom: '20px' }}>
            {[{ label: 'Open', value: openIntents.length, color: '#6366f1' },{ label: 'Done', value: closedIntents.length, color: '#22c55e' },{ label: 'Total', value: intents.length, color: '#94a3b8' }].map((s, i) => (
              <div key={i} style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e1e2e', borderRadius: '12px', padding: '14px', textAlign: 'center' }}>
                <div style={{ fontSize: '28px', fontWeight: '800', color: s.color }}>{s.value}</div>
                <div style={{ fontSize: '11px', color: '#475569', marginTop: '2px' }}>{s.label}</div>
              </div>
            ))}
          </div>

          <div style={{ backgroundColor: '#0f0f1a', border: '1px solid #1e1e2e', borderRadius: '16px', padding: '18px', marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <span style={{ fontSize: '11px', fontWeight: '700', color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.08em' }}>+ New Keep</span>
              {voiceSupported && (
                <button onClick={listening ? stopVoice : startVoice} style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: listening ? 'rgba(239,68,68,0.15)' : 'rgba(99,102,241,0.15)', border: '1px solid ' + (listening ? 'rgba(239,68,68,0.4)' : 'rgba(99,102,241,0.4)'), color: listening ? '#ef4444' : '#a5b4fc', padding: '7px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
                  {listening ? 'Stop' : '🎙 Voice'}
                </button>
              )}
            </div>
            {listening && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '8px', padding: '8px 12px' }}>
                <span style={{ width: '8px', height: '8px', backgroundColor: '#ef4444', borderRadius: '50%', display: 'inline-block', animation: 'pulse 1s ease infinite' }} />
                <span style={{ fontSize: '12px', color: '#ef4444' }}>Listening... say date/time e.g. &quot;tomorrow 3pm&quot;</span>
              </div>
            )}
            {autoDetected && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', backgroundColor: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: '8px', padding: '8px 12px' }}>
                <span style={{ fontSize: '12px', color: '#a5b4fc' }}>Auto-detected: {autoDetected}</span>
              </div>
            )}
            <textarea ref={textareaRef} value={content} onChange={e => handleContentChange(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) handleSave(); }} placeholder="What do you want to keep..." rows={3} style={{ width: '100%', backgroundColor: '#0a0a0f', border: '1px solid ' + (content ? '#6366f150' : '#1e293b'), borderRadius: '10px', padding: '12px', color: '#f1f5f9', fontSize: '15px', resize: 'none', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', lineHeight: '1.5' }} />
            {suggestions.length > 0 && (
              <div style={{ marginTop: '10px' }}>
                <div style={{ fontSize: '11px', color: '#475569', marginBottom: '6px' }}>Smart suggestions:</div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {suggestions.map((s, i) => (
                    <button key={i} onClick={() => { setAssistMode(s.action); showToast('Set to ' + s.action); }} style={{ backgroundColor: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)', color: '#a5b4fc', padding: '6px 12px', borderRadius: '8px', fontSize: '12px', cursor: 'pointer', fontWeight: '500' }}>
                      {s.icon} {s.text}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '12px' }}>
              <div>
                <label style={{ fontSize: '11px', color: '#475569', display: 'block', marginBottom: '5px' }}>Remind at {remindAt && <span style={{ color: '#6366f1' }}>set</span>}</label>
                <input type="datetime-local" value={remindAt} onChange={e => setRemindAt(e.target.value)} style={{ width: '100%', backgroundColor: remindAt ? 'rgba(99,102,241,0.05)' : '#0a0a0f', border: '1px solid ' + (remindAt ? '#6366f150' : '#1e293b'), borderRadius: '8px', padding: '8px', color: '#f1f5f9', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: '11px', color: '#475569', display: 'block', marginBottom: '5px' }}>Type</label>
                <select value={assistMode} onChange={e => setAssistMode(e.target.value)} style={{ width: '100%', backgroundColor: '#0a0a0f', border: '1px solid #1e293b', borderRadius: '8px', padding: '8px', color: '#f1f5f9', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }}>
                  <option value="note">Note</option>
                  <option value="reminder">Reminder</option>
                  <option value="contact">Contact</option>
                  <option value="task">Task</option>
                </select>
              </div>
            </div>
            {remindAt && (
              <div style={{ marginTop: '12px' }}>
                <label style={{ fontSize: '11px', color: '#475569', display: 'block', marginBottom: '8px' }}>How to remind you?</label>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {[{ value: 'app', label: 'App' },{ value: 'alarm', label: 'Alarm' },{ value: 'whatsapp', label: 'WhatsApp' },{ value: 'email', label: 'Email' }].map(opt => (
                    <button key={opt.value} onClick={() => setReminderType(opt.value)} style={{ padding: '7px 12px', borderRadius: '8px', cursor: 'pointer', border: '1px solid ' + (reminderType === opt.value ? '#6366f1' : '#1e293b'), backgroundColor: reminderType === opt.value ? 'rgba(99,102,241,0.15)' : '#0a0a0f', color: reminderType === opt.value ? '#a5b4fc' : '#64748b', fontSize: '12px', fontWeight: reminderType === opt.value ? '600' : '400' }}>
                      {opt.label}
                    </button>
                  ))}
                </div>
                {reminderType === 'whatsapp' && <div style={{ marginTop: '8px', fontSize: '11px', color: '#f59e0b', padding: '6px 10px', backgroundColor: 'rgba(245,158,11,0.08)', borderRadius: '6px', border: '1px solid rgba(245,158,11,0.2)' }}>WhatsApp reminder opens a draft at reminder time. You tap Send.</div>}
                {reminderType === 'alarm' && <div style={{ marginTop: '8px', fontSize: '11px', color: '#22c55e', padding: '6px 10px', backgroundColor: 'rgba(34,197,94,0.08)', borderRadius: '6px', border: '1px solid rgba(34,197,94,0.2)' }}>Rings even if phone is on silent.</div>}
              </div>
            )}
            {assistMode === 'contact' && (
              <input type="text" value={contactInfo} onChange={e => setContactInfo(e.target.value)} placeholder="Phone / Email / Notes..." style={{ width: '100%', marginTop: '10px', backgroundColor: '#0a0a0f', border: '1px solid #1e293b', borderRadius: '8px', padding: '9px 12px', color: '#f1f5f9', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
            )}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '14px' }}>
              <span style={{ fontSize: '11px', color: '#1e293b' }}>Ctrl+Enter to save</span>
              <button onClick={handleSave} disabled={saving || !content.trim()} style={{ backgroundColor: saving || !content.trim() ? '#1a1a2e' : '#6366f1', color: saving || !content.trim() ? '#334155' : '#fff', border: 'none', padding: '10px 24px', borderRadius: '8px', fontSize: '14px', fontWeight: '600', cursor: saving || !content.trim() ? 'not-allowed' : 'pointer' }}>
                {saving ? 'Saving...' : '+ Keep this'}
              </button>
            </div>
          </div>

          <div style={{ marginBottom: '14px', position: 'relative' }}>
            <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search your keeps..." style={{ width: '100%', backgroundColor: '#0f0f1a', border: '1px solid #1e1e2e', borderRadius: '10px', padding: '10px 14px', color: '#f1f5f9', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
            {searchQuery && <button onClick={() => setSearchQuery('')} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: '16px' }}>&times;</button>}
          </div>

          <div style={{ display: 'flex', gap: '4px', marginBottom: '14px', backgroundColor: '#0f0f1a', padding: '4px', borderRadius: '10px', border: '1px solid #1e1e2e' }}>
            {[{ key: 'open', label: 'Open (' + openIntents.length + ')' },{ key: 'closed', label: 'Done (' + closedIntents.length + ')' }].map(tab => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{ flex: 1, padding: '9px', borderRadius: '7px', border: 'none', cursor: 'pointer', backgroundColor: activeTab === tab.key ? '#6366f1' : 'transparent', color: activeTab === tab.key ? '#fff' : '#64748b', fontSize: '13px', fontWeight: '600' }}>
                {tab.label}
              </button>
            ))}
          </div>

          {displayIntents.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 24px', border: '1px dashed #1e293b', borderRadius: '14px', color: '#334155' }}>
              <div style={{ fontSize: '32px', marginBottom: '10px' }}>{activeTab === 'open' ? '🎙' : '✅'}</div>
              <div>{activeTab === 'open' ? 'Tap Voice or type to add your first keep' : 'No completed keeps yet'}</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {displayIntents.map(intent => (
                <IntentCard key={intent.id} intent={intent} onUpdateState={updateState} onDelete={handleDelete} />
              ))}
            </div>
          )}
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } } @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
      </div>
    </>
  );
    }
