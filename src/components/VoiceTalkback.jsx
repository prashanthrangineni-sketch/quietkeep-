'use client';
// VoiceTalkback.jsx — browser speechSynthesis only (PWA-safe)
// Works when app is foregrounded. Cannot speak on lock screen (PWA constraint).
//
// W12: every utterance now runs under a barge-in token. See src/lib/barge-in.js
// for why interrupting is four things rather than one. The important part here
// is that speak() is DEBOUNCED by 100ms and the native bridge is asynchronous,
// so between "speak was called" and "sound comes out" the user may already have
// interrupted. Checking isCurrent(token) immediately before making a sound is
// what stops a cancelled utterance from arriving late and talking over them.

import {
  beginSpeech, endSpeech, isCurrent, bargeIn, setSpokenText,
  registerStopper, BARGE_IN_REASON,
} from '@/lib/barge-in';
import { shouldUseAaria } from '@/lib/aaria-audio';

// ── Aaria's voice ───────────────────────────────────────────────────────────
// Until now every reply was spoken by the phone's built-in voice, which is
// poor to unusable in Indic languages. Aaria speaks through Sarvam Bulbul v3;
// the route, the engine and the cascade in src/lib/tts.js all existed and were
// simply never connected to each other.
//
// The token is pushed in from the auth context rather than fetched here,
// because speak() is a plain module function called from a dozen places and
// has no access to React context. Absent token means no Aaria - the proxy
// requires a signed-in user - and we fall through to the behaviour that has
// always been here.
let _authToken = null;
export function setSpeechAuthToken(token) {
  _authToken = token || null;
}

function aariaMode() {
  try { return localStorage.getItem('qk_voice_aaria') || 'indic'; } catch { return 'indic'; }
}

let voiceEnabled = true;


/**
 * cancelSpeech() — Phase 4: cancel + reset dedup guard.
 * Call when user starts speaking to interrupt any current TTS.
 */
export function cancelSpeech(reason = BARGE_IN_REASON.USER_ACTION) {
  _lastSpokenText = '';
  _lastSpokenTime = 0;
  // W12: route through barge-in so the flush and history truncation happen
  // too. Previously this only silenced the current audio, which left an
  // in-flight utterance free to arrive and play a moment later.
  ensureStoppersRegistered();
  bargeIn(reason);
  if (typeof window !== 'undefined') {
    if (window.__QK_TTS__ && window.AndroidTTS?.stop) {
      try { window.AndroidTTS.stop(); } catch {}
    }
    if (window.speechSynthesis) {
      try { window.speechSynthesis.cancel(); } catch {}
    }
  }
}

/**
 * speakLow(text) — Phase 4: low-priority speak (queues, does not interrupt).
 * Use for background notifications and nudges.
 * High-priority speak() will still interrupt this.
 */
export function speakLow(text) {
  speak(text, { priority: 'low' });
}

// ── Time-aware greeting helpers ──────────────────────────────────
function getTimeOfDay() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 21) return 'evening';
  return 'night';
}

function firstName(user) {
  const name = user?.user_metadata?.full_name || user?.email || '';
  return name.split(/[\s@]/)[0] || '';
}

// ── Lifecycle talkback — call these at specific app events ────────

// A. Call from dashboard useEffect when session first loads
export function greetOnLogin(user, keepCount = 0, reminderCount = 0) {
  if (hasGreetedThisSession()) return; // sessionStorage guard — reliable across SPA nav
  markGreetedThisSession();
  if (!voiceEnabled) return;
  const tod = getTimeOfDay();
  const name = firstName(user);
  const greetings = {
    morning: [
      `Good morning${name ? ', ' + name : ''}. ${reminderCount > 0 ? `You have ${reminderCount} reminder${reminderCount > 1 ? 's' : ''} today.` : 'Ready to keep?'}`,
      `Morning${name ? ', ' + name : ''}. ${keepCount > 0 ? `${keepCount} open keep${keepCount > 1 ? 's' : ''} waiting.` : 'A fresh start.'}`,
    ],
    afternoon: [
      `Good afternoon${name ? ', ' + name : ''}. ${reminderCount > 0 ? `${reminderCount} reminder${reminderCount > 1 ? 's' : ''} due.` : 'How can I help?'}`,
      `Hey${name ? ' ' + name : ''}. Afternoon check-in — ${keepCount} open keep${keepCount !== 1 ? 's' : ''}.`,
    ],
    evening: [
      `Good evening${name ? ', ' + name : ''}. ${reminderCount > 0 ? `${reminderCount} item${reminderCount > 1 ? 's' : ''} still pending.` : 'Winding down?'}`,
      `Evening${name ? ', ' + name : ''}. ${keepCount > 0 ? `${keepCount} keep${keepCount > 1 ? 's' : ''} open.` : 'All clear today.'}`,
    ],
    night: [
      `Late night${name ? ', ' + name : ''}. ${keepCount > 0 ? `Still ${keepCount} open keep${keepCount > 1 ? 's' : ''}.` : "You're all caught up."}`,
      `Hey${name ? ' ' + name : ''}. Night owl mode.`,
    ],
  };
  const options = greetings[tod];
  const msg = options[Math.floor(Math.random() * options.length)];
  speak(msg, { rate: 0.88 });
}

// B. Call from dashboard when user returns after inactivity (>30 min)
export function greetOnReturn(reminderCount = 0, briefReady = false) {
  if (!voiceEnabled) return;
  const tod = getTimeOfDay();
  const parts = [];
  if (tod === 'morning' && briefReady) parts.push('Your brief is ready.');
  if (reminderCount > 0) parts.push(`${reminderCount} reminder${reminderCount > 1 ? 's' : ''} today.`);
  if (parts.length === 0) parts.push('Welcome back.');
  speak(parts.join(' '), { rate: 0.9 });
}

// C. Call from NavbarClient handleSignOut BEFORE router.push
export function farewellOnLogout(user) {
  if (!voiceEnabled) return;
  const tod = getTimeOfDay();
  const name = firstName(user);
  const farewells = [
    `Signed out. Take care${name ? ', ' + name : ''}.`,
    `See you soon${name ? ', ' + name : ''}. Your day is saved.`,
    `Goodbye${name ? ', ' + name : ''}. ${tod === 'evening' || tod === 'night' ? 'Good night.' : 'Have a good one.'}`,
    `All saved. ${tod === 'morning' ? 'Have a great day.' : tod === 'evening' ? 'Good evening.' : 'See you later.'}`,
  ];
  const msg = farewells[Math.floor(Math.random() * farewells.length)];
  speak(msg, { rate: 0.88 });
}

// ── Contextual voice responses ────────────────────────────────────
// ── Jarvis assistant confirmations ───────────────────────────────────────
// Natural, contextual responses for key actions.

/**
 * speakConfirmation(action, detail)
 * Speaks a natural language confirmation for a completed action.
 */
export function speakConfirmation(action, detail) {
  const msgs = {
    reminder_set:   detail ? `Reminder set for ${detail}.` : 'Reminder set.',
    task_added:     detail ? `Task added: ${detail}.` : 'Task saved.',
    keep_saved:     detail ? `Got it. ${detail}.` : 'Saved.',
    keep_updated:   'Done. Keep updated.',
    keep_deleted:   'Deleted.',
    nav_opening:    detail ? `Opening ${detail}.` : 'Opening.',
    query_fetching: detail ? `Fetching your ${detail}.` : 'On it.',
    error_retry:    detail || "I couldn't do that. Please try again.",
    bills_summary:  detail || 'No pending bills.',
  };
  speak(msgs[action] || detail || 'Done.', { priority: 'high' });
}

/**
 * speakFollowUp(prompt)
 * Speaks a follow-up prompt after an action. Low priority — won't interrupt.
 */
export function speakFollowUp(prompt) {
  if (!prompt) return;
  // Small delay so it follows the confirmation naturally
  setTimeout(() => speak(prompt, { priority: 'low' }), 1200);
}

export const VoiceResponses = {
  keepSaved: (content) => {
    const preview = content ? content.slice(0, 60).trim() : '';
    speak(preview ? `Got it. Noting: ${preview}` : 'Keep saved.');
  },
  keepDone: (content) => {
    const preview = content ? content.slice(0, 40).trim() : '';
    speak(preview ? `Marked done: ${preview}` : 'Keep marked as done.');
  },
  keepDeleted: () => speak('Keep deleted.'),
  keepUpdated: () => speak('Keep updated.'),
  /**
   * reminderSet — Jarvis: confirms reminder with time, then optionally prompts
   * for additional context.
   */
  reminderSet: (text, time) => {
    if (text && time) {
      const d = new Date(time);
      const when = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      speak(`Reminder set: ${text.slice(0, 50)} — ${when}`);
    } else {
      speak('Reminder set.');
    }
  },
  reminderUpdated: () => speak('Reminder updated.'),
  reminderDeleted: () => speak('Reminder deleted.'),
  expenseAdded: (amount, category) => {
    speak(amount ? `Expense of \u20b9${amount} added under ${category || 'miscellaneous'}.` : 'Expense added.');
  },
  listening: () => speak('Listening.'),
  error: (msg) => speak(msg || 'Something went wrong.'),
};

// ── Read Brief aloud ──────────────────────────────────────────────
export function readBrief(briefText) {
  if (!briefText) { speak('No brief available.'); return; }
  const clean = briefText
    .replace(/[#*_~`]/g, '')
    .replace(/\n{2,}/g, '. ')
    .replace(/\n/g, ', ')
    .trim();
  speak(clean, { rate: 0.85 });
}

// ── Toggle UI component ───────────────────────────────────────────
import { useState, useEffect } from 'react';

// ── ENHANCED TALKBACK TRIGGERS (Session 6 additions) ──────────────────

/**
 * Celebrate the user's very first keep ever saved.
 * Call from dashboard after insert when keeps.count === 1.
 */
export function celebrateFirstKeep() {
  const messages = [
    "Your first keep! You're already building the habit.",
    "That's your first one! QuietKeep is now working for you.",
    "First keep saved. The more you add, the more useful this becomes.",
  ];
  speak(messages[Math.floor(Math.random() * messages.length)], { rate: 0.95 });
}

/**
 * Alert user when a budget threshold is exceeded.
 * @param {string} category - e.g. "food"
 * @param {number} percent - e.g. 92
 */
export function alertBudgetExceeded(category, percent) {
  const pct = Math.round(percent || 100);
  if (pct >= 100) {
    speak(`Heads up — you've crossed your ${category || 'budget'} budget this month.`);
  } else {
    speak(`You're at ${pct}% of your ${category || 'budget'} budget for this month.`);
  }
}

/**
 * Announce overdue reminders count on InAppNotifications load.
 * @param {number} count - number of overdue reminders
 */
export function remindersOverdue(count) {
  if (!count || count < 1) return;
  const msg = count === 1
    ? 'You have 1 overdue reminder. Tap Reminders to review it.'
    : `You have ${count} overdue reminders. Tap Reminders to review them.`;
  speak(msg, { rate: 0.95 });
}

/**
 * Confirm SOS was sent.
 * @param {number} contactCount - number of emergency contacts notified
 */
export function confirmSOSSent(contactCount) {
  const n = contactCount || 1;
  speak(`SOS sent to ${n === 1 ? 'your emergency contact' : `all ${n} emergency contacts`}. Help is on the way.`);
}

/**
 * Confirm business payslip sent via WhatsApp.
 * @param {number} memberCount - number of staff notified
 */
export function confirmPayslipSent(memberCount) {
  const n = memberCount || 1;
  speak(`Payslip${n > 1 ? 's' : ''} sent to ${n === 1 ? '1 team member' : `${n} team members`} via WhatsApp.`);
}

/**
 * Personalized greeting using user's name from profile.
 * @param {string} name - user's full_name from profiles table
 * @param {number} keepCount
 * @param {number} reminderCount
 */
export function greetByName(name, keepCount = 0, reminderCount = 0) {
  const firstName = (name || '').split(' ')[0] || '';
  const hour = new Date().getHours();
  const timeGreet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const greeting = firstName ? `${timeGreet}, ${firstName}!` : `${timeGreet}!`;

  let context = '';
  if (reminderCount > 0) {
    context = ` You have ${reminderCount} reminder${reminderCount > 1 ? 's' : ''} today.`;
  } else if (keepCount > 0) {
    context = ` You have ${keepCount} keep${keepCount > 1 ? 's' : ''} saved.`;
  }
  speak(greeting + context, { rate: 0.95 });
}

export default function VoiceTalkbackToggle({ onChange }) {
  const [on, setOn] = useState(true);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('qk_voice_talkback');
      const enabled = stored !== 'false';
      setOn(enabled);
      setVoiceTalkback(enabled);
    } catch {}
  }, []);

  function toggle() {
    const next = !on;
    setOn(next);
    setVoiceTalkback(next);
    try { localStorage.setItem('qk_voice_talkback', String(next)); } catch {}
    if (onChange) onChange(next);
    if (next) setTimeout(() => speak('Voice responses on.'), 200);
  }

  return (
    <div onClick={toggle} style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 12, padding: '12px 16px', cursor: 'pointer', userSelect: 'none',
    }}>
      <div>
        <div style={{ fontSize: 14, color: 'var(--text)', fontWeight: 600 }}>🔊 Voice Responses</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Speaks contextual confirmations when app is open</div>
      </div>
      <div style={{
        width: 44, height: 24, borderRadius: 12,
        background: on ? 'var(--primary)' : 'var(--border-strong)',
        position: 'relative', transition: 'background 0.2s', flexShrink: 0,
      }}>
        <div style={{
          width: 18, height: 18, borderRadius: '50%', background: '#fff',
          position: 'absolute', top: 3, left: on ? 23 : 3,
          transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
        }} />
      </div>
    </div>
  );
}

// ── WAKE WORD SYSTEM ──────────────────────────────────────────────────────────
// Default wake word is "lotus". Stored in localStorage('qk_wake_word').
// Wake mode can be toggled on/off via localStorage('qk_wake_mode').
//
// Usage in voice pipeline (dashboard/page.jsx handleCapture):
//   import { processWithWakeWord } from '@/components/VoiceTalkback';
//   const result = processWithWakeWord(transcript);
//   if (!result.triggered) return; // ignore — no wake word
//   const command = result.command; // transcript with wake word stripped

const DEFAULT_WAKE_WORD = 'lotus';

export function getWakeWord() {
  try { return (localStorage.getItem('qk_wake_word') || DEFAULT_WAKE_WORD).toLowerCase().trim(); }
  catch { return DEFAULT_WAKE_WORD; }
}

export function setWakeWord(word) {
  try { localStorage.setItem('qk_wake_word', (word || DEFAULT_WAKE_WORD).toLowerCase().trim()); }
  catch {}
}

export function isWakeModeEnabled() {
  try { return localStorage.getItem('qk_wake_mode') !== 'false'; }
  catch { return true; }
}

export function setWakeMode(enabled) {
  try { localStorage.setItem('qk_wake_mode', String(enabled)); } catch {}
}

/**
 * processWithWakeWord(transcript)
 *
 * Returns { triggered: boolean, command: string }
 *
 * If wake mode is OFF → triggered = true always (pass-through, no filtering).
 * If wake mode is ON:
 *   - transcript starts with wake word → triggered = true, command = rest
 *   - transcript does NOT start with wake word → triggered = false
 *
 * Case-insensitive, trims leading/trailing whitespace.
 *
 * Example:
 *   processWithWakeWord("lotus buy milk tomorrow")
 *   → { triggered: true, command: "buy milk tomorrow" }
 *
 *   processWithWakeWord("buy milk tomorrow")
 *   → { triggered: false, command: "" }
 */
/**
 * processWithWakeWord(transcript)
 *
 * Phase 3 enhanced: normalises input, supports wake word variants,
 * confidence-checks minimum length.
 *
 * Supported variants (all case-insensitive):
 *   "lotus buy milk"         → triggered, command = "buy milk"
 *   "hey lotus buy milk"     → triggered, command = "buy milk"
 *   "lotus please buy milk"  → triggered, command = "buy milk"
 *   "lotus, buy milk"        → triggered, command = "buy milk"  (punctuation stripped)
 *
 * Returns { triggered: boolean, command: string, confidence: 'high'|'low' }
 *   confidence 'low' = input was very short after wake word stripped
 */
export function processWithWakeWord(transcript) {
  if (!transcript || typeof transcript !== 'string') {
    return { triggered: false, command: '', confidence: 'low' };
  }

  // Phase 3: minimum length — ignore accidental noise
  const trimmed = transcript.trim();
  if (trimmed.length < 2) {
    return { triggered: false, command: '', confidence: 'low' };
  }

  // Wake mode OFF → always trigger (backward-compatible)
  if (!isWakeModeEnabled()) {
    return { triggered: true, command: trimmed, confidence: 'high' };
  }

  const wakeWord = getWakeWord(); // already lowercase

  // Phase 3: normalise — lowercase + remove leading punctuation for matching
  const lower = trimmed
    .toLowerCase()
    .replace(/^[^a-z]+/, ''); // strip leading non-alpha (e.g. "!" before "lotus")

  // Phase 3: variant patterns in priority order
  const variants = [
    new RegExp(`^hey\s+${wakeWord}[,!?\s]+`, 'i'),
    new RegExp(`^${wakeWord}\s+please[,!?\s]+`, 'i'),
    new RegExp(`^${wakeWord}[,!?\s]+`, 'i'),
    new RegExp(`^${wakeWord}$`, 'i'),  // bare wake word alone
  ];

  for (const re of variants) {
    if (re.test(lower)) {
      // Remove wake variant from original (preserves case for TTS)
      const command = trimmed.replace(re, '').trim();
      const confidence = command.length >= 3 ? 'high' : 'low';
      return { triggered: true, command: command || trimmed, confidence };
    }
  }

  return { triggered: false, command: '', confidence: 'low' };
}

/** WakeModeToggle — drop-in UI component for settings page */
export function WakeModeToggle({ onChange }) {
  const [on, setOn]     = useState(true);
  const [word, setWord] = useState(DEFAULT_WAKE_WORD);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState('');

  useEffect(() => {
    setOn(isWakeModeEnabled());
    setWord(getWakeWord());
  }, []);

  function toggleMode() {
    const next = !on;
    setOn(next);
    setWakeMode(next);
    if (onChange) onChange(next);
    speak(next ? `Wake word mode on. Say ${getWakeWord()} to activate.` : 'Wake word mode off. All voice input will be processed.');
  }

  function saveWord() {
    const w = (draft || DEFAULT_WAKE_WORD).toLowerCase().trim();
    setWord(w);
    setWakeWord(w);
    setEditing(false);
    speak(`Wake word changed to ${w}.`);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Wake mode toggle row */}
      <div onClick={toggleMode} style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 12, padding: '12px 16px', cursor: 'pointer', userSelect: 'none',
      }}>
        <div>
          <div style={{ fontSize: 14, color: 'var(--text)', fontWeight: 600 }}>🌸 Wake Word Mode</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {on ? `Say "${word}" before any command` : 'All voice input processed directly'}
          </div>
        </div>
        <div style={{
          width: 44, height: 24, borderRadius: 12,
          background: on ? 'var(--primary)' : 'var(--border-strong)',
          position: 'relative', transition: 'background 0.2s', flexShrink: 0,
        }}>
          <div style={{
            width: 18, height: 18, borderRadius: '50%', background: '#fff',
            position: 'absolute', top: 3, left: on ? 23 : 3,
            transition: 'left 0.2s', boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
          }} />
        </div>
      </div>

      {/* Current wake word + edit */}
      {on && (
        <div style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 12, padding: '10px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        }}>
          {editing ? (
            <>
              <input
                autoFocus
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveWord(); if (e.key === 'Escape') setEditing(false); }}
                placeholder={word}
                style={{
                  flex: 1, background: 'var(--bg)', border: '1px solid var(--primary)',
                  borderRadius: 8, padding: '6px 10px', color: 'var(--text)',
                  fontSize: 14, fontFamily: 'inherit', outline: 'none',
                }}
              />
              <button onClick={saveWord} style={{
                background: 'var(--primary)', border: 'none', color: '#fff',
                borderRadius: 8, padding: '6px 14px', cursor: 'pointer',
                fontSize: 13, fontWeight: 700, fontFamily: 'inherit',
              }}>Save</button>
              <button onClick={() => setEditing(false)} style={{
                background: 'none', border: 'none', color: 'var(--text-subtle)',
                cursor: 'pointer', fontSize: 13, fontFamily: 'inherit',
              }}>Cancel</button>
            </>
          ) : (
            <>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-subtle)' }}>Current wake word</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--primary)', textTransform: 'capitalize' }}>{word}</div>
              </div>
              <button onClick={() => { setDraft(word); setEditing(true); }} style={{
                background: 'var(--surface-hover)', border: '1px solid var(--border)',
                borderRadius: 8, padding: '6px 14px', cursor: 'pointer',
                fontSize: 12, color: 'var(--text-muted)', fontFamily: 'inherit',
              }}>Change</button>
            </>
          )}
        </div>
      )}
    </div>
  );
    }
