'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import NavbarClient from '@/components/NavbarClient';
import ContextCards from '@/components/ContextCards';
import KeepAIAssist from '@/components/KeepAIAssist';

// ── All logic below is untouched — UI-only upgrade ──────────────

const TYPE_EMOJI = {
  note: '📝', reminder: '⏰', contact: '📞', task: '✅',
  purchase: '🛒', expense: '💰', trip: '✈️', document: '📄', draft: '💬',
};

const STATE_COLOR = {
  open: '#22c55e', active: '#3b82f6', blocked: '#ef4444',
  deferred: '#f59e0b', closed: '#64748b',
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
  if (!date) { const nd = t.match(/(\d{1,2})[\/\-](\d{1,2})/); if (nd) { date = new Date(now.getFullYear(), parseInt(nd[2])-1, parseInt(nd[1])); if (date < now) date.setFullYear(date.getFullYear()+1); } }
  if (!date) return null;
  let hours = 9, minutes = 0;
  const ap = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (ap) {
    hours = parseInt(ap[1]); minutes = ap[2] ? parseInt(ap[2]) : 0;
    if (ap[3]==='pm' && hours<12) hours+=12;
    if (ap[3]==='am' && hours===12) hours=0;
  } else {
    const pt = t.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\b/);
    if (pt) { hours=parseInt(pt[1]); minutes=pt[2]?parseInt(pt[2]):0; if(hours<7)hours+=12; }
    else if (/\bmidnight\b/.test(t)){hours=0;minutes=0;}
    else if (/\bnoon\b|\bmidday\b/.test(t)){hours=12;}
    else if (/\bmorning\b/.test(t)){hours=9;}
    else if (/\bafternoon\b/.test(t)){hours=14;}
    else if (/\bevening\b/.test(t)){hours=18;}
    else if (/\bnight\b/.test(t)){hours=20;}
  }
  date.setHours(hours, minutes, 0, 0);
  const pad = n => String(n).padStart(2, '0');
  return date.getFullYear()+'-'+pad(date.getMonth()+1)+'-'+pad(date.getDate())+'T'+pad(hours)+':'+pad(minutes);
}

function detectCategory(text) {
  const t = text.toLowerCase();
  if (/call|ring|phone|contact|whatsapp|message/.test(t)) return 'contact';
  if (/buy|order|get|purchase|pick up|shop/.test(t)) return 'task';
  if (/meet|meeting|appointment|doctor|dentist|interview|conference|call at|remind/.test(t)) return 'reminder';
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

function EditKeepModal({ intent, onSave, onClose }) {
  const [content, setContent] = useState(intent.content || '');
  const [reminderAt, setReminderAt] = useState(
    intent.reminder_at ? new Date(intent.reminder_at).toISOString().slice(0, 16) : ''
  );
  const [intentType, setIntentType] = useState(intent.intent_type || 'note');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!content.trim()) return;
    setSaving(true);
    await onSave(intent.id, {
      content: content.trim(),
      reminder_at: reminderAt || null,
      intent_type: intentType,
      updated_at: new Date().toISOString(),
    });
    setSaving(false);
    onClose();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: '0 0 0 0' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#111827', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '20px 20px 0 0', padding: '24px 20px 40px', width: '100%', maxWidth: 540, animation: 'qk-sheet-in 0.25s ease' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0' }}>✏️ Edit Keep</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
        </div>

        {/* Type selector */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
          {[['note','📝 Note'],['reminder','⏰ Reminder'],['task','✅ Task'],['goal','🎯 Goal']].map(([v,l]) => (
            <button key={v} onClick={() => setIntentType(v)} style={{
              padding: '4px 12px', borderRadius: 20, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
              background: intentType === v ? 'rgba(99,102,241,0.2)' : 'transparent',
              border: `1px solid ${intentType === v ? '#6366f1' : 'rgba(255,255,255,0.1)'}`,
              color: intentType === v ? '#a5b4fc' : '#64748b',
            }}>{l}</button>
          ))}
        </div>

        {/* Content */}
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          rows={4}
          style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: '#e2e8f0', padding: '12px 14px', fontSize: 14, fontFamily: 'inherit', outline: 'none', resize: 'none', boxSizing: 'border-box', lineHeight: 1.6 }}
          placeholder="What's on your mind?"
          autoFocus
        />

        {/* Reminder datetime — shown for reminders */}
        {(intentType === 'reminder' || intent.reminder_at) && (
          <div style={{ marginTop: 10 }}>
            <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              ⏰ Reminder date & time
            </label>
            <input
              type="datetime-local"
              value={reminderAt}
              onChange={e => setReminderAt(e.target.value)}
              style={{ width: '100%', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, color: '#e2e8f0', padding: '10px 14px', fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
            />
            {reminderAt && (
              <button onClick={() => setReminderAt('')} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 11, cursor: 'pointer', marginTop: 4 }}>
                × Remove reminder
              </button>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={save} disabled={saving || !content.trim()} style={{
            flex: 1, padding: '12px', borderRadius: 10, border: 'none',
            background: content.trim() ? 'linear-gradient(135deg,#6366f1,#818cf8)' : 'rgba(255,255,255,0.06)',
            color: content.trim() ? '#fff' : '#475569', fontSize: 14, fontWeight: 700, cursor: content.trim() ? 'pointer' : 'not-allowed', fontFamily: 'inherit',
          }}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
          <button onClick={onClose} style={{ padding: '12px 20px', borderRadius: 10, background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: '#64748b', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14 }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function IntentCard({ intent, onUpdateState, onDelete, onEdit, accessToken }) {
  const [expanded, setExpanded] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const emoji = TYPE_EMOJI[intent.intent_type] || '📝';
  const color = STATE_COLOR[intent.status] || '#22c55e';
  const isClosed = intent.status === 'closed';

  return (
    <div className="qk-keep-card" style={{ opacity: isClosed ? 0.55 : 1, animation: 'qk-fade-in 0.25s ease forwards' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <span style={{ fontSize: 18, flexShrink: 0, paddingTop: 2 }}>{emoji}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14, color: '#e2e8f0', lineHeight: 1.5,
            wordBreak: 'break-word',
            textDecoration: isClosed ? 'line-through' : 'none',
            opacity: isClosed ? 0.6 : 1,
          }}>
            {intent.content}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 7, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 10, color: color, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.06em',
              background: color + '18', padding: '2px 7px',
              borderRadius: 999, border: `1px solid ${color}30`,
            }}>
              {intent.status}
            </span>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.2)' }}>{intent.intent_type}</span>
            {intent.reminder_at && (
              <span style={{ fontSize: 10, color: '#818cf8' }}>
                ⏰ {new Date(intent.reminder_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.15)' }}>
              {new Date(intent.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            </span>
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            background: expanded ? 'rgba(99,102,241,0.15)' : 'transparent',
            border: expanded ? '1px solid rgba(99,102,241,0.3)' : '1px solid transparent',
            color: expanded ? '#818cf8' : '#475569',
            cursor: 'pointer', flexShrink: 0,
            width: 36, height: 36,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, borderRadius: 8,
            WebkitTapHighlightColor: 'transparent',
            transition: 'all 0.18s',
          }}
        >
          {expanded ? '▲' : '▼'}
        </button>
      </div>

      {expanded && (
        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {!isClosed && (
            <button
              onClick={() => onUpdateState(intent.id, 'closed')}
              className="qk-btn qk-btn-sm"
              style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)', color: '#22c55e' }}
            >
              ✓ Done
            </button>
          )}
          {isClosed && (
            <button
              onClick={() => onUpdateState(intent.id, 'open')}
              className="qk-btn qk-btn-sm"
              style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.3)', color: '#a5b4fc' }}
            >
              ↩ Reopen
            </button>
          )}
          <button
            onClick={() => setShowEdit(true)}
            className="qk-btn qk-btn-sm"
            style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)', color: '#818cf8' }}
          >
            ✏️ Edit
          </button>
          <button
            onClick={() => onDelete(intent.id)}
            className="qk-btn qk-btn-sm qk-btn-danger"
          >
            🗑 Delete
          </button>
        </div>
      )}
      {showEdit && (
        <EditKeepModal
          intent={intent}
          onSave={onEdit}
          onClose={() => setShowEdit(false)}
        />
      )}
      {expanded && (
        <KeepAIAssist
          keepId={intent.id}
          content={intent.content}
          intentType={intent.intent_type}
          accessToken={accessToken}
        />
      )}
    </div>
  );
}

export default function Dashboard() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [accessToken, setAccessToken] = useState('');
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
  const savingRef = useRef(false);

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
      if (detectedDate) {
        setRemindAt(detectedDate);
        setAutoDetected('reminder time auto-detected');
        setTimeout(() => setAutoDetected(null), 3000);
      }
    }
  }

  const loadIntents = useCallback(async (uid) => {
    const { data, error } = await supabase.from('keeps').select('*').eq('user_id', uid).order('created_at', { ascending: false });
    if (!error && data) setIntents(data);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.replace('/login'); return; }
      setUser(session.user);
      setAccessToken(session.access_token);
      loadIntents(session.user.id).finally(() => setLoading(false));
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') router.replace('/');
      if (session?.access_token) setAccessToken(session.access_token);
    });
    return () => subscription.unsubscribe();
  }, [router, loadIntents]);

  async function handleSave() {
    if (savingRef.current || !content.trim() || !user) return;
    savingRef.current = true;
    setSaving(true);
    let finalIntentType = assistMode;
    let finalRemindAt = remindAt;
    try {
      const res = await fetch('/api/parse-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
        body: JSON.stringify({ text: content.trim(), user_id: user.id }),
      });
      if (res.ok) {
        const parsed = await res.json();
        if (assistMode === 'note' && parsed.intent_type && parsed.intent_type !== 'note') finalIntentType = parsed.intent_type;
        if (!remindAt && parsed.reminder_at) finalRemindAt = parsed.reminder_at;
      }
    } catch (e) { /* parser optional */ }
    const { error } = await supabase.from('keeps').insert({
      user_id: user.id, content: content.trim(), status: 'open',
      intent_type: finalIntentType, voice_text: null,
      reminder_at: finalRemindAt || null, color: '#6366f1',
      show_on_brief: true, is_pinned: false,
    });
    if (!error) {
      setContent(''); setRemindAt(''); setContactInfo(''); setReminderType('app'); setSuggestions([]); setAutoDetected(null);
      showToast('✓ Kept!');
      await loadIntents(user.id);
    } else {
      showToast('Error: ' + error.message);
    }
    setSaving(false);
    setTimeout(() => { savingRef.current = false; }, 800);
  }

  async function updateState(id, state) {
    await supabase.from('keeps').update({ status: state }).eq('id', id);
    await supabase.from('audit_log').insert({ user_id: user.id, action: 'keep_status_updated', intent_id: id, service: 'dashboard', details: { status: state } }).catch(() => {});
    showToast(state === 'closed' ? '✓ Marked done!' : 'Moved to ' + state);
    await loadIntents(user.id);
  }

  async function handleDelete(id) {
    await supabase.from('keeps').delete().eq('id', id);
    await supabase.from('audit_log').insert({ user_id: user.id, action: 'keep_deleted', intent_id: id, service: 'dashboard', details: {} }).catch(() => {});
    showToast('Deleted');
    await loadIntents(user.id);
  }

  async function handleEdit(id, updates) {
    await supabase.from('keeps').update(updates).eq('id', id);
    await supabase.from('audit_log').insert({ user_id: user.id, action: 'keep_edited', intent_id: id, service: 'dashboard', details: {} }).catch(() => {});
    showToast('Keep updated ✓');
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

  // ── Loading screen ───────────────────────────────────────────
  if (loading) {
    return (
      <div style={{
        minHeight: '100dvh', background: '#0b0f19',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16,
      }}>
        <div className="qk-spinner" />
        <span style={{ color: '#475569', fontSize: 13 }}>Loading your keeps…</span>
      </div>
    );
  }

  // ── Main render ──────────────────────────────────────────────
  return (
    <>
      <NavbarClient />

      {/* Toast */}
      {toast && <div className="qk-toast">{toast}</div>}

      <div className="qk-page">
        <div className="qk-container">

          {/* Header greeting */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#e2e8f0', letterSpacing: '-0.02em' }}>
              My Keeps
            </div>
            <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>{user?.email}</div>
          </div>

          <ContextCards userId={user?.id} />

          {/* Stats row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 20 }}>
            {[
              { label: 'Open', value: openIntents.length, color: '#6366f1' },
              { label: 'Done', value: closedIntents.length, color: '#10b981' },
              { label: 'Total', value: intents.length, color: '#64748b' },
            ].map((s, i) => (
              <div key={i} className="qk-stat">
                <div className="qk-stat-value" style={{ color: s.color }}>{s.value}</div>
                <div className="qk-stat-label">{s.label}</div>
              </div>
            ))}
          </div>

          {/* New Keep card */}
          <div className="qk-card" style={{ padding: 18, marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#6366f1', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                + New Keep
              </span>
              {voiceSupported && (
                <button
                  onClick={listening ? stopVoice : startVoice}
                  className="qk-btn qk-btn-sm"
                  style={{
                    background: listening ? 'rgba(239,68,68,0.15)' : 'rgba(99,102,241,0.12)',
                    border: `1px solid ${listening ? 'rgba(239,68,68,0.4)' : 'rgba(99,102,241,0.3)'}`,
                    color: listening ? '#ef4444' : '#a5b4fc',
                  }}
                >
                  {listening ? (
                    <>
                     <span style={{ width: 7, height: 7, background: '#ef4444', borderRadius: '50%', display: 'inline-block', animation: 'qk-pulse 1s ease infinite' }} />
                      Stop
                    </>
                  ) : '🎙 Voice'}
                </button>
              )}
            </div>

            {autoDetected && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
                background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)',
                borderRadius: 8, padding: '8px 12px',
              }}>
                <span style={{ fontSize: 12, color: '#a5b4fc' }}>✨ Auto-detected: {autoDetected}</span>
              </div>
            )}

            <textarea
              ref={textareaRef}
              value={content}
              onChange={e => handleContentChange(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); handleSave(); } }}
              placeholder="What do you want to keep…"
              rows={3}
              className="qk-input"
              style={{ resize: 'none', lineHeight: 1.5 }}
            />

            {suggestions.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, color: '#475569', marginBottom: 6 }}>Smart suggestions:</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {suggestions.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => { setAssistMode(s.action); showToast('Set to ' + s.action); }}
                      className="qk-btn qk-btn-sm"
                      style={{ background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)', color: '#a5b4fc' }}
                    >
                      {s.icon} {s.text}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
              <div>
                <label style={{ fontSize: 11, color: '#475569', display: 'block', marginBottom: 5 }}>
                  Remind at {remindAt && <span style={{ color: '#6366f1' }}>✓</span>}
                </label>
                <input
                  type="datetime-local"
                  value={remindAt}
                  onChange={e => setRemindAt(e.target.value)}
                  className="qk-input"
                  style={{ padding: '8px 10px', fontSize: 12 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: '#475569', display: 'block', marginBottom: 5 }}>Type</label>
                <select
                  value={assistMode}
                  onChange={e => setAssistMode(e.target.value)}
                  className="qk-input"
                  style={{ padding: '8px 10px', fontSize: 12 }}
                >
                  <option value="note">Note</option>
                  <option value="reminder">Reminder</option>
                  <option value="contact">Contact</option>
                  <option value="task">Task</option>
                  <option value="purchase">Purchase</option>
                  <option value="expense">Expense</option>
                  <option value="trip">Trip</option>
                  <option value="document">Document</option>
                </select>
              </div>
            </div>

            {remindAt && (
              <div style={{ marginTop: 12 }}>
                <label style={{ fontSize: 11, color: '#475569', display: 'block', marginBottom: 8 }}>How to remind you?</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {[{ value: 'app', label: 'App' }, { value: 'alarm', label: 'Alarm' }, { value: 'whatsapp', label: 'WhatsApp' }, { value: 'email', label: 'Email' }].map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setReminderType(opt.value)}
                      className="qk-btn qk-btn-sm"
                      style={{
                        background: reminderType === opt.value ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.04)',
                        border: `1px solid ${reminderType === opt.value ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.08)'}`,
                        color: reminderType === opt.value ? '#a5b4fc' : '#64748b',
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {reminderType === 'whatsapp' && <div style={{ marginTop: 8, fontSize: 11, color: '#f59e0b', padding: '6px 10px', background: 'rgba(245,158,11,0.08)', borderRadius: 6, border: '1px solid rgba(245,158,11,0.2)' }}>WhatsApp reminder opens a draft at reminder time. You tap Send.</div>}
                {reminderType === 'alarm' && <div style={{ marginTop: 8, fontSize: 11, color: '#22c55e', padding: '6px 10px', background: 'rgba(34,197,94,0.08)', borderRadius: 6, border: '1px solid rgba(34,197,94,0.2)' }}>Rings even if phone is on silent.</div>}
              </div>
            )}

            {assistMode === 'contact' && (
              <input
                type="text"
                value={contactInfo}
                onChange={e => setContactInfo(e.target.value)}
                placeholder="Phone / Email / Notes…"
                className="qk-input"
                style={{ marginTop: 10 }}
              />
            )}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.15)' }}>Ctrl+Enter to save</span>
              <button
                onClick={handleSave}
                disabled={saving || !content.trim()}
                className="qk-btn qk-btn-primary"
              >
                {saving ? 'Saving…' : '+ Keep this'}
              </button>
            </div>
          </div>

          {/* Search */}
          <div style={{ marginBottom: 14, position: 'relative' }}>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search your keeps…"
              className="qk-input"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{
                  position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                  background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 18,
                }}
              >
                ×
              </button>
            )}
          </div>

          {/* Tabs */}
          <div className="qk-tabs">
            {[
              { key: 'open', label: `Open (${openIntents.length})` },
              { key: 'closed', label: `Done (${closedIntents.length})` },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`qk-tab${activeTab === tab.key ? ' active' : ''}`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Keeps list */}
          {displayIntents.length === 0 ? (
            <div className="qk-empty">
              <div className="qk-empty-icon">{activeTab === 'open' ? '🎙' : '✅'}</div>
              <div className="qk-empty-title">{activeTab === 'open' ? 'No open keeps' : 'No completed keeps yet'}</div>
              <div className="qk-empty-sub">{activeTab === 'open' ? 'Tap Voice or type to add your first keep' : 'Mark some keeps as done to see them here'}</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {displayIntents.map(intent => (
                <IntentCard
                  key={intent.id}
                  intent={intent}
                  onUpdateState={updateState}
                  onDelete={handleDelete}
                  accessToken={accessToken}
                />
              ))}
            </div>
          )}

        </div>
      </div>
    </>
  );
} 
