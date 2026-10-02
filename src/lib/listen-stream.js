// src/lib/listen-stream.js
// Hear the person WHILE they speak, through Aaria's engine. (plan step 11, part 3)
//
// WHAT THIS REPLACES, AND WHY
// The live microphone in QuietKeep (src/lib/context/aaria.jsx) used the
// phone's own built-in recogniser - the one the browser provides. That
// recogniser:
//   - is not the one we measured: every number on the NVIDIA slide is Sarvam
//     saaras:v4 through the engine, not the phone's recogniser;
//   - cannot be handed the names this user says, so "Surya Kiran" stays at the
//     mercy of a general model (the boost list in src/lib/spoken-names.js only
//     ever reached the Android background service, not the dock);
//   - is tuned for English and cannot be configured.
//
// The engine's /api/voice/listen-stream socket (pranix-aaria #164/#165) takes
// audio as it is spoken and returns words as they are heard. Measured on the
// same 150 recordings (realtime-asr-benchmark run #1, 1 Oct 2026):
//   Telugu 13.3% word error (batch 13.0%), Hindi 7.0%, English 4.4%;
//   finished sentence 0.50 s p50 / 0.65 s p95 after "stop".
//
// HOW A TURN WORKS
//   1. The socket opens and the microphone starts AT THE SAME TIME. Audio
//      spoken before the engine says "ready" is kept and sent the moment it
//      does, so a slow first connection does not cost the first words.
//   2. 100 ms frames of 16 kHz mono 16-bit audio go up as they are captured.
//   3. "Has the person stopped?" is decided HERE, with the same per-language
//      silence wait the old path used (src/lib/endpointing.js). Loudness on
//      the microphone and any word coming back both count as speech.
//   4. On stop: {"event":"stop"}, wait for {"event":"done"}, hand the text on.
//
// FALLBACK IS THE DEFAULT POSTURE
// If anything goes wrong before a single word has been heard - no socket, no
// "ready" in time, a refusal, no microphone - the caller falls back to the
// phone's own recogniser and the person never sees a difference. If it goes
// wrong after words were heard, we keep the words.
//
// Everything that touches the browser is injectable, so the whole turn runs
// under plain node in tests/listen-stream.test.mjs.

export const LISTEN_STREAM_URL = 'wss://pranix-aaria.onrender.com/api/voice/listen-stream';
export const ENGINE_HEALTH_URL = 'https://pranix-aaria.onrender.com/api/health';

export const TARGET_RATE   = 16000;
export const FRAME_SAMPLES = 1600;   // 100 ms at 16 kHz
export const READY_TIMEOUT_MS   = 4000;
export const DONE_TIMEOUT_MS    = 5000;
export const NOTHING_HEARD_MS   = 8000;  // tapped the mic and said nothing
export const MAX_KEYTERMS       = 40;

const PREF_KEY = 'qk_listen_stream';
const LAST_KEY = 'qk_listen_last';

// ── preferences ──────────────────────────────────────────────────────────────

/** On unless the person switched it off in Voice settings. */
export function listenStreamWanted(storage) {
  try {
    const s = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
    return (s?.getItem(PREF_KEY) ?? '1') !== '0';
  } catch { return true; }
}

export function setListenStreamWanted(on, storage) {
  try {
    const s = storage || localStorage;
    s.setItem(PREF_KEY, on ? '1' : '0');
  } catch {}
}

/** What happened on the last turn - shown in Voice settings so a phone test has evidence. */
export function recordLastListen(info, storage) {
  try {
    const s = storage || localStorage;
    s.setItem(LAST_KEY, JSON.stringify({ ...info, at: new Date().toISOString() }));
  } catch {}
}

export function readLastListen(storage) {
  try {
    const s = storage || localStorage;
    return JSON.parse(s.getItem(LAST_KEY) || 'null');
  } catch { return null; }
}

/**
 * What the server keeps about how a sentence was heard: a fixed set of small
 * fields, nothing free-form beyond two short labels. Anything else the phone
 * sends is dropped. Returns null when there is nothing worth keeping.
 */
export function cleanListenEvidence(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  if (['engine', 'phone', 'none'].includes(raw.path)) out.path = raw.path;
  for (const k of ['firstWordsMs', 'finaliseMs', 'keyterms', 'heardMs', 'speechMs', 'peak', 'floor', 'chars']) {
    const v = raw[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.round(v * 10000) / 10000;
  }
  for (const k of ['reason', 'stopReason']) {
    if (typeof raw[k] === 'string' && raw[k]) out[k] = raw[k].slice(0, 80);
  }
  return out.path ? out : null;
}

/** Does this browser have everything a streaming turn needs? */
export function streamingSupported(win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  if (!w) return false;
  return !!(w.WebSocket
    && w.navigator?.mediaDevices?.getUserMedia
    && (w.AudioContext || w.webkitAudioContext));
}

/** Wake the engine before the person taps the mic (free hosting sleeps). Never throws. */
export function warmEngine(fetchImpl) {
  try {
    const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    f?.(ENGINE_HEALTH_URL, { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
  } catch {}
}

// ── audio arithmetic (pure) ──────────────────────────────────────────────────

/** Average-down to 16 kHz. Input already at 16 kHz is returned as is. */
export function downsampleTo16k(input, inRate) {
  if (!input || !input.length) return new Float32Array(0);
  if (!inRate || inRate === TARGET_RATE) return input;
  if (inRate < TARGET_RATE) return input; // never upsample; the engine copes
  const ratio = inRate / TARGET_RATE;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  let pos = 0;
  for (let i = 0; i < outLen; i++) {
    const end = Math.min(input.length, Math.round((i + 1) * ratio));
    let sum = 0, n = 0;
    for (; pos < end; pos++) { sum += input[pos]; n++; }
    out[i] = n ? sum / n : 0;
  }
  return out;
}

/** Float [-1, 1] → 16-bit little-endian samples. */
export function floatToPcm16(input) {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const v = Math.max(-1, Math.min(1, input[i]));
    out[i] = v < 0 ? Math.round(v * 0x8000) : Math.round(v * 0x7fff);
  }
  return out;
}

export function rms(input) {
  if (!input || !input.length) return 0;
  let s = 0;
  for (let i = 0; i < input.length; i++) s += input[i] * input[i];
  return Math.sqrt(s / input.length);
}

/**
 * Collects samples into fixed 100 ms frames.
 * push(Float32Array) returns the complete frames it produced.
 */
export function createFramer(frameSamples = FRAME_SAMPLES) {
  let buf = new Float32Array(0);
  return {
    push(samples) {
      const merged = new Float32Array(buf.length + samples.length);
      merged.set(buf, 0); merged.set(samples, buf.length);
      const frames = [];
      let off = 0;
      while (merged.length - off >= frameSamples) {
        frames.push(merged.slice(off, off + frameSamples));
        off += frameSamples;
      }
      buf = merged.slice(off);
      return frames;
    },
  };
}

/**
 * Loudness-based speech detector.
 *
 * WHAT WENT WRONG THE FIRST TIME (2 October 2026, the founder's first test)
 * "Remind me to buy milk when I reach Mansoorabad" was cut after "Remind me to
 * buy". The first version learned the room's loudness from the first three
 * frames only. Tap and speak straight away and those frames ARE speech, so the
 * bar for "this is speech" was set above the person's own voice; nothing after
 * the first loud syllable counted, the silence wait ran out mid-sentence.
 *
 * NOW: the room level is the QUIETEST frame of the last three seconds. Speech
 * always has gaps between words, so that minimum finds the room even when the
 * person starts talking at once, keeps following it if the room changes, and
 * can never be set by the voice alone for long. Until a real gap has been
 * seen the detector says "not speech" - which only delays the start of the
 * silence wait, it can never end a turn early.
 */
export function createLoudness({ minLevel = 0.005, factor = 2.5, windowFrames = 30 } = {}) {
  const recent = [];
  let peak = 0;
  return {
    isSpeech(level) {
      recent.push(level);
      if (recent.length > windowFrames) recent.shift();
      if (level > peak) peak = level;
      let floor = Infinity;
      for (const v of recent) if (v < floor) floor = v;
      return level > Math.max(minLevel, floor * factor);
    },
    floor() { let f = Infinity; for (const v of recent) if (v < f) f = v; return recent.length ? f : 0; },
    peak() { return peak; },
  };
}

export function cleanKeyterms(list) {
  const seen = new Set(), out = [];
  for (const raw of list || []) {
    const t = String(raw || '').trim().replace(/\s+/g, ' ');
    if (!t || t.length > 60) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k); out.push(t);
    if (out.length >= MAX_KEYTERMS) break;
  }
  return out;
}

// ── one listening turn ───────────────────────────────────────────────────────

class ListenStreamError extends Error {
  // fallback:   true = the engine path failed; use the phone's own recogniser.
  // lostSpeech: true = the person had already spoken and those words were not
  //             heard by anyone - ask them to say it again.
  constructor(reason, { fallback = true, lostSpeech = false } = {}) {
    super(reason);
    this.reason = reason;
    this.fallback = fallback;
    this.lostSpeech = lostSpeech;
  }
}

/**
 * Start one turn. Returns { result, stop, abort }.
 *   result  Promise<{ text, firstWordsMs, finaliseMs, keyterms }>
 *           rejects with { reason, fallback, lostSpeech } - fallback === true
 *           means "the engine path failed, use the phone's own recogniser".
 *           Stopping or saying nothing rejects with fallback === false.
 *   stop()  the person tapped stop: finish now and keep what was said.
 *   abort() drop everything (the assistant was closed).
 */
export function startListenStream({
  lang,
  keyterms = [],
  silenceMs,
  maxMs = 15000,
  onPartial = () => {},
  onSpeech = () => {},
  deps = {},
} = {}) {
  const W = deps.window || (typeof window !== 'undefined' ? window : {});
  const WS = deps.WebSocket || W.WebSocket;
  const getUserMedia = deps.getUserMedia
    || ((c) => W.navigator.mediaDevices.getUserMedia(c));
  const AC = deps.AudioContext || W.AudioContext || W.webkitAudioContext;
  const setT = deps.setTimeout || setTimeout;
  const clearT = deps.clearTimeout || clearTimeout;
  const now = deps.now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const url = deps.url || LISTEN_STREAM_URL;

  const t0 = now();
  const terms = cleanKeyterms(keyterms);
  let ws = null, stream = null, ctx = null, node = null, source = null;
  let ready = false, ended = false, stopSent = false;
  let speechSeen = false, firstWordsMs = null, tStop = null;
  let lastPartial = '';
  const finals = [];
  const pending = [];                 // frames captured before "ready"
  const framer = createFramer();
  const loud = createLoudness();
  const timers = {};
  let resolveFn, rejectFn;
  const result = new Promise((res, rej) => { resolveFn = res; rejectFn = rej; });

  const clear = (k) => { if (timers[k]) { clearT(timers[k]); timers[k] = null; } };
  const clearAll = () => Object.keys(timers).forEach(clear);

  function releaseAudio() {
    try { node && (node.onaudioprocess = null); } catch {}
    try { node?.disconnect(); } catch {}
    try { source?.disconnect(); } catch {}
    try { stream?.getTracks?.().forEach((t) => t.stop()); } catch {}
    try { ctx?.close?.(); } catch {}
    node = null; source = null; stream = null; ctx = null;
  }

  function closeSocket() {
    try { ws && ws.readyState <= 1 && ws.close(); } catch {}
  }

  function heardText() {
    return [...finals, lastPartial].join(' ').replace(/\s+/g, ' ').trim();
  }

  function succeed(text) {
    if (ended) return;
    ended = true;
    clearAll(); releaseAudio(); closeSocket();
    resolveFn({
      text,
      firstWordsMs,
      finaliseMs: tStop === null ? null : Math.round(now() - tStop),
      keyterms: terms.length,
      // Evidence for the next "it cut me off": how long we listened, how much
      // of it counted as speech, how loud, and what ended the turn.
      heardMs: frames * 100,
      speechMs: speechFrames * 100,
      peak: Math.round(loud.peak() * 1000) / 1000,
      floor: Math.round(loud.floor() * 10000) / 10000,
      stopReason,
    });
  }

  function fail(reason, { fallback = true } = {}) {
    if (ended) return;
    const text = heardText();
    if (text) { succeed(text); return; }         // keep what was heard
    ended = true;
    clearAll(); releaseAudio(); closeSocket();
    rejectFn(new ListenStreamError(reason, { fallback, lostSpeech: fallback && speechSeen }));
  }

  function send(data) {
    try { ws.send(data); } catch {}
  }

  // The person has stopped (silence, cap, or a tap on stop).
  function endpoint() {
    if (ended || stopSent) return;
    clear('silence'); clear('max'); clear('nothing');
    releaseAudio();
    if (!ready) {
      // Never got the engine. If they spoke, those words are lost to the
      // engine - fall back and let them say it again.
      fail('not ready when the person stopped');
      return;
    }
    stopSent = true;
    tStop = now();
    send(JSON.stringify({ event: 'stop' }));
    timers.done = setT(() => {
      const text = heardText();
      if (text) succeed(text); else fail('no finished sentence from the engine', { fallback: speechSeen });
    }, DONE_TIMEOUT_MS);
  }

  function armSilence() {
    clear('silence');
    timers.silence = setT(endpoint, silenceMs ?? 1200);
  }

  function speechNow() {
    if (!speechSeen) { speechSeen = true; clear('nothing'); onSpeech(); }
    armSilence();
  }

  function onFrame(frame) {
    const pcm = floatToPcm16(frame).buffer;
    if (loud.isSpeech(rms(frame))) speechNow();
    if (ready) send(pcm); else pending.push(pcm);
  }

  // ── socket ──
  try {
    ws = new WS(url);
    ws.binaryType = 'arraybuffer';
  } catch (e) {
    fail('could not open the socket');
    return { result, stop: () => {}, abort: () => {} };
  }

  timers.ready = setT(() => { if (!ready) fail('engine not ready in time'); }, READY_TIMEOUT_MS);

  ws.onopen = () => {
    send(JSON.stringify({
      event: 'start',
      lang: String(lang || 'en').split('-')[0].toLowerCase(),
      endpointing: 'manual',
      ...(terms.length ? { keyterms: terms } : {}),
    }));
  };
  ws.onerror = () => { if (!ended && !stopSent) fail('socket error'); };
  ws.onclose = () => {
    if (ended) return;
    const text = heardText();
    if (text) succeed(text); else fail('socket closed');
  };
  ws.onmessage = (m) => {
    let msg;
    try { msg = JSON.parse(typeof m.data === 'string' ? m.data : ''); } catch { return; }
    const ev = msg?.event;
    if (ev === 'ready') {
      ready = true;
      clear('ready');
      while (pending.length) send(pending.shift());
    } else if (ev === 'partial') {
      const t = (msg.text || '').trim();
      if (t) {
        if (firstWordsMs === null) firstWordsMs = Math.round(now() - t0);
        lastPartial = t;
        onPartial((finals.join(' ') + ' ' + t).trim());
        if (!stopSent) speechNow();
      }
    } else if (ev === 'final') {
      const t = (msg.text || '').trim();
      if (t) {
        if (firstWordsMs === null) firstWordsMs = Math.round(now() - t0);
        finals.push(t);
        lastPartial = '';
        onPartial(finals.join(' '));
        if (!stopSent) speechNow();
      }
    } else if (ev === 'done') {
      const t = (msg.text || '').trim() || heardText();
      if (t) succeed(t); else fail('engine heard nothing', { fallback: false });
    } else if (ev === 'error' && msg.fatal !== false) {
      fail(`engine: ${String(msg.detail || 'error').slice(0, 120)}`);
    }
  };

  // ── microphone ──
  (async () => {
    try {
      stream = await getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (ended) { releaseAudio(); return; }
      try { ctx = new AC({ sampleRate: TARGET_RATE }); } catch { ctx = new AC(); }
      try { await ctx.resume?.(); } catch {}
      source = ctx.createMediaStreamSource(stream);
      node = ctx.createScriptProcessor(4096, 1, 1);
      node.onaudioprocess = (e) => {
        if (ended || stopSent) return;
        const raw = e.inputBuffer.getChannelData(0);
        const mono = downsampleTo16k(new Float32Array(raw), ctx.sampleRate);
        for (const f of framer.push(mono)) onFrame(f);
      };
      source.connect(node);
      node.connect(ctx.destination);
      timers.max = setT(endpoint, maxMs);
      timers.nothing = setT(() => { if (!speechSeen) fail('nothing heard', { fallback: false }); }, NOTHING_HEARD_MS);
    } catch (e) {
      fail(e?.name === 'NotAllowedError' ? 'microphone blocked' : 'microphone unavailable');
    }
  })();

  return {
    result,
    stop: () => {
      if (ended) return;
      if (speechSeen) endpoint();   // not ready yet → falls back, asks to repeat
      else fail('stopped', { fallback: false });
    },
    abort: () => {
      if (ended) return;
      ended = true;
      clearAll(); releaseAudio(); closeSocket();
      rejectFn(new ListenStreamError('aborted', { fallback: false }));
    },
  };
}
