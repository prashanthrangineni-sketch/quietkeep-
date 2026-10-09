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
import { speak, cancelSpeech, setSpeechAuthToken } from '@/components/VoiceTalkback';
import { endpointSilenceMsFor, MAX_LISTEN_MS } from '@/lib/endpointing';
import {
  startListenStream, listenStreamWanted, streamingSupported, warmEngine, recordLastListen,
} from '@/lib/listen-stream';
import { onWake, initWakeEngine, getWakeWord } from '@/lib/wake-word-engine';
import { startWebHotword, isWebHotwordEnabled, isHotwordSupported, claimMic, releaseMic } from '@/lib/aaria-hotword';
import { createMicHold } from '@/lib/mic-hold';
import { checkForNotices } from '@/lib/aaria-watch';
import { isSpeaking, looksLikeSelfEcho } from '@/lib/barge-in';
import { lastKnownPosition } from '@/lib/geo';

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

// How Aaria opens a reminder she is reading out late, so it is heard as a
// reminder rather than as a sentence arriving from nowhere. Short on purpose:
// the reminder itself is the content, and the Telugu and Hindi wording here has
// not been checked by a native speaker.
const MISSED_PREFIX = {
  en: 'Reminder.',
  te: 'గుర్తు చెబుతున్నాను.',
  hi: 'याद दिला रही हूँ।',
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

  // Hand the token to the speech layer. speak() is a plain module function
  // called from a dozen components and has no access to React context, so the
  // token has to be pushed in rather than pulled. Without it Aaria cannot
  // speak - the /api/voice/tts proxy requires a signed-in user - and every
  // reply falls back to the phone's built-in voice, which is what happened
  // for the whole of the product's life until now.
  useEffect(() => { setSpeechAuthToken(accessToken); }, [accessToken]);

  // ── REMINDERS THAT SPEAK ─────────────────────────────────────────────────
  //
  // A reminder in a voice product should be SPOKEN, not chimed. The machinery
  // for that already existed on both sides and had no caller on either:
  //
  //   * Android: ReminderAlarmPlugin (registered in MainActivity) →
  //     AlarmManager → AlarmReceiver → ReminderTTSService, which speaks the
  //     reminder aloud with the app closed and the screen off. Present in the
  //     installed v1.2.0-vc9 bundle. Never once asked to schedule anything.
  //   * Web: the service worker's SCHEDULE_REMINDER handler, with IndexedDB so
  //     a pending reminder outlives the worker being killed. Never once sent a
  //     reminder either.
  //
  // Why the device and not the server: server-side reminders go out by EMAIL,
  // and an account created by mobile OTP has a synthetic address on our own
  // send-only domain. There is nowhere to deliver to. The device needs no email,
  // no push service and no API key, and it works with the phone offline.
  //
  // Re-arming is safe on both paths: the native plugin replaces an alarm with
  // the same reminderId, and the worker clears an existing timer before setting
  // a new one.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    async function arm() {
      try {
        const { supabase } = await import('@/lib/supabase');
        const { armVoiceReminders, speakMissedReminders, canSpeakWhenClosed,
                retireExpiredReminders, reportLastAlarm } =
          await import('@/lib/reminder-voice');
        if (cancelled) return;

        // FIRST, retire what is past saying. Nothing in this product has ever
        // marked a reminder done, so they accumulated: twelve of them on 28
        // September, every one overdue, all still counted in Today's Brief as
        // work outstanding. Doing this before arming means the arming below
        // never considers a reminder from two days ago, and the count on the
        // home screen is right from the moment the app opens.
        const retired = await retireExpiredReminders({ supabase, userId: user.id });
        if (retired) console.log('[Aaria] retired', retired, 'expired reminders');
        if (cancelled) return;

        // Only the web path needs notification permission, and only so that it
        // has something to fall back to when no page is open to speak. The
        // native alarm needs none, so this prompt never appears in the app.
        if (!canSpeakWhenClosed()
            && typeof Notification !== 'undefined'
            && Notification.permission === 'default') {
          try { await Notification.requestPermission(); } catch {}
        }

        const armed = await armVoiceReminders({ supabase, userId: user.id });
        if (cancelled) return;
        console.log('[Aaria] reminders armed:', armed.armed, 'via', armed.channel);

        // What the phone did the last time an alarm fired - so "it spoke but
        // did not call" can be answered from a record instead of a guess.
        reportLastAlarm({ supabase, userId: user.id }).catch(() => {});

        // Anything that came due while the phone was in a bag is read out now,
        // rather than being lost in silence.
        await speakMissedReminders({
          supabase, userId: user.id,
          speak: (t, o) => { holdForSpeech(t, { queue: true }); return speak(t, o); },
          prefix: MISSED_PREFIX[String(voiceLang || 'en').split('-')[0]] || MISSED_PREFIX.en,
        });
      } catch {
        // Reminders on the device are an addition to delivery, never a
        // dependency of the app working.
      }
    }

    arm();
    // Anything that creates or changes a reminder can dispatch this to re-arm
    // without waiting for the next app open.
    const onChanged = () => { arm(); };
    window.addEventListener('qk_reminders_changed', onChanged);
    // Coming back to the app after an alarm: send up what the phone noted.
    const onVisible = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const { supabase } = await import('@/lib/supabase');
        const { reportLastAlarm } = await import('@/lib/reminder-voice');
        reportLastAlarm({ supabase, userId: user.id }).catch(() => {});
      } catch {}
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.removeEventListener('qk_reminders_changed', onChanged);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user?.id, voiceLang]);

  // The service worker wakes at the due moment and asks whichever page is open
  // to say the reminder out loud. It only falls back to a silent banner when
  // there is no page to speak — a chime is the failure case here, not the
  // feature.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    function onWorkerMessage(event) {
      const msg = event.data;
      if (!msg || msg.type !== 'REMINDER_DUE' || !msg.text) return;
      holdForSpeech(msg.text);
      speak(String(msg.text), { priority: 'high' });
    }
    navigator.serviceWorker.addEventListener('message', onWorkerMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onWorkerMessage);
  }, []);

  // 'idle' | 'listening' | 'thinking' | 'speaking'
  const [status,     setStatus]     = useState('idle');
  const [open,       setOpen]       = useState(false);
  const [interim,    setInterim]    = useState('');
  const [transcript, setTranscript] = useState('');
  const [reply,      setReply]      = useState(null);
  const [error,      setError]      = useState('');
  const [wakeInfo,   setWakeInfo]   = useState(null);
  const [notice,     setNotice]     = useState(null);   // {text, count} or null
  // Which listener heard the last turn - shown in the dock so "did Aaria hear
  // me, or the phone?" has an answer on screen, not in a settings page.
  const [heardBy,    setHeardBy]    = useState(null);   // {path, finaliseMs} or null
  // Is the microphone actually open yet? Opening it takes a few hundred
  // milliseconds after the tap, and the screen used to say "Listening" at
  // once - so the first word was spoken into a closed microphone ("Remind me
  // to buy milk" arrived as "Money to buy milk", 3 October 2026).
  const [micLive,    setMicLive]    = useState(false);
  // "Which Venu?" - the people Aaria is asking about, shown as buttons.
  const [choices,    setChoices]    = useState(null);
  const choicesRef = useRef(null);
  useEffect(() => { choicesRef.current = choices; }, [choices]);
  const lastListenRef   = useRef(null);  // sent with the next capture call
  const startListenRef  = useRef(null);  // startListening, for the follow-up loop
  const followUpTurns   = useRef(0);     // automatic re-listens in a row
  const followUpTimer   = useRef(null);
  const autoTurnRef     = useRef(false); // this turn was opened by Aaria, not a tap

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
  // "The microphone is taken" / "free again", for the phone-side listener
  // (src/lib/mic-hold.js has the why). Taken when Aaria opens the microphone;
  // free only when the whole turn is over - not listening, no call to the
  // brain in flight, nothing being spoken, no answer awaited.
  const brainBusyRef   = useRef(0);
  const speakUntilRef  = useRef(0);
  const micHold = useMemo(() => createMicHold({
    claim: claimMic,
    release: releaseMic,
    isBusy: () => listeningRef.current
      || submittingRef.current
      || brainBusyRef.current > 0
      || followUpTimer.current !== null
      || Date.now() < speakUntilRef.current
      || isSpeaking(),
  }), []);
  useEffect(() => () => { micHold.dispose(); }, [micHold]);
  // She is about to speak. The phone-side listener must not be transcribing
  // her own voice, so "taken" is said here too - not only when the microphone
  // opens. That covers a one-breath command ("Hey Aaria, remind me..."), a
  // typed question, and a reminder read out on opening, none of which open the
  // microphone. `queue` is for things said one after another.
  const holdForSpeech = useCallback((text, { queue = false } = {}) => {
    const est = Math.min(20000, 1200 + String(text || '').length * 75);
    const from = queue ? Math.max(speakUntilRef.current, Date.now()) : Date.now();
    speakUntilRef.current = Math.min(from + est, Date.now() + 60000);
    if (!hotwordRef.current) micHold.hold();
  }, [micHold]);
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
    // How long she will be talking, at least - there is no dependable
    // "finished speaking" signal, so the microphone is not called free before
    // this has passed (same estimate the follow-up loop waits on).
    holdForSpeech(text);
    try { speak(String(text), { priority: 'high' }); } catch {}
    // No reliable end-of-speech event across the native bridge and the browser,
    // so fall back to idle on a timer proportional to length. Worst case the
    // orb stops pulsing slightly early — cosmetic, never functional.
    const ms = Math.min(9000, 1200 + String(text).length * 55);
    setTimeout(() => setStatus((s) => (s === 'speaking' ? 'idle' : s)), ms);
  }, [holdForSpeech]);

  const stopAll = useCallback(() => {
    if (followUpTimer.current) { clearInterval(followUpTimer.current); followUpTimer.current = null; }
    followUpTurns.current = 0;
    listeningRef.current = false;
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }
    try { cancelSpeech(); } catch {}
    speakUntilRef.current = 0;   // stopped by hand: nothing more will be said
    setInterim('');
    setStatus('idle');
    // Give the microphone back to the hotword, but only after the capture
    // recogniser has actually released it.
    if (hotwordRef.current) setTimeout(() => hotwordRef.current?.resume(), 300);
  }, []);

  // ── the brain call ─────────────────────────────────────────────────────────
  const askBrain = useCallback(async (text, extra = null) => {
    if (!signedIn) {
      setError('Sign in first and I can act on that.');
      setStatus('idle');
      return;
    }
    setStatus('thinking');
    brainBusyRef.current += 1;   // the turn is not over while this is in flight
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
          // How this sentence was heard (engine or phone, timings, what ended
          // the turn). Stored with the capture so a "it cut me off" report can
          // be checked against what actually happened.
          ...(lastListenRef.current ? { listen: lastListenRef.current } : {}),
          // Where the phone is, when it already knows - so a place name is
          // matched to the one nearby, not the first one in the country.
          ...(() => { const p = lastKnownPosition(); return p ? { current_lat: p.latitude, current_lng: p.longitude } : {}; })(),
          ...(extra || {}),
        }),
      });
      lastListenRef.current = null;   // it described THIS sentence only
      const json = await res.json().catch(() => null);
      if (!res.ok || !json) {
        setError('I could not save that. It is still in the box — try again.');
        setStatus('idle');
        return;
      }
      const spoken = json.tts_response || json.assistant?.reply || 'Saved.';
      say(spoken);
      setTranscript('');
      setChoices(Array.isArray(json.choices) && json.choices.length ? json.choices : null);

      // WHEN AARIA ASKS, SHE LISTENS FOR THE ANSWER.
      //
      // 2 October 2026: Aaria asked "eppudu gurthu cheyamantaru?" and then sat
      // there with the microphone off. The server has known how to take the
      // answer since #128 (src/lib/follow-up-answer.js); nothing on the phone
      // ever gave the person the chance to say it without tapping again. A
      // person who asks a question and then looks away is not an assistant.
      //
      // So: if the reply is a question, wait until she has finished speaking,
      // then open the microphone. At most three in a row, and saying nothing
      // simply ends it (the listener gives up on its own after 8 seconds).
      const asked = !!json.follow_up || /[?？]\s*$/.test(String(spoken).trim());
      if (asked && followUpTurns.current < 3) {
        followUpTurns.current += 1;
        const startedAt = Date.now();
        // The native voice cannot tell us when it stops, so there is a floor
        // estimated from the length of the sentence; where the end IS
        // observable (isSpeaking), we wait for that as well.
        const atLeast = Math.min(20000, 1200 + String(spoken).length * 75);
        if (followUpTimer.current) clearInterval(followUpTimer.current);
        followUpTimer.current = setInterval(() => {
          const waited = Date.now() - startedAt;
          if (waited < atLeast) return;
          if (isSpeaking() && waited < 25000) return;
          clearInterval(followUpTimer.current); followUpTimer.current = null;
          if (!listeningRef.current) { autoTurnRef.current = true; startListenRef.current?.(); }
        }, 150);
      } else {
        followUpTurns.current = 0;
      }

      // ARM THE ALARM FROM HERE TOO.
      //
      // 30 September 2026, 8:08 pm: the founder tapped THIS microphone, said
      // "ek minute ke baad Surya Kiran ko call karo", the keep was saved with
      // the right name and 8:09 pm, Aaria confirmed it aloud - and at 8:09
      // nothing happened. #127 had taught the home-screen capture box to hand
      // a new reminder to the native alarm the moment it is saved; this dock
      // is a second entry point to the same brain and was never taught the
      // same thing. Two microphones, one of which set alarms.
      //
      // Same call, same guard, same safety as the dashboard: re-arming
      // replaces an alarm with the same id, never throws, reports what it did.
      if (json.reminder_at || json.keep?.reminder_at || json.reminder) {
        try {
          const { supabase } = await import('@/lib/supabase');
          const { armVoiceReminders } = await import('@/lib/reminder-voice');
          armVoiceReminders({ supabase, userId: user?.id })
            .then((r) => console.log('[Aaria] armed after capture:', r))
            .catch(() => {});
        } catch { /* arming is best-effort; the keep is already saved */ }
      }
    } catch {
      setError('Network problem. Nothing was lost — try again.');
      setStatus('idle');
    }
  }, [signedIn, accessToken, voiceLang, pathname, here, say, user?.id]);

  // A tap on one of the offered names. Exact - the id goes with it, so two
  // contacts with the same name can be told apart.
  const choose = useCallback((choice) => {
    if (!choice) return;
    if (followUpTimer.current) { clearInterval(followUpTimer.current); followUpTimer.current = null; }
    if (listeningRef.current && recognitionRef.current) {
      // Close the automatic listening turn without submitting it.
      autoTurnRef.current = false;
      try { recognitionRef.current.abort?.(); } catch {}
      recognitionRef.current = null;
      listeningRef.current = false;
    }
    try { cancelSpeech(); } catch {}
    setChoices(null);
    setInterim('');
    setTranscript(choice.label || choice.name);
    askBrain(choice.name, choice.id ? { answer_contact_id: choice.id } : null);
  }, [askBrain]);

  // ── the single entry point for everything Aaria hears or is typed ──────────
  const submit = useCallback(async (raw) => {
    const text = String(raw || '').trim();
    if (!text || submittingRef.current) return;
    // A turn Aaria opened herself can catch the tail of her own question.
    // Hearing her own words is not an answer.
    const auto = autoTurnRef.current;
    autoTurnRef.current = false;
    if (auto && looksLikeSelfEcho(text)) { setTranscript(''); setInterim(''); return; }
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
      // A turn Aaria opened to hear an ANSWER says so, and the server then
      // never files a short non-answer as a brand-new keep (3 October 2026:
      // "Which Vinay?" - "Surya Exactly." was saved as a note and became a
      // second question about six Suryas).
      await askBrain(text, auto ? { answering: true } : null);
    } finally {
      submittingRef.current = false;
    }
  }, [here, pathname, router, say, stopAll, askBrain]);

  // ── listening, path B: the phone's own recogniser (browser SpeechRecognition)
  // The fallback since step 11 part 3. Unchanged otherwise.
  const startBrowserListening = useCallback(() => {
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
    // W5 (redone on the path that is actually live).
    //
    // This used to be `continuous = false`, which hands endpointing - the
    // decision that the person has stopped talking - entirely to the browser.
    // The browser's threshold is tuned for English and cannot be configured,
    // and NVIDIA's streaming session is explicit that Indic pauses are longer,
    // so English tuning "fails sooner than it suggests". In practice it cut
    // people off exactly where our users pause: mid-sentence, switching
    // between Telugu and English.
    //
    // Continuous mode plus our own silence timer moves that decision into
    // src/lib/endpointing.js, where it is a per-language dial we can tune
    // against real recordings. Finals accumulate across pauses instead of each
    // one ending the turn.
    rec.continuous     = true;
    rec.interimResults = true;
    rec.lang           = speechLang(voiceLang);

    const silenceMs = endpointSilenceMsFor(rec.lang);
    let heard = '';          // finals accumulated across pauses
    let lastPartial = '';
    let silenceTimer = null;
    let maxTimer = null;
    let finished = false;

    const clearTimers = () => {
      if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
      if (maxTimer) { clearTimeout(maxTimer); maxTimer = null; }
    };

    // The endpoint decision itself. Called from the silence timer, or from the
    // hard cap. Idempotent - the browser can still fire onend underneath us.
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimers();
      const text = (heard + ' ' + lastPartial).trim();
      try { rec.stop(); } catch {}
      if (text) {
        setInterim('');
        setTranscript(text);
        submit(text);
      }
    };

    const armSilence = () => {
      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(finish, silenceMs);
    };

    rec.onstart = () => {
      listeningRef.current = true;
      setMicLive(true);
      setStatus('listening');
      // A hard cap so a stuck recogniser cannot hold the microphone forever.
      // We take what we have rather than dropping the turn.
      maxTimer = setTimeout(finish, MAX_LISTEN_MS);
    };

    rec.onresult = (ev) => {
      let final = '', partial = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) final += r[0].transcript;
        else partial += r[0].transcript;
      }
      if (final) {
        // A final no longer ends the turn. It is one phrase; the person may
        // still be mid-sentence and simply pausing to switch language.
        heard = (heard + ' ' + final).trim();
        lastPartial = '';
        setInterim('');
      }
      if (partial) {
        lastPartial = partial;
        setInterim((heard + ' ' + partial).trim());
      }
      // Any speech at all restarts the clock.
      if (final || partial) armSilence();
    };

    rec.onerror = (ev) => {
      listeningRef.current = false;
      clearTimers();
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
      clearTimers();
      // The browser can end the session on its own - a long silence, a tab
      // change, an internal timeout. Anything already heard must still be
      // acted on, or the turn is silently lost.
      if (!finished) {
        finished = true;
        const text = (heard + ' ' + lastPartial).trim();
        if (text) { setTranscript(text); submit(text); }
      }
      setStatus((s) => (s === 'listening' ? 'idle' : s));
      setInterim('');
      if (hotwordRef.current) setTimeout(() => hotwordRef.current?.resume(), 300);
    };

    recognitionRef.current = rec;
    try { rec.start(); }
    catch { setError('Could not start the microphone.'); setStatus('idle'); }
  }, [voiceLang, submit]);

  // ── listening, path A: through Aaria's engine while the person speaks ─────
  // src/lib/listen-stream.js has the why. Sarvam saaras:v4 with this user's
  // names, words on screen as they are heard, the same per-language silence
  // wait. Any failure before a word is heard drops to path B above, so the
  // worst case is exactly what the app did yesterday.
  const namesRef = useRef({ names: [], at: 0 });
  // The list from last time, so the very first sentence after opening the app
  // already has the names (3 October: every first turn went up with none).
  useEffect(() => {
    try {
      const cached = JSON.parse(localStorage.getItem('qk_spoken_names') || 'null');
      if (Array.isArray(cached) && cached.length && !namesRef.current.names.length) {
        namesRef.current = { names: cached.slice(0, 40), at: 0 };
      }
    } catch {}
  }, []);
  const refreshNames = useCallback(async () => {
    if (!accessToken) return namesRef.current.names;
    if (Date.now() - namesRef.current.at < 10 * 60 * 1000) return namesRef.current.names;
    try {
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const kill = setTimeout(() => ctl?.abort(), 5000);
      const res = await fetch('/api/voice/spoken-names', {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: ctl?.signal,
      });
      clearTimeout(kill);
      const json = await res.json().catch(() => null);
      if (Array.isArray(json?.names)) {
        namesRef.current = { names: json.names, at: Date.now() };
        try { localStorage.setItem('qk_spoken_names', JSON.stringify(json.names.slice(0, 40))); } catch {}
      }
    } catch {}
    return namesRef.current.names;
  }, [accessToken]);

  // Wake the engine and fetch the names before the first tap, not during it.
  useEffect(() => {
    if (silent || !signedIn) return;
    warmEngine();
    refreshNames();
  }, [silent, signedIn, refreshNames]);

  const startListening = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (listeningRef.current) return;
    if (!listenStreamWanted() || !streamingSupported(window)) {
      const info = { path: 'phone', reason: listenStreamWanted() ? 'not supported here' : 'switched off' };
      recordLastListen(info); lastListenRef.current = info; setHeardBy(info);
      startBrowserListening();
      return;
    }

    try { hotwordRef.current?.suspend(); } catch {}
    try { cancelSpeech(); } catch {}
    setError('');
    setTranscript('');
    setInterim('');
    // The question stays on screen while she listens for its answer. Only a
    // turn the person started themselves clears the last reply.
    const answerTurn = autoTurnRef.current;
    if (!answerTurn) { setReply(null); setChoices(null); }
    setOpen(true);
    listeningRef.current = true;
    setMicLive(false);
    setStatus('listening');
    refreshNames();   // for the NEXT turn, if the list was not loaded yet

    const lang = speechLang(voiceLang);
    const session = startListenStream({
      lang,
      // Listening for "which one?" - the names on offer go first, so the
      // recogniser leans toward the answers that are actually possible.
      keyterms: answerTurn && Array.isArray(choicesRef.current)
        ? [...choicesRef.current.map((c) => c.name), ...namesRef.current.names]
        : namesRef.current.names,
      silenceMs: endpointSilenceMsFor(lang),
      maxMs: MAX_LISTEN_MS,
      onPartial: (text) => setInterim(text),
      // The moment audio is really flowing: say so on screen and with a short
      // buzz, so the person knows when to start speaking.
      onLive: () => {
        setMicLive(true);
        try { navigator.vibrate?.(35); } catch {}
      },
    });
    // stopAll() calls .stop() on whatever is here: for this path that means
    // "finish now and keep what was said", exactly like the browser path.
    recognitionRef.current = { stop: session.stop, abort: session.abort };

    session.result.then(
      ({ text, ...turn }) => {
        if (recognitionRef.current?.stop === session.stop) recognitionRef.current = null;
        listeningRef.current = false;
        const info = { path: 'engine', ...turn, chars: text.length };
        recordLastListen(info); lastListenRef.current = info; setHeardBy(info);
        setInterim('');
        setStatus((st) => (st === 'listening' ? 'idle' : st));
        if (text) { setTranscript(text); submit(text); }
        if (hotwordRef.current) setTimeout(() => hotwordRef.current?.resume(), 300);
      },
      (err) => {
        if (recognitionRef.current?.stop === session.stop) recognitionRef.current = null;
        listeningRef.current = false;
        setInterim('');
        const info = { path: err?.fallback ? 'phone' : 'none', reason: err?.reason || 'unknown' };
        recordLastListen(info);
        // Silence after Aaria's own question is normal - say nothing. Silence
        // after the person tapped the mic deserves a word, or it looks broken.
        const wasAuto = autoTurnRef.current;
        autoTurnRef.current = false;
        if (!wasAuto && err?.reason === 'nothing heard') {
          setError('I did not hear anything. Tap the mic and try again.');
        }
        if (err?.fallback) {
          lastListenRef.current = info; setHeardBy(info);
          startBrowserListening();
          if (err.lostSpeech) setError('Say that again, please.');
          return;
        }
        setStatus((st) => (st === 'listening' ? 'idle' : st));
        if (hotwordRef.current) setTimeout(() => hotwordRef.current?.resume(), 300);
      },
    );
  }, [voiceLang, submit, startBrowserListening, refreshNames]);
  useEffect(() => { startListenRef.current = startListening; }, [startListening]);

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

  // ── place reminders ────────────────────────────────────────────────────────
  // "Remind me to pick up beer when I reach Chintal Kunta." Nothing used to
  // watch for the arrival at all (see src/lib/geo.js). Started for any
  // signed-in user, on every screen INCLUDING the silent ones - Drive mode is
  // exactly where arriving somewhere happens. Unlike the watcher above, this
  // DOES speak unprompted: the person asked to be told on arrival, the same
  // way an alarm they set rings.
  const tokenRef = useRef(accessToken);
  useEffect(() => { tokenRef.current = accessToken; }, [accessToken]);
  useEffect(() => {
    if (!signedIn) return;
    let stopped = false;
    import('@/lib/geo').then(({ startGeoFencing }) => {
      if (stopped) return;
      startGeoFencing((keep) => {
        const where = keep?.location_name || 'your place';
        const what  = String(keep?.content || keep?.subject || '').slice(0, 120);
        const line  = what ? `You're at ${where}. ${what}` : `You're at ${where}.`;
        if (silent) { try { speak(line, { priority: 'high' }); } catch {} }
        else { setOpen(true); say(line); }
      }, () => tokenRef.current);
    }).catch(() => {});
    return () => {
      stopped = true;
      import('@/lib/geo').then(({ stopGeoFencing }) => stopGeoFencing()).catch(() => {});
    };
  }, [signedIn, silent, say]);

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
    notice, here, silent, signedIn, heardBy, micLive, choices, choose,
    submit, say, stopAll, startListening, toggleListening,
    setError, setReply,
  }), [status, open, interim, transcript, reply, error, wakeInfo, hotwordOn, notice, heardBy, micLive, choices, choose,
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
