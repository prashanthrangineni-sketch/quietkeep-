'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

const TYPE_EMOJI = { note: '📝', reminder: '⏰', contact: '📞', task: '✅' };
const STATE_COLOR = {
  open: '#22c55e', active: '#3b82f6', blocked: '#ef4444',
  deferred: '#f59e0b', closed: '#64748b',
};

function getAISuggestions(text) {
  const t = text.toLowerCase();
  const suggestions = [];
  if (/call|ring|phone|contact/.test(t)) {
    suggestions.push({ icon: '📞', text: 'Set as Contact type', action: 'contact' });
    suggestions.push({ icon: '⏰', text: 'Add a reminder to follow up', action: 'reminder' });
  }
  if (/tomorrow|tonight|morning|evening|monday|tuesday|wednesday|thursday|friday|weekend/.test(t)) {
    suggestions.push({ icon: '⏰', text: 'Set a reminder for this', action: 'reminder' });
  }
  if (/buy|order|get|purchase|pick up/.test(t)) {
    suggestions.push({ icon: '🛒', text: 'Mark as a task to complete', action: 'task' });
  }
  if (/meet|meeting|appointment|doctor|dentist|interview/.test(t)) {
    suggestions.push({ icon: '📅', text: 'Add to reminders with time', action: 'reminder' });
  }
  if (/idea|think|consider|maybe|what if/.test(t)) {
    suggestions.push({ icon: '💡', text: 'Save as a note to revisit', action: 'note' });
  }
  if (/email|send|reply|respond|message/.test(t)) {
    suggestions.push({ icon: '📧', text: 'Add contact info', action: 'contact' });
  }
  return suggestions.slice(0, 2);
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
  const recognitionRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    setVoiceSupported('webkitSpeechRecognition' in window || 'SpeechRecognition' in window);
  }, []);

  useEffect(() => {
    if (content.length > 5) {
      setSuggestions(getAISuggestions(content));
    } else {
      setSuggestions([]);
    }
  }, [content]);

  function showToast(msg) {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  }

  function startVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const recognition = new SR();
    recognition.lang = 'en-IN';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognitionRef.current = recognition;
    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognition.onresult = (e) => {
      const transcript = Array.from(e.results).map(r => r[0].transcript).join('');
      setContent(transcript);
    };
    recognition.start();
  }

  function stopVoice() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  const loadIntents = useCallback(async (uid) => {
    const { data, error } = await supabase
      .from('intents')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false });
    if (!error && data) setIntents(data);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.replace('/login'); return; }
      setUser(session.user);
      loadIntents(session.user.id).finally(() => setLoading(false));
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
      await fetch('/api/parse-intent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: content.trim(), user_id: user.id }),
      });
    } catch (e) {
      console.log('Parser unavailable, saving directly');
    }

    const { error } = await supabase.from('intents').insert([{
      user_id: user.id,
      content: content.trim(),
      state: 'open',
      assist_mode: assistMode,
      contact_info: contactInfo || null,
      remind_at: remindAt || null,
      intent_type: assistMode,
      intent_status: 'captured',
      parsing_method: 'manual',
      metadata: remindAt ? { reminder_type: reminderType } : null,
    }]);

    if (!error) {
      await supabase.from('audit_log').insert([{
        user_id: user.id,
        action: 'intent_created',
        service: 'dashboard',
        details: {
          content: content.trim().substring(0, 100),
          intent_type: assistMode,
          has_reminder: !!remindAt,
          reminder_type: remindAt ? reminderType : null,
        },
      }]);
      setContent(''); setRemindAt(''); setContactInfo('');
      setReminderType('app'); setSuggestions([]);
      showToast('✅ Kept!');
      await loadIntents(user.id);
    }
    setSaving(false);
  }

  async function updateState(id, state) {
    await supabase.from('intents').update({
      state,
      ...(state === 'closed' ? { completed_at: new Date().toISOString() } : {}),
    }).eq('id', id);
    await supabase.from('audit_log').insert([{
      user_id: user.id, action: 'intent_state_changed',
      service: 'dashboard', details: { intent_id: id, new_state: state },
    }]);
    showToast(state === 'closed' ? '✅ Marked done!' : `Moved to ${state}`);
    await loadIntents(user.id);
  }

  async function handleDelete(id) {
    await supabase.from('intents').delete().eq('id', id);
    await supabase.from('audit_log').insert([{
      user_id: user.id, action: 'intent_deleted',
      service: 'dashboard', details: { intent_id: id },
    }]);
    showToast('🗑️ Deleted');
    await loadIntents(user.id);
  }

  const openIntents = intents.filter(i => i.state !== 'closed');
  const closedIntents = intents.filter(i => i.state === 'closed');
  const displayIntents = activeTab === 'open' ? openIntents : closedIntents;

  if (loading) return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '16px' }}>
      <div style={{ width: '40px', height: '40px', border: '3px solid #6366f1', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <span style={{ color: '#475569', fontSize: '14px' }}>Loading your keeps...</span>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#0a0a0f', color: '#f1f5f9' }}>

      {toast && (
        <div style={{
          position: 'fixed', top: '70px', left: '50%', transform: 'translateX(-50%)',
          backgroundColor: '#1e1e2e', border: '1px solid #6366f1', borderRadius: '10px',
          padding: '10px 20px', color: '#f1f5f9', fontSize: '14px', zIndex: 9999,
          boxShadow: '0 4px 24px rgba(99,102,241,0.3)',
        }}>{toast}</div>
      )}

      <div style={{
        borderBottom: '1px solid #1e1e2e', padding: '10px 16px',
        backgroundColor: 'rgba(10,10,15,0.98)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: '8px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontWeight: '700', fontSize: '14px', color: '#6366f1' }}>📋 My Keeps</span>
          <span style={{ fontSize: '10px', color: '#334155' }}>{user?.email}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <a href="/daily-brief" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: '11px', padding: '5px 10px', border: '1px solid #1e293b', borderRadius: '6px', whiteSpace: 'nowrap' }}>📅 Brief</a>
          <a href="/finance" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: '11px', padding: '5px 10px', border: '1px solid #1e293b', borderRadius: '6px', whiteSpace: 'nowrap' }}>💰 Finance</a>
          <a href="/settings" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: '11px', padding: '5px 10px', border: '1px solid #1e293b', borderRadius: '6px', whiteSpace: 'nowrap' }}>⚙️ Settings</a>
          <a href="/profile" style={{ color: '#94a3b8', textDecoration: 'none', fontSize: '11px', padding: '5px 10px', border: '1px solid #1e293b', borderRadius: '6px', whiteSpace: 'nowrap' }}>👤 Profile</a>
          <button onClick={() => supabase.auth.signOut()} style={{ backgroundColor: 'transparent', border: '1px solid #1e293b', color: '#64748b', padding: '5px 10px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer', whiteSpace: 'nowrap' }}>Sign Out</button>
        </div>
      </div>

      <div style={{ maxWidth: '680px', margin: '0 auto', padding: '20px 16px' }}>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '10px', marginBottom: '20px' }}>
          {[
            { label: 'Open', value: openIntents.length, color: '#6366f1' },
            { label: 'Done', value: closedIntents.length, color: '#22c55e' },
            { label: 'Total', value: intents.length, color: '#94a3b8' },
          ].map((s, i) => (
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
              <button onClick={listening ? stopVoice : startVoice} style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                backgroundColor: listening ? 'rgba(239,68,68,0.15)' : 'rgba(99,102,241,0.15)',
                border: `1px solid ${listening ? 'rgba(239,68,68,0.4)' : 'rgba(99,102,241,0.4)'}`,
                color: listening ? '#ef4444' : '#a5b4fc',
                padding: '7px 14px', borderRadius: '8px', fontSize: '13px',
                fontWeight: '600', cursor: 'pointer',
              }}>
                {listening ? '⏹ Stop' : '🎙️ Voice'}
              </button>
            )}
          </div>

          {listening && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px',
              backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
              borderRadius: '8px', padding: '8px 12px',
            }}>
              <span style={{ width: '8px', height: '8px', backgroundColor: '#ef4444', borderRadius: '50%', display: 'inline-block', animation: 'pulse 1s ease infinite' }} />
              <span style={{ fontSize: '12px', color: '#ef4444' }}>Listening... speak now</span>
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={content}
            onChange={e => setContent(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) handleSave(); }}
            placeholder="What do you want to keep... (or tap 🎙️ to speak)"
            rows={3}
            style={{
              width: '100%', backgroundColor: '#0a0a0f',
              border: `1px solid ${content ? '#6366f150' : '#1e293b'}`,
              borderRadius: '10px', padding: '12px', color: '#f1f5f9',
              fontSize: '15px', resize: 'none', outline: 'none',
              fontFamily: 'inherit', boxSizing: 'border-box', lineHeight: '1.5',
            }}
          />

          {suggestions.length > 0 && (
            <div style={{ marginTop: '10px' }}>
              <div style={{ fontSize: '11px', color: '#475569', marginBottom: '6px' }}>✨ Smart suggestions:</div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {suggestions.map((s, i) => (
                  <button key={i} onClick={() => { setAssistMode(s.action); showToast(`Set to ${s.action}`); }} style={{
                    backgroundColor: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)',
                    color: '#a5b4fc', padding: '6px 12px', borderRadius: '8px',
                    fontSize: '12px', cursor: 'pointer', fontWeight: '500',
                  }}>{s.icon} {s.text}</button>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '12px' }}>
            <div>
              <label style={{ fontSize: '11px', color: '#475569', display: 'block', marginBottom: '5px' }}>⏰ Remind at</label>
              <input type="datetime-local" value={remindAt} onChange={e => setRemindAt(e.target.value)}
                style={{ width: '100%', backgroundColor: '#0a0a0f', border: '1px solid #1e293b', borderRadius: '8px', padding: '8px', color: '#f1f5f9', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: '11px', color: '#475569', display: 'block', marginBottom: '5px' }}>📋 Type</label>
              <select value={assistMode} onChange={e => setAssistMode(e.target.value)}
                style={{ width: '100%', backgroundColor: '#0a0a0f', border: '1px solid #1e293b', borderRadius: '8px', padding: '8px', color: '#f1f5f9', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }}>
                <option value="note">📝 Note</option>
                <option value="reminder">⏰ Reminder</option>
                <option value="contact">📞 Contact</option>
                <option value="task">✅ Task</option>
              </select>
            </div>
          </div>

          {remindAt && (
            <div style={{ marginTop: '12px' }}>
              <label style={{ fontSize: '11px', color: '#475569', display: 'block', marginBottom: '8px' }}>🔔 How to remind you?</label>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {[
                  { value: 'app', icon: '📳', label: 'App + Vibration' },
                  { value: 'alarm', icon: '⏰', label: 'Alarm Sound' },
                  { value: 'whatsapp', icon: '💬', label: 'WhatsApp' },
                  { value: 'email', icon: '📧', label: 'Email' },
                ].map(opt => (
                  <button key={opt.value} onClick={() => setReminderType(opt.value)} style={{
                    padding: '7px 12px', borderRadius: '8px', cursor: 'pointer',
                    border: `1px solid ${reminderType === opt.value ? '#6366f1' : '#1e293b'}`,
                    backgroundColor: reminderType === opt.value ? 'rgba(99,102,241,0.15)' : '#0a0a0f',
                    color: reminderType === opt.value ? '#a5b4fc' : '#64748b',
                    fontSize: '12px', fontWeight: reminderType === opt.value ? '600' : '400',
                    display: 'flex', alignItems: 'center', gap: '5px',
                  }}>
                    {opt.icon} {opt.label}
                  </button>
                ))}
              </div>
              {reminderType === 'whatsapp' && (
                <div style={{ marginTop: '8px', fontSize: '11px', color: '#f59e0b', padding: '6px 10px', backgroundColor: 'rgba(245,158,11,0.08)', borderRadius: '6px', border: '1px solid rgba(245,158,11,0.2)' }}>
                  ⚠️ WhatsApp reminders will open a draft message at reminder time. You tap Send.
                </div>
              )}
              {reminderType === 'alarm' && (
                <div style={{ marginTop: '8px', fontSize: '11px', color: '#22c55e', padding: '6px 10px', backgroundColor: 'rgba(34,197,94,0.08)', borderRadius: '6px', border: '1px solid rgba(34,197,94,0.2)' }}>
                  ⏰ Alarm will ring at the set time even if your phone is on silent.
                </div>
              )}
            </div>
          )}

          {assistMode === 'contact' && (
            <input type="text" value={contactInfo} onChange={e => setContactInfo(e.target.value)}
              placeholder="Phone / Email / Notes..."
              style={{ width: '100%', marginTop: '10px', backgroundColor: '#0a0a0f', border: '1px solid #1e293b', borderRadius: '8px', padding: '9px 12px', color: '#f1f5f9', fontSize: '13px', outline: 'none', boxSizing: 'border-box' }} />
          )}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '14px' }}>
            <span style={{ fontSize: '11px', color: '#1e293b' }}>Ctrl+Enter to save</span>
            <button onClick={handleSave} disabled={saving || !content.trim()} style={{
              backgroundColor: saving || !content.trim() ? '#1a1a2e' : '#6366f1',
              color: saving || !content.trim() ? '#334155' : '#fff',
              border: 'none', padding: '10px 24px', borderRadius: '8px',
              fontSize: '14px', fontWeight: '600', cursor: saving || !content.trim() ? 'not-allowed' : 'pointer',
            }}>
              {saving ? 'Saving...' : '+ Keep this'}
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '4px', marginBottom: '14px', backgroundColor: '#0f0f1a', padding: '4px', borderRadius: '10px', border: '1px solid #1e1e2e' }}>
          {[{ key: 'open', label: `Open (${openIntents.length})` }, { key: 'closed', label: `Done (${closedIntents.length})` }].map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
              flex: 1, padding: '9px', borderRadius: '7px', border: 'none', cursor: 'pointer',
              backgroundColor: activeTab === tab.key ? '#6366f1' : 'transparent',
              color: activeTab === tab.key ? '#fff' : '#64748b',
              fontSize: '13px', fontWeight: '600',
            }}>{tab.label}</button>
          ))}
        </div>

        {displayIntents.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 24px', border: '1px dashed #1e293b', borderRadius: '14px', color: '#334155' }}>
            {activeTab === 'open'
              ? <><div style={{ fontSize: '32px', marginBottom: '10px' }}>🎙️</div><div>Tap Voice or type to add your first keep</div></>
              : <><div style={{ fontSize: '32px', marginBottom: '10px' }}>✅</div><div>No completed keeps yet</div></>
            }
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {displayIntents.map(intent => (
              <IntentCard key={intent.id} intent={intent} onUpdateState={updateState} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>
    </div>
  );
}

function IntentCard({ intent, onUpdateState, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const emoji = TYPE_EMOJI[intent.assist_mode] || TYPE_EMOJI[intent.intent_type] || 'ðŸ“';
  const color = STATE_COLOR[intent.state] || '#22c55e';
  const isClosed = intent.state === 'closed';
  const reminderIcons = { app: 'ðŸ“³', alarm: 'â°', whatsapp: 'ðŸ’¬', email: 'ðŸ“§' };
  const reminderType = intent.metadata?.reminder_type;

  return (
    <div style={{
      backgroundColor: '#0f0f1a', border: `1px solid ${isClosed ? '#1a1a2e' : '#1e1e2e'}`,
      borderRadius: '12px', padding: '14px', opacity: isClosed ? 0.5 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        <span style={{ fontSize: '18px', flexShrink: 0, lineHeight: 1.4 }}>{emoji}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{
            margin: '0 0 8px', fontSize: '15px', color: '#e2e8f0', lineHeight: 1.5,
            textDecoration: isClosed ? 'line-through' : 'none',
          }}>{intent.content}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{
              fontSize: '10px', padding: '2px 8px', borderRadius: '100px', fontWeight: '700',
              backgroundColor: `${color}18`, color, textTransform: 'uppercase',
            }}>{intent.state}</span>
            {intent.remind_at && (
              <span style={{ fontSize: '11px', color: '#64748b' }}>
                {reminderIcons[reminderType] || 'â°'} {new Date(intent.remind_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            {intent.contact_info && (
              <span style={{ fontSize: '11px', color: '#64748b' }}>ðŸ“ž {intent.contact_info}</span>
            )}
            <span style={{ fontSize: '11px', color: '#1e293b', marginLeft: 'auto' }}>
              {new Date(intent.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
            </span>
          </div>
        </div>
      </div>

      {!isClosed && (
        <div style={{ display: 'flex', gap: '6px', marginTop: '12px', paddingTop: '10px', borderTop: '1px solid #1a1a2e', flexWrap: 'wrap' }}>
          <button onClick={() => onUpdateState(intent.id, 'closed')} style={{
            backgroundColor: '#052010', border: '1px solid #166534', color: '#22c55e',
            padding: '5px 12px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', fontWeight: '600',
          }}>âœ“ Done</button>
          <button onClick={() => setExpanded(e => !e)} style={{
            backgroundColor: 'transparent', border: '1px solid #1e293b', color: '#64748b',
            padding: '5px 12px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer',
          }}>{expanded ? 'â–² Less' : 'â–¼ More'}</button>
          <button onClick={() => onDelete(intent.id)} style={{
            backgroundColor: 'transparent', border: '1px solid #2d1515', color: '#ef4444',
            padding: '5px 12px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', marginLeft: 'auto',
          }}>ðŸ—‘ï¸</button>
        </div>
      )}

      {expanded && (
        <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #1a1a2e', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '11px', color: '#475569', alignSelf: 'center' }}>Move to:</span>
          {['open', 'active', 'deferred', 'blocked'].filter(s => s !== intent.state).map(s => (
            <button key={s} onClick={() => onUpdateState(intent.id, s)} style={{
              backgroundColor: `${STATE_COLOR[s]}15`, border: `1px solid ${STATE_COLOR[s]}40`,
              color: STATE_COLOR[s], padding: '4px 10px', borderRadius: '6px',
              fontSize: '11px', cursor: 'pointer', fontWeight: '600',
            }}>{s}</button>
          ))}
        </div>
      )}
    </div>
  );
}
