'use client';
// src/lib/context/aaria.jsx
// ─────────────────────────────────────────────────────────────────────────────
// Aaria, present everywhere.
//
// THE PROBLEM THIS SOLVES
// QuietKeep is sold as a voice-first assistant. In practice the assistant
// existed on exactly one screen: <VoiceCapture> was imported by
// src/app/dashboard/page.jsx and nowhere else. Navigate to Invoices, Documents,
// Ledger — 80-odd screens — and the microphone simply wasn't there. The
// wake-word engine was in worse shape: src/lib/wake-word-engine.js was imported
// only by the *settings page that configures it*, so choosing a wake mode wrote
// a value to localStorage that nothing ever read. The user could turn on a
// feature that had no running code behind it anywhere in the app.
//
// This provider is mounted once in the root layout, so from here on "Aaria is
// on this page" is true by construction rather than by remembering to add her.
//
// LAYERS, FASTEST FIRST
//   1. REFLEX   src/lib/aaria-router.js — navigation, theme, stop. On-device,
//               sub-millisecond, no network. Guarded so it can never swallow
//               something the user meant to keep.
//   2. BRAIN    POST /api/voice/capture — the existing understanding + action
//               pipeline. Unchanged; it already parses, saves, and replies.
//   3. VOICE    speak() from VoiceTalkback — native Android TTS when present,
//               browser speech otherwise.
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO
// It does not open the microphone on load. Listening starts on an explicit user
// action, or on a wake mode the user turned on themselves. An assistant that
// silently records is not a feature, and on iOS/PWA it isn't even possible —
// so the code degrades honestly rather than claiming otherwise.
// ─────────────────────────────────────────────────────────────────────────────

import { createContext, useContext, useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context/auth';
import { useLanguage } from '@/lib/context/language';
import { routeUtterance, helpText, DESTINATIONS } from '@/lib/aaria-router';
import { speak, cancelSpeech } from '@/components/VoiceTalkback';
import { onWake, initWakeEngine, getWakeWord } from '@/lib/wake-word-engine';
import { startWebHotword, isWebHotwordEnabled, isHotwordSupported } from '@/lib/aaria-hotword';
import { checkForNotices } from '@/lib/aaria-watch';

const AariaContext = createContext(null);

/** Screens where an assistant must not appear. */
const SILENT_ROUTES = [
  '/onboarding', '/b/onboarding',   // first-run flow owns the screen
  '/auth', '/biz-login', '/b/join', // sign-in — no session to act with
  '/kids',                          // child lock; an assistant defeats the point
  '/share',                         // public link, viewer is not the owner
  '/driving',                       // has its own full-screen voice UI
  '/privacy', '/terms', '/pricing', '/brand', '/waitlist', '/business', // marketing
];

function isSilent(pathname) {
  if (!pathname) return true;
  if (pathname === '/') return true;         // landing page
  return SILENT_ROUTES.some((r) => pathname === r || pathname.startsWith(r + '/'));
}

/** The label Aaria uses when she refers to where you are. */
function pageLabel(pathname) {
  const exact = DESTINATIONS.find((d) => d.path === pathname);
  if (exact) return exact.label;
  const parent = DESTINATIONS
    .filter((d) => pathname.startsWith(d.path + '/'))
    .sort((a, b) => b.path.length - a.path.length)[0];
  return parent ? parent.label : null;
}

const LANG_MAP = {
  en: 'en-IN', hi: 'hi-IN', te: 'te-IN', ta: 'ta-IN', kn: 'kn-IN',
  ml: 'ml-IN', mr: 'mr-IN', bn: 'bn-IN', gu: 'gu-IN', pa: 'pa-IN',
};
function speechLang(lang) {
  const l = String(lang || 'en-IN');
  return LANG_MAP[l.split('-')[0]] || l;
}

export function AariaProvider({ children }) {
  const pathname = usePathname();
  const router   = useRouter();
  const { user, accessToken } = useAuth();
  const { voiceLang } = useLanguage();

  // 'idle' | 'listening' | 'thinking' | 'speaking'
  const [status,     setStatus]     = useState('idle');
  const [open,       setOpen]       = useState(false);
  const [interim,    setInterim]    = useState('');
  const [transcript, setTranscript] = useState('');
  const [reply,      setReply]      = useState(null);
  const [error,      setError]      = useState('');
  const [wakeInfo,   setWakeInfo]   = useState(null);
  const [notice,     setNotice]     = useState(null);   // {text, count} or null

  const recognitionRef = useRef(null);
  const listeningRef   = useRef(false);
  const submittingRef  = useRef(false);
  // The web hotword holds a second, permanently-open recogniser. Exactly one
  // recogniser may be live at a time or the browser wedges the microphone until
  // reload, so every start/stop below suspends and resumes this handle. All the
  // arbitration lives in this file on purpose — split across two components it
  // would drift within a week.
  const hotwordRef     = useRef(null);
  const [hotwordOn, setHotwordOn] = useState(false);
  // The hotword listener is created ONCE and lives across navigation. Its
  // callbacks must therefore never close over `submit` directly: `submit`
  // depends on `pathname`, so listing it as an effect dependency would tear
  // down and restart the microphone on every page change, and omitting it
  // would leave the callback calling a stale version — the exact bug that
  // silently broke 28 pages in this codebase since April. A ref gives the
  // current function without making the effect depend on it.
  const submitRef      = useRef(null);

  const silent   = isSilent(pathname);
  const signedIn = !!user && !!accessToken;
  const here     = useMemo(() => pageLabel(pathname), [pathname]);

  // ── speaking ───────────────────────────────────────────────────────────────
  const say = useCallback((text) => {
    if (!text) return;
    setReply(String(text));
    setStatus('speaking');
    try { speak(String(text), { priority: 'high' }); } catch {}
    // No reliable end-of-speech event across the native bridge and the browser,
    // so fall back to idle on a timer proportional to length. Worst case the
    // orb stops pulsing slightly early — cosmetic, never functional.
    const ms = Math.min(9000, 1200 + String(text).length * 55);
    setTimeout(() => setStatus((s) => (s === 'speaking' ? 'idle' : s)), ms);
  }, []);

  const stopAll = useCallback(() => {
    listeningRef.current = false;
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }
    try { cancelSpeech(); } catch {}
    setInterim('');
    setStatus('idle');
    // Give the microphone back to the hotword, but only after the capture
    // recogniser has actually released it.
    if (hotwordRef.current) setTimeout(() => hotwordRef.current?.resume(), 300);
  }, []);

  // ── the brain call ─────────────────────────────────────────────────────────
  const askBrain = useCallback(async (text) => {
    if (!signedIn) {
      setError('Sign in first and I can act on that.');
      setStatus('idle');
      return;
    }
    setStatus('thinking');
    try {
      const res = await fetch('/api/voice/capture', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          transcript: text,
          source: 'voice',
          language: speechLang(voiceLang),
          // Page context. The understanding prompt is materially better when it
          // knows the user is staring at Invoices — "add 2000 for Ravi" is an
          // invoice there and an expense on the Money screen.
          page_context: { path: pathname, label: here || null },
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json) {
        setError('I could not save that. It is still in the box — try again.');
        setStatus('idle');
        return;
      }
      const spoken = json.tts_response || json.assistant?.reply || 'Saved.';
      say(spoken);
      setTranscript('');
    } catch {
      setError('Network problem. Nothing was lost — try again.');
      setStatus('idle');
    }
  }, [signedIn, accessToken, voiceLang, pathname, here, say]);

  // ── the single entry point for everything Aaria hears or is typed ──────────
  const submit = useCallback(async (raw) => {
    const text = String(raw || '').trim();
    if (!text || submittingRef.current) return;
    submittingRef.current = true;
    setError('');

    try {
      // LAYER 1 — reflex.
      const action = routeUtterance(text, { wakeWord: getWakeWord() });

      if (action?.kind === 'stop')  { stopAll(); return; }
      if (action?.kind === 'help')  { say(helpText(here)); return; }
      if (action?.kind === 'back')  { router.back(); setOpen(false); return; }

      if (action?.kind === 'theme') {
        try {
          document.documentElement.setAttribute('data-theme', action.value);
          localStorage.setItem('qk_theme', action.value);
        } catch {}
        say(action.spoken);
        return;
      }

      if (action?.kind === 'navigate') {
        if (pathname === action.path) {
          say(`You're already on ${action.label}.`);
          return;
        }
        say(action.spoken);
        router.push(action.path);
        setOpen(false);
        return;
      }

      // LAYER 2 — the brain.
      await askBrain(text);
    } finally {
      submittingRef.current = false;
    }
  }, [here, pathname, router, say, stopAll, askBrain]);

  // ── listening (browser SpeechRecognition) ──────────────────────────────────
  const startListening = useCallback(() => {
    if (typeof window === 'undefined') return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setError('This browser has no speech recognition. Type instead — same brain.');
      setOpen(true);
      return;
    }
    if (listeningRef.current) return;

    // Take the microphone off the hotword before opening our own recogniser.
    try { hotwordRef.current?.suspend(); } catch {}
    try { cancelSpeech(); } catch {}
    setError('');
    setTranscript('');
    setInterim('');
    setReply(null);
    setOpen(true);

    const rec = new SR();
    rec.continuous     = false;   // one utterance, then act. Continuous capture
                                  // belongs to the native service, not here.
    rec.interimResults = true;
    rec.lang           = speechLang(voiceLang);

    rec.onstart = () => { listeningRef.current = true; setStatus('listening'); };

    rec.onresult = (ev) => {
      let final = '', partial = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) final += r[0].transcript;
        else partial += r[0].transcript;
      }
      if (partial) setInterim(partial);
      if (final) {
        setInterim('');
        setTranscript(final.trim());
        submit(final.trim());
      }
    };

    rec.onerror = (ev) => {
      listeningRef.current = false;
      setStatus('idle');
      setInterim('');
      if (ev.error === 'not-allowed') {
        setError('Microphone blocked. Allow it in your browser settings, then tap again.');
      } else if (ev.error !== 'no-speech' && ev.error !== 'aborted') {
        setError(`Microphone error: ${ev.error}`);
      }
    };

    rec.onend = () => {
      listeningRef.current = false;
      setStatus((s) => (s === 'listening' ? 'idle' : s));
      setInterim('');
      if (hotwordRef.current) setTimeout(() => hotwordRef.current?.resume(), 300);
    };

    recognitionRef.current = rec;
    try { rec.start(); }
    catch { setError('Could not start the microphone.'); setStatus('idle'); }
  }, [voiceLang, submit]);

  const toggleListening = useCallback(() => {
    if (listeningRef.current || status === 'speaking') stopAll();
    else startListening();
  }, [status, stopAll, startListening]);

  // ── wake engine: booted ONCE, app-wide ─────────────────────────────────────
  // Previously nothing called this outside the settings page, so every wake
  // mode was inert. Booting here is what turns the setting into a behaviour.
  useEffect(() => {
    if (silent || !signedIn) return;
    let info = null;
    try { info = initWakeEngine(); } catch {}
    setWakeInfo(info);
    const off = onWake(() => { startListening(); });
    return () => { try { off(); } catch {} };
  }, [silent, signedIn, startListening]);

  // Keep the ref pointing at the current submit, every render.
  useEffect(() => { submitRef.current = submit; }, [submit]);

  // ── web hotword: opt-in, for the propped-up counter phone ──────────────────
  // Deliberately not started by initWakeEngine: that engine's honest answer for
  // the web is "you cannot listen in the background", and that stays true. This
  // only listens while the tab is open and visible, and only if the user asked.
  useEffect(() => {
    if (silent || !signedIn) return;
    if (!isWebHotwordEnabled() || !isHotwordSupported()) { setHotwordOn(false); return; }

    const handle = startWebHotword({
      wakeWord: getWakeWord(),
      lang: speechLang(voiceLang),

      // Name heard, still mid-sentence. Show it instantly — the acknowledgement
      // is what makes someone keep talking instead of repeating themselves.
      onArmed: () => { setOpen(true); setStatus('listening'); setError(''); },

      // "Aaria, open invoices" — name AND command in one breath. The hotword
      // recogniser already has the whole thing, so act on it directly. Handing
      // off here is what used to drop the command.
      onUtterance: (text) => { setTranscript(text); submitRef.current?.(text); },

      // Name alone. Open a capture recogniser and wait for the command.
      onWake: () => { startListening(); },

      onError: (reason) => {
        setHotwordOn(false);
        if (reason === 'microphone-denied') {
          setError('Wake word stopped — microphone permission was refused.');
        }
      },
    });

    hotwordRef.current = handle;
    setHotwordOn(!!handle);
    return () => {
      try { handle?.stop(); } catch {}
      hotwordRef.current = null;
      setHotwordOn(false);
    };
  }, [silent, signedIn, voiceLang, startListening]);

  // ── the watcher ────────────────────────────────────────────────────────────
  // Runs on mount and when the tab comes back to the front. It raises a badge;
  // it never speaks on its own. See the rules at the top of aaria-watch.js —
  // an assistant that talks unprompted in a meeting gets uninstalled.
  useEffect(() => {
    if (silent || !signedIn) return;
    let alive = true;

    const run = () => {
      checkForNotices(accessToken)
        .then((n) => { if (alive && n) setNotice(n); })
        .catch(() => {});
    };

    const onFocus = () => { if (!document.hidden) run(); };
    run();
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [silent, signedIn, accessToken]);

  // Opening the panel is consent to hear it. Speaking it here — and only here —
  // is what keeps rule 1 in aaria-watch.js true.
  useEffect(() => {
    if (!open || !notice) return;
    say(notice.text);
    setNotice(null);
  }, [open, notice, say]);

  // Keyboard: hold-free push-to-talk for desktop and for anyone who cannot
  // rely on a wake word.
  useEffect(() => {
    if (silent || !signedIn) return;
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '')
        || e.target?.isContentEditable;
      if (typing) return;
      if ((e.ctrlKey || e.metaKey) && e.code === 'Space') {
        e.preventDefault();
        toggleListening();
      }
      if (e.key === 'Escape' && (listeningRef.current || status === 'speaking')) stopAll();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [silent, signedIn, toggleListening, stopAll, status]);

  // Leaving a page should never leave a hot microphone behind it.
  useEffect(() => () => {
    if (recognitionRef.current) { try { recognitionRef.current.stop(); } catch {} }
  }, [pathname]);

  const value = useMemo(() => ({
    status, open, setOpen, interim, transcript, reply, error, wakeInfo, hotwordOn,
    notice, here, silent, signedIn,
    submit, say, stopAll, startListening, toggleListening,
    setError, setReply,
  }), [status, open, interim, transcript, reply, error, wakeInfo, hotwordOn, notice,
       here, silent, signedIn, submit, say, stopAll, startListening, toggleListening]);

  return <AariaContext.Provider value={value}>{children}</AariaContext.Provider>;
}

export function useAaria() {
  const ctx = useContext(AariaContext);
  // Returning a safe stub rather than throwing: a page that reaches for Aaria
  // outside the provider should degrade, not white-screen.
  if (!ctx) {
    return {
      status: 'idle', open: false, setOpen: () => {}, interim: '', transcript: '',
      reply: null, error: '', wakeInfo: null, hotwordOn: false, notice: null,
      here: null, silent: true, signedIn: false,
      submit: async () => {}, say: () => {}, stopAll: () => {},
      startListening: () => {}, toggleListening: () => {},
      setError: () => {}, setReply: () => {},
    };
  }
  return ctx;
}

export default AariaProvider;
