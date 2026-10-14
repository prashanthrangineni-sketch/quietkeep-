// Plan item 10: thinking sounds. The four rules from the engine's
// src/fillers.py, checked here on a fake clock, plus source-text checks that
// the dock uses the player and the capture route records the timing.
import { readFileSync } from 'node:fs';
import { baseLanguage, choosePhrase, createFillerPlayer, cleanTurnTiming, SILENCE_TOLERANCE_MS, GENERIC_PHRASES } from '../src/lib/fillers.js';

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`);
  ok ? pass++ : fail++;
}

function harness() {
  let t = 0; const timers = new Map(); let id = 0;
  const played = []; const stopped = []; const synthCalls = [];
  const p = createFillerPlayer({
    now: () => t,
    setTimer: (fn, ms) => { timers.set(++id, { fn, at: t + ms }); return id; },
    clearTimer: (i) => timers.delete(i),
    synth: async (text, lang) => { synthCalls.push(`${lang}|${text}`); return { text }; },
    play: (clip) => { played.push(clip.text); return { stop: () => stopped.push(clip.text) }; },
  });
  const advance = (ms) => { t += ms; for (const [i, tm] of [...timers]) if (tm.at <= t) { timers.delete(i); tm.fn(); } };
  return { p, advance, played, stopped, synthCalls };
}

check('te-IN resolves to te', baseLanguage('te-IN') === 'te');
check('code-mixed te-en resolves to te', baseLanguage('te-en') === 'te');
check('rule 3: a language with no phrases is silence, not English', baseLanguage('bn-IN') === null && choosePhrase('bn') === null);
check('rule 2: never the same phrase twice', choosePhrase('en', 'okay') === 'one moment' && choosePhrase('en', 'one moment') === 'okay');
check('Hindi phrases are not masculine', !Object.values(GENERIC_PHRASES.hi).some((p) => /रहा हूँ/.test(p)));

{
  const h = harness(); await h.p.warm('en-IN');
  const end = h.p.begin('en-IN'); h.advance(SILENCE_TOLERANCE_MS - 100);
  const r = end();
  check('rule 1: a fast reply gets no filler', h.played.length === 0 && r.filler_ms === null && r.reply_ms === 600);
}
{
  const h = harness(); await h.p.warm('te-IN');
  const end = h.p.begin('te-IN'); h.advance(SILENCE_TOLERANCE_MS); h.advance(1500);
  const r = end();
  check('a slow reply gets a filler at the tolerance', h.played.length === 1 && r.filler_ms === SILENCE_TOLERANCE_MS, JSON.stringify(r));
  check('rule 4: the reply stops the filler', h.stopped.length === 1);
  check('the timing is reported', r.reply_ms === SILENCE_TOLERANCE_MS + 1500 && r.filler_lang === 'te');
  const end2 = h.p.begin('te-IN'); h.advance(SILENCE_TOLERANCE_MS); end2();
  check('rule 2 across turns: the next turn says the other phrase', h.played[1] !== h.played[0], h.played.join(','));
}
{
  const h = harness();   // never warmed
  const end = h.p.begin('en-IN'); h.advance(5000); const r = end();
  check('rule 4: a clip not ready is silence, never a wait or a provider call', h.played.length === 0 && h.synthCalls.length === 0 && r.filler_ms === null);
}
{
  const h = harness(); await h.p.warm('en'); await h.p.warm('en-IN');
  check('clips are made once per language', h.synthCalls.length === GENERIC_PHRASES.en.length, h.synthCalls.join(','));
  const end = h.p.begin('en'); check('end() is safe to call twice', end() && end() === null);
}

check('timing: trimmed to known fields', JSON.stringify(cleanTurnTiming({ reply_ms: 2100.4, filler_ms: 700, filler_phrase: 'okay', filler_lang: 'en', evil: 1 })) === JSON.stringify({ reply_ms: 2100, filler_ms: 700, filler_phrase: 'okay', filler_lang: 'en' }));
check('timing: no reply time, nothing stored', cleanTurnTiming({ filler_ms: 700 }) === null && cleanTurnTiming(null) === null && cleanTurnTiming('x') === null);
check('timing: absurd numbers are null, not stored', cleanTurnTiming({ reply_ms: -5 }) === null && cleanTurnTiming({ reply_ms: 900, filler_ms: 1e9 }).filler_ms === null);

{
  let failNext = true; const calls = [];
  const p = createFillerPlayer({ synth: async (t) => { calls.push(t); if (failNext) throw new Error('offline'); return { t }; }, play: () => ({ stop() {} }) });
  await p.warm('en'); failNext = false; await p.warm('en');
  check('a language that failed to warm is tried again later', p._clips.size === GENERIC_PHRASES.en.length, String(calls.length));
}

const dock = readFileSync(new URL('../src/lib/context/aaria.jsx', import.meta.url), 'utf8');
const ask = dock.slice(dock.indexOf('const askBrain'), dock.indexOf('const choose = useCallback'));
check('dock starts a filler turn in askBrain', /fillerRef\.current\?\.begin\(/.test(ask));
const endAt = ask.search(/endFiller\(\)/); const sayAt = ask.indexOf('say(spoken)');
check('dock stops the filler before speaking the reply', endAt > 0 && sayAt > 0 && endAt < sayAt);
check('dock also stops it on any failure (finally)', /finally\s*\{[^}]*endFiller\(\)/.test(ask));
check('dock sends the previous turn\'s timing', /prev_turn:/.test(dock));
const route = readFileSync(new URL('../src/app/api/voice/capture/route.js', import.meta.url), 'utf8');
check('capture route records turn timing', /voice_turn_timing/.test(route) && /cleanTurnTiming\(body\.prev_turn\)/.test(route));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
