'use client';
// VoiceTalkback.jsx — browser speechSynthesis only (PWA-safe)
// Works when app is foregrounded. Cannot speak on lock screen (PWA constraint).

let voiceEnabled = true;
// Use sessionStorage instead of module variable — survives SPA navigation
// but resets properly on new browser tab/session
const SESSION_GREET_KEY = 'qk_greeted_session';

function hasGreetedThisSession() {
  try { return sessionStorage.getItem(SESSION_GREET_KEY) === '1'; } catch { return false; }
}
function markGreetedThisSession() {
  try { sessionStorage.setItem(SESSION_GREET_KEY, '1'); } catch {}
}
export function resetGreetGuard() {
  try { sessionStorage.removeItem(SESSION_GREET_KEY); } catch {}
}

export function setVoiceTalkback(enabled) {
  voiceEnabled = enabled;
}

// Read the current voice language from localStorage (set by LanguageProvider)
function getCurrentLang() {
  try { return localStorage.getItem('qk_voice_lang') || 'en-IN'; } catch { return 'en-IN'; }
}

function getVoice(lang) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  const target = lang || getCurrentLang();
  return (
    voices.find(v => v.lang === target) ||
    voices.find(v => v.lang.startsWith(target.split('-')[0])) ||
    voices.find(v => v.lang === 'en-IN') ||
    voices.find(v => v.lang.startsWith('en')) ||
    voices[0] || null
  );
}

export function speak(text, options = {}) {
  if (!voiceEnabled) return;
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  try { window.speechSynthesis.cancel(); } catch {}

  // Guard: only ONE of (voiceschanged OR timeout fallback) may fire
  let _fired = false;

  function doSpeak() {
    if (_fired) return; // prevent double-fire from race condition
    _fired = true;
    try {
      const utter = new SpeechSynthesisUtterance(text);
      const activeLang = options.lang || getCurrentLang();
      utter.lang = activeLang;
      utter.rate = options.rate || 0.9;
      utter.pitch = options.pitch || 1.0;
      utter.volume = options.volume || 1.0;
      const voice = getVoice(activeLang);
      if (voice) utter.voice = voice;
      window.speechSynthesis.speak(utter);
    } catch {}
  }

  if (window.speechSynthesis.getVoices().length > 0) {
    setTimeout(doSpeak, 80);
  } else {
    window.speechSynthesis.addEventListener('voiceschanged', function onVoices() {
      window.speechSynthesis.removeEventListener('voiceschanged', onVoices);
      doSpeak(); // immediate — no extra delay needed once voices load
    });
    setTimeout(doSpeak, 600); // fallback — longer to give voiceschanged a chance first
  }
}

export function cancelSpeech() {
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    try { window.speechSynthesis.cancel(); } catch {}
  }
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
