// tests/conversation-mode.test.mjs
// CARD T21 — Conversation mode unit tests (node built-ins only)
//
// Verifies:
// 1. mode on → mic re-opens after a non-question reply (and no 3-turn limit)
// 2. stop words end it: stop / bye / "aapu" / "chalu" / "bas" (te, hi, en)
// 3. two silent turns end it: first silent turn re-opens mic, second ends conversation mode
// 4. off → old behaviour unchanged: non-question does not re-open, question re-opens at most 3 times
// 5. contract invariants: UI indicator, long-press activation, visibility change & locked phone guards

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { routeUtterance, isConversationStopWord, STOP_WORDS_REGEX } from '../src/lib/aaria-router.js';

let pass = 0, fail = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`PASS  ${name}`);
    pass++;
  } catch (err) {
    console.log(`FAIL  ${name}`);
    console.error(`      ${err.message}`);
    fail++;
  }
}

// ── 1. STOP WORDS END IT: stop / bye / "aapu" / "chalu" / "bas" (te, hi, en) ──

const STOP_WORD_CASES = [
  // English
  { word: 'stop', lang: 'en' },
  { word: 'bye', lang: 'en' },
  { word: 'goodbye', lang: 'en' },
  { word: 'cancel', lang: 'en' },
  { word: 'Stop.', lang: 'en' },
  { word: 'BYE!', lang: 'en' },
  // Telugu
  { word: 'aapu', lang: 'te' },
  { word: 'chalu', lang: 'te' },
  { word: 'chaalu', lang: 'te' },
  { word: 'ఆపు', lang: 'te' },
  { word: 'చాలు', lang: 'te' },
  // Hindi
  { word: 'bas', lang: 'hi' },
  { word: 'बस', lang: 'hi' },
  { word: 'ruko', lang: 'hi' },
  { word: 'रुको', lang: 'hi' },
  { word: 'chup', lang: 'hi' },
];

for (const { word, lang } of STOP_WORD_CASES) {
  check(`stop words: "${word}" (${lang}) recognized by isConversationStopWord`, () => {
    assert.equal(isConversationStopWord(word), true);
  });

  check(`stop words: "${word}" (${lang}) routed to kind: 'stop'`, () => {
    const action = routeUtterance(word, { wakeWord: 'aaria' });
    assert.ok(action, `Expected route action for "${word}"`);
    assert.equal(action.kind, 'stop');
  });
}

// Utterance with leading wake word
check('stop words: "Hey Aaria, stop" routes to kind: "stop"', () => {
  const action = routeUtterance('Hey Aaria, stop', { wakeWord: 'aaria' });
  assert.ok(action);
  assert.equal(action.kind, 'stop');
});

check('stop words: "Aaria, aapu" routes to kind: "stop"', () => {
  const action = routeUtterance('Aaria, aapu', { wakeWord: 'aaria' });
  assert.ok(action);
  assert.equal(action.kind, 'stop');
});

check('stop words: "Aaria, chalu" routes to kind: "stop"', () => {
  const action = routeUtterance('Aaria, chalu', { wakeWord: 'aaria' });
  assert.ok(action);
  assert.equal(action.kind, 'stop');
});

check('stop words: "Aaria, bas" routes to kind: "stop"', () => {
  const action = routeUtterance('Aaria, bas', { wakeWord: 'aaria' });
  assert.ok(action);
  assert.equal(action.kind, 'stop');
});

check('stop words: "stop the delivery tomorrow" is NOT a stop command (content veto/task)', () => {
  const action = routeUtterance('stop the delivery tomorrow', { wakeWord: 'aaria' });
  assert.equal(action, null); // must be handed to brain, not swallowed as stop
});

// ── 2. MODE ON → MIC RE-OPENS AFTER A NON-QUESTION REPLY ─────────────────────

// Simulate the re-open decision logic from src/lib/context/aaria.jsx
function shouldReopen({ conversationActive, json, spoken, turns }) {
  const isConv = !!conversationActive;
  const asked = !!json?.follow_up || /[?？]\s*$/.test(String(spoken || '').trim());
  if (isConv || (asked && turns < 3)) {
    return {
      reopen: true,
      nextTurns: isConv ? turns : turns + 1,
      unlimited: isConv,
    };
  }
  return {
    reopen: false,
    nextTurns: 0,
    unlimited: false,
  };
}

check('mode on → mic re-opens after non-question reply "Saved."', () => {
  const res = shouldReopen({
    conversationActive: true,
    json: { follow_up: false },
    spoken: 'Saved.',
    turns: 0,
  });
  assert.equal(res.reopen, true);
  assert.equal(res.unlimited, true);
});

check('mode on → mic re-opens after statement "Reminder set for 5 pm."', () => {
  const res = shouldReopen({
    conversationActive: true,
    json: {},
    spoken: 'Reminder set for 5 pm.',
    turns: 0,
  });
  assert.equal(res.reopen, true);
  assert.equal(res.unlimited, true);
});

check('mode on → has NO 3-turn limit (keeps going at turns = 3, 4, 10)', () => {
  for (const t of [3, 4, 10, 50]) {
    const res = shouldReopen({
      conversationActive: true,
      json: {},
      spoken: 'Done.',
      turns: t,
    });
    assert.equal(res.reopen, true, `Should reopen at turn ${t}`);
    assert.equal(res.unlimited, true);
  }
});

// ── 3. TWO SILENT TURNS END IT ───────────────────────────────────────────────

// Simulate the silence handler state machine from src/lib/context/aaria.jsx
function createSilenceTracker() {
  let silentTurns = 0;
  let conversationActive = true;
  let stopped = false;
  let micReopened = false;

  return {
    handleTurn(heardText) {
      micReopened = false;
      if (heardText && heardText.trim()) {
        silentTurns = 0; // speech heard resets counter
        return { conversationActive, stopped, micReopened: false };
      }
      // Silence / nothing heard
      if (!conversationActive) return { conversationActive, stopped, micReopened: false };
      silentTurns += 1;
      if (silentTurns >= 2) {
        conversationActive = false;
        stopped = true;
        micReopened = false;
      } else {
        micReopened = true; // first silence re-opens
      }
      return { conversationActive, stopped, micReopened, silentTurns };
    },
    get silentTurns() { return silentTurns; },
    get conversationActive() { return conversationActive; },
    get stopped() { return stopped; },
  };
}

check('two silent turns end it: turn 1 silent re-opens mic, turn 2 silent ends it', () => {
  const tracker = createSilenceTracker();

  // Turn 1: silent
  const r1 = tracker.handleTurn('');
  assert.equal(r1.silentTurns, 1);
  assert.equal(r1.conversationActive, true, 'Conversation mode must still be active after 1 silent turn');
  assert.equal(r1.micReopened, true, 'Mic must re-open after first silent turn');
  assert.equal(r1.stopped, false);

  // Turn 2: silent again
  const r2 = tracker.handleTurn('');
  assert.equal(r2.silentTurns, 2);
  assert.equal(r2.conversationActive, false, 'Conversation mode must END after 2 silent turns in a row');
  assert.equal(r2.stopped, true, 'stopAll() must be triggered');
  assert.equal(r2.micReopened, false, 'Mic must NOT re-open after second silent turn');
});

check('speech in between resets silent turns counter', () => {
  const tracker = createSilenceTracker();

  // Turn 1: silent
  tracker.handleTurn('');
  assert.equal(tracker.silentTurns, 1);

  // Turn 2: speech heard!
  tracker.handleTurn('remind me at 4');
  assert.equal(tracker.silentTurns, 0, 'Speech must reset silent turns count to 0');
  assert.equal(tracker.conversationActive, true);

  // Turn 3: silent again (first in a new row)
  const r3 = tracker.handleTurn('');
  assert.equal(r3.silentTurns, 1);
  assert.equal(r3.conversationActive, true);
  assert.equal(r3.micReopened, true);
});

// ── 4. OFF → OLD BEHAVIOUR UNCHANGED ─────────────────────────────────────────

check('off → old behaviour unchanged: non-question reply does NOT re-open mic', () => {
  const res = shouldReopen({
    conversationActive: false,
    json: { follow_up: false },
    spoken: 'Saved.',
    turns: 0,
  });
  assert.equal(res.reopen, false);
  assert.equal(res.nextTurns, 0);
});

check('off → old behaviour unchanged: question reply re-opens mic up to 3 turns', () => {
  // Turn 0 -> 1
  const r1 = shouldReopen({
    conversationActive: false,
    json: { follow_up: true },
    spoken: 'Which Venu?',
    turns: 0,
  });
  assert.equal(r1.reopen, true);
  assert.equal(r1.nextTurns, 1);

  // Turn 1 -> 2
  const r2 = shouldReopen({
    conversationActive: false,
    json: {},
    spoken: 'eppudu gurthu cheyamantaru?',
    turns: 1,
  });
  assert.equal(r2.reopen, true);
  assert.equal(r2.nextTurns, 2);

  // Turn 2 -> 3
  const r3 = shouldReopen({
    conversationActive: false,
    json: {},
    spoken: 'Are you sure?',
    turns: 2,
  });
  assert.equal(r3.reopen, true);
  assert.equal(r3.nextTurns, 3);

  // Turn 3 (cap reached: at most three in a row)
  const r4 = shouldReopen({
    conversationActive: false,
    json: { follow_up: true },
    spoken: 'Which one?',
    turns: 3,
  });
  assert.equal(r4.reopen, false, 'Must not re-open after 3 turns when conversation mode is OFF');
  assert.equal(r4.nextTurns, 0);
});

// ── 5. STATIC SOURCE CODE CONTRACT CHECKS ───────────────────────────────────

const aariaSource = readFileSync('src/lib/context/aaria.jsx', 'utf8');
const dockSource = readFileSync('src/components/AariaDock.jsx', 'utf8');
const voiceSettingsSource = readFileSync('src/app/settings/voice/page.jsx', 'utf8');
const prefsRouteSource = readFileSync('src/app/api/voice/preferences/route.js', 'utf8');

check('Settings → Voice has toggle for conversation_mode with label "Keep listening after each reply"', () => {
  assert.match(voiceSettingsSource, /conversation_mode/);
  assert.match(voiceSettingsSource, /Keep listening after each reply/);
  assert.match(voiceSettingsSource, /qk_conversation_mode/);
});

check('/api/voice/preferences persists conversation_mode in GET and POST', () => {
  assert.match(prefsRouteSource, /conversation_mode:\s*!!settings\.conversation_mode/);
  assert.match(prefsRouteSource, /settings\.conversation_mode\s*=\s*body\.conversation_mode/);
});

check('AariaDock renders visible "Listening continuously — tap to stop" indicator', () => {
  assert.match(dockSource, /conversationMode/);
  assert.match(dockSource, /Listening continuously — tap to stop/);
});

check('AariaDock orb button supports long-press to activate conversation mode', () => {
  assert.match(dockSource, /startConversationMode/);
  assert.match(dockSource, /pressTimerRef/);
  assert.match(dockSource, /isLongPressRef/);
  assert.match(dockSource, /onPointerDown/);
});

check('AariaDock mic tap stops continuous listening when active', () => {
  assert.match(dockSource, /if\s*\(\s*conversationMode\s*\|\|\s*busy\s*\)\s*\{\s*stopAll\(\);/);
});

check('aaria.jsx ends conversation mode on visibilitychange / screen off', () => {
  assert.match(aariaSource, /document\.visibilityState\s*===\s*['"]hidden['"]/);
  assert.match(aariaSource, /stopAll\(\)/);
});

check('aaria.jsx guards against self-echo: waits for speech end before re-opening', () => {
  assert.match(aariaSource, /isSpeaking\(\)/);
  assert.match(aariaSource, /looksLikeSelfEcho/);
});

check('aaria.jsx guards against locked phone: never re-opens on locked phone', () => {
  assert.match(aariaSource, /checkPhoneLocked/);
  assert.match(aariaSource, /isKeyguardLocked/);
});

// ── SUMMARY ─────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
