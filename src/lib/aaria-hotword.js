// src/lib/aaria-hotword.js
// ─────────────────────────────────────────────────────────────────────────────
// Saying "Aaria" out loud, on the web, without touching the phone.
//
// WHERE THIS FITS
// src/lib/wake-word-engine.js already models wake-up honestly across three
// tiers, and its conclusion for the web was: not possible, degrade to a tap.
// That is right for *background* listening — a browser tab cannot listen while
// closed, and pretending otherwise is the exact dishonesty that engine was
// written to remove.
//
// But it is too pessimistic for the case QuietKeep actually cares about: the
// shop counter. A phone or tablet propped up, screen on, QuietKeep open, hands
// covered in flour or engine oil. There, the tab IS open, and the browser will
// happily run continuous speech recognition. So this module adds exactly that
// and nothing more.
//
// THE FOUR THINGS THAT MAKE THIS HARD, AND HOW EACH IS HANDLED
//
//  1. BROWSERS KILL IT. Chrome ends continuous recognition after roughly a
//     minute of silence, and after every result. We restart on `onend`, with a
//     backoff, forever — until stop() is called.
//
//  2. TWO RECOGNISERS FIGHT. A second SpeechRecognition while one is running
//     throws InvalidStateError and can wedge the microphone until reload. This
//     module therefore never starts the real capture itself: it detects the
//     word, suspends itself, and hands control back. The caller resumes it.
//
//  3. IT MISHEARS. "Aaria" is heard as "area", "aria", "arya", "idea". A
//     hotword that only accepts the exact spelling appears broken. We accept a
//     small, explicit set of near-misses rather than a fuzzy distance function,
//     because a fuzzy match on a two-syllable word fires on half of English.
//
//  4. IT IS A MICROPHONE THAT IS ALWAYS ON. So it is off unless the user turns
//     it on, it stops on tab-hide, and the caller is expected to show that it
//     is running. No silent listening, ever.
// ─────────────────────────────────────────────────────────────────────────────

/** Near-misses we accept, per wake word. Explicit beats fuzzy. */
const HOMOPHONES = {
  aaria: ['aaria', 'aria', 'area', 'arya', 'ariya', 'aariya', 'idea aaria'],
  lotus: ['lotus', 'notice', 'lotto'],
};

export function isHotwordSupported() {
  if (typeof window === 'undefined') return false;
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Build the matcher once, so the hot path is a plain substring scan. */
function buildMatcher(wakeWord) {
  const w = String(wakeWord || 'aaria').toLowerCase().trim();
  const forms = new Set([w, ...(HOMOPHONES[w] || [])]);
  return (heard) => {
    const t = String(heard || '').toLowerCase();
    for (const f of forms) {
      // Word-boundary check, so "areas" and "malaria" do not wake her up.
      const re = new RegExp(`(^|[^a-z])${escapeRe(f)}([^a-z]|$)`);
      if (re.test(t)) return f;
    }
    return null;
  };
}

/**
 * Everything the user said AFTER naming her.
 *
 * This is what makes one-breath commands possible. "Aaria, open invoices" has
 * to work, because that is how people actually talk to an assistant — and the
 * alternative (say the name, wait for a light, then speak) is a walkie-talkie,
 * not an assistant.
 *
 * Returns '' when she was named and nothing followed, which is the signal to
 * hand over to the capture recogniser and listen for the command instead.
 */
export function afterWake(heard, matchedForm) {
  const text = String(heard || '');
  const re = new RegExp(`(^|[^a-z])${escapeRe(matchedForm)}([^a-z]|$)`, 'i');
  const m = re.exec(text);
  if (!m) return text.trim();
  // Cut at the end of the matched word, keeping any trailing delimiter out.
  const cut = m.index + m[0].length - (m[2] ? m[2].length : 0);
  return text.slice(cut).replace(/^[\s,.:;—–-]+/, '').trim();
}

/**
 * Start listening for the wake word.
 *
 * @param {object}   opts
 * @param {string}   opts.wakeWord  default 'aaria'
 * @param {string}   opts.lang      BCP-47, e.g. 'te-IN'
 * @param {Function} opts.onWake      named, nothing followed -> caller should listen
 * @param {Function} opts.onUtterance named AND a command followed, in one breath
 * @param {Function} opts.onArmed     name heard (interim) -> light up immediately
 * @param {Function} [opts.onError] called with a short reason string
 * @returns {{stop:Function, suspend:Function, resume:Function, running:Function}|null}
 *          null when the browser cannot do this at all.
  if (!isHotwordSupported()) return null;

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const matches = buildMatcher(wakeWord);

  let rec = null;
  let stopped = false;      // permanent, set by stop()
  let suspended = false;    // temporary, set by suspend()
  let backoff = 400;
  let restartTimer = null;
  let lastFireAt = 0;
  let armed = false;   // named, waiting to see if a command follows

  function clearTimer() {
    if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
  }

  function scheduleRestart() {
    clearTimer();
    if (stopped || suspended) return;
    restartTimer = setTimeout(() => { spin(); }, backoff);
    // Grow the gap on repeated immediate failures so a permanently denied
    // microphone cannot become a busy loop. Reset on any successful start.
    backoff = Math.min(backoff * 2, 15000);
  }

  function spin() {
    if (stopped || suspended) return;
    if (typeof document !== 'undefined' && document.hidden) { scheduleRestart(); return; }

    try { if (rec) rec.abort(); } catch {}
    rec = new SR();
    rec.continuous     = true;
    rec.interimResults = true;   // fire on the interim, so she responds mid-sentence
    rec.lang           = lang;

    rec.onstart = () => { backoff = 400; };

    rec.onresult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        const heard = res[0]?.transcript || '';
        const hit = matches(heard);
        if (!hit) continue;

        // ── INTERIM: she has been named, but we do not yet know whether a
        // command followed. Light up immediately so the user gets the same
        // instant acknowledgement Alexa gives, but do NOT hand over yet.
        if (!res.isFinal) {
          if (!armed) { armed = true; try { onArmed?.(); } catch {} }
          continue;
        }

        // ── FINAL: now we know what the whole utterance was.
        // One wake per second, whatever the browser does with interim results —
        // otherwise a single "Aaria" fires several times as the interim firms up.
        const now = Date.now();
        if (now - lastFireAt < 1000) return;
        lastFireAt = now;
        armed = false;

        const rest = afterWake(heard, hit);

        if (rest) {
          // "Aaria, open invoices" — the entire command arrived in one breath.
          //
          // The obvious implementation hands off to a second recogniser the
          // moment the name is heard. That loses everything spoken during the
          // 300-500ms the new recogniser takes to start, which is precisely the
          // words that matter. So we keep this recogniser and deliver the text
          // ourselves; no handoff, nothing dropped.
          try { onUtterance?.(rest); } catch {}
          return;
        }

        // She was named and nothing followed. Hand over so the capture
        // recogniser can listen for the command as a separate utterance.
        // Suspend BEFORE handing over: two live recognisers wedge the mic.
        suspend();
        try { onWake?.(hit); } catch {}
        return;
      }
    };

    rec.onerror = (ev) => {
      const e = ev?.error;
      if (e === 'not-allowed' || e === 'service-not-allowed') {
        // Permission is gone. Retrying cannot fix that and will spam the user.
        stopped = true;
        clearTimer();
        try { onError?.('microphone-denied'); } catch {}
        return;
      }
      // 'no-speech' and 'aborted' are the normal texture of continuous
      // recognition, not failures. Let onend restart us.
    };

    rec.onend = () => { scheduleRestart(); };

    try { rec.start(); }
    catch { scheduleRestart(); }
  }

  function suspend() {
    suspended = true;
    clearTimer();
    try { rec?.abort(); } catch {}
  }

  function resume() {
    if (stopped) return;
    suspended = false;
    backoff = 400;
    // Small delay: the caller's recogniser needs to have fully released the mic.
    clearTimer();
    restartTimer = setTimeout(spin, 350);
  }

  function stop() {
    stopped = true;
    clearTimer();
    try { rec?.abort(); } catch {}
    rec = null;
  }

  // A hidden tab should not hold the microphone.
  const onVisibility = () => {
    if (typeof document === 'undefined') return;
    if (document.hidden) { try { rec?.abort(); } catch {} }
    else if (!stopped && !suspended) scheduleRestart();
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility);
  }

  // ── the microphone claim protocol ──────────────────────────────────────────
  // AariaProvider suspends this handle directly, because it holds the reference.
  // Nothing else does — and other components in this app open their own
  // recognisers: <VoiceCapture> on the dashboard is the live example. A second
  // SpeechRecognition started while this one is running throws InvalidStateError
  // and can leave the microphone unusable until the page is reloaded.
  //
  // So any component that is about to open a recogniser announces it, and we get
  // out of the way. An event rather than an import, because the alternative is
  // every microphone owner in the app importing this module and knowing about
  // each other.
  const onClaim   = () => suspend();
  const onRelease = () => resume();
  if (typeof window !== 'undefined') {
    window.addEventListener('qk_mic_claim', onClaim);
    window.addEventListener('qk_mic_release', onRelease);
  }

  spin();

  return {
    stop() {
      stop();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('qk_mic_claim', onClaim);
        window.removeEventListener('qk_mic_release', onRelease);
      }
    },
    suspend,
    resume,
    running: () => !stopped && !suspended,
  };
}

/**
 * Announce that you are about to open a microphone, and that you are done.
 * Safe to call when no hotword is running — it is a no-op.
 */
export function claimMic() {
  if (typeof window === 'undefined') return;
  try { window.dispatchEvent(new CustomEvent('qk_mic_claim')); } catch {}
}
export function releaseMic() {
  if (typeof window === 'undefined') return;
  try { window.dispatchEvent(new CustomEvent('qk_mic_release')); } catch {}
}

// ── user preference ──────────────────────────────────────────────────────────
const LS_WEB_HOTWORD = 'qk_web_hotword';

export function isWebHotwordEnabled() {
  if (typeof window === 'undefined') return false;
  try { return localStorage.getItem(LS_WEB_HOTWORD) === '1'; } catch { return false; }
}

export function setWebHotwordEnabled(on) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(LS_WEB_HOTWORD, on ? '1' : '0'); } catch {}
}

export default startWebHotword;
