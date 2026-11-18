// tests/conversation-noise-guard.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Tests for CARD T23: Conversation mode must ignore background talk
// Built with node built-ins only (node:test, node:assert/strict, node:fs)
// ─────────────────────────────────────────────────────────────────────────────

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isFillerPhrase,
  countWords,
  hasCommandVerb,
  isActionOrQueryIntent,
  shouldIgnoreAutoTurn,
  isFillerOutsideAutoTurn,
} from '../src/lib/conversation-noise-guard.js';
import { readDeleteAnswer, pendingDelete, DELETE_ASKED } from '../src/lib/brain-turn.js';
import { readBizAnswer, pendingBiz, BIZ_ASKED } from '../src/lib/business-voice.js';
import { isSpokenYes } from '../src/lib/action-levels.js';

// ── 1. Replay the 6 junk transcripts as auto turns → 0 keeps ──────────────────
test('CARD T23: Replay 6 junk transcripts as auto turns → all ignored (0 keeps)', () => {
  const junkTranscripts = [
    { text: 'However,', intent: 'note' },
    { text: 'I mean,', intent: 'note' },
    { text: 'ఈ వీడియోలో మనం ఒక ఇన్వాయిస్ ని ఎలా ప్రింట్ చేయాలో చూద్దాం.', intent: 'invoice' },
    { text: 'గౌతమ్ సెంబరాజు.', intent: 'contact' },
    { text: 'However,', intent: 'note' },
    { text: 'Neeraja.', intent: 'contact' },
  ];

  let keepsCreated = 0;
  for (const { text, intent } of junkTranscripts) {
    const ignored = shouldIgnoreAutoTurn({
      autoTurn: true,
      text,
      answersPendingQuestion: false,
      intentType: intent,
    });
    assert.equal(ignored, true, `Expected junk transcript "${text}" to be ignored as auto_turn_noise`);
    if (!ignored) keepsCreated++;
  }

  assert.equal(keepsCreated, 0, 'Replaying the 6 junk transcripts must create exactly 0 keeps');
});

// ── 2. "Remind me to call the bank at 5 pm today" as an auto turn → reminder saved ─
test('CARD T23: "Remind me to call the bank at 5 pm today" as an auto turn → reminder saved', () => {
  const text = 'Remind me to call the bank at 5 pm today';
  const ignored = shouldIgnoreAutoTurn({
    autoTurn: true,
    text,
    answersPendingQuestion: false,
    intentType: 'reminder',
  });

  assert.equal(ignored, false, 'Action command "Remind me..." must NOT be ignored on auto turn');
  assert.equal(countWords(text) >= 3, true, 'Has at least 3 words');
  assert.equal(isFillerPhrase(text), false, 'Not a filler phrase');
  assert.equal(isActionOrQueryIntent({ intentType: 'reminder', text }), true, 'Is an allowed action intent');
});

// ── 3. "avunu" after Aaria asked a confirm question → still confirms ───────────
test('CARD T23: "avunu" after Aaria asked a confirm question → still confirms', () => {
  // Scenario A: Delete confirmation pending
  const deleteAuditRows = [{
    action: DELETE_ASKED,
    details: { keep_id: 'k1', content: 'Call Ravi tomorrow', lang: 'te-IN' },
    created_at: new Date().toISOString(),
  }];
  const askedDelete = pendingDelete(deleteAuditRows);
  assert.ok(askedDelete, 'Pending delete question should be recognized');

  const text = 'avunu';
  const deleteAnswer = readDeleteAnswer(text);
  assert.equal(deleteAnswer, 'yes', '"avunu" must confirm the pending delete');

  // Verify noise guard does not ignore it because answersPendingQuestion is true
  const answersPendingQuestion = (deleteAnswer === 'yes' || deleteAnswer === 'no');
  const ignored = shouldIgnoreAutoTurn({
    autoTurn: true,
    text,
    answersPendingQuestion,
  });
  assert.equal(ignored, false, '"avunu" answering pending question must NOT be ignored');

  // Scenario B: Business attendance confirmation pending
  const bizAuditRows = [{
    action: BIZ_ASKED,
    details: { workspace_id: 'ws1', type: 'attendance', pending: { person: 'Ravi', status: 'absent' }, lang: 'te-IN' },
    created_at: new Date().toISOString(),
  }];
  const askedBiz = pendingBiz(bizAuditRows, 'ws1');
  assert.ok(askedBiz, 'Pending business question should be recognized');
  const bizAnswer = readBizAnswer(text);
  assert.equal(bizAnswer, 'yes', '"avunu" must confirm pending business action');

  // isSpokenYes test
  assert.equal(isSpokenYes('avunu'), true, '"avunu" is spoken yes');
});

// ── 4. A tapped "Save a note demo went well" → note saved ─────────────────────
test('CARD T23: Tapped "Save a note demo went well" → note saved', () => {
  const text = 'Save a note demo went well';
  // Outside auto turn (autoTurn: false)
  const isFiller = isFillerOutsideAutoTurn({
    autoTurn: false,
    text,
    answersPendingQuestion: false,
  });
  assert.equal(isFiller, false, 'Not a filler phrase');

  const ignored = shouldIgnoreAutoTurn({
    autoTurn: false,
    text,
    answersPendingQuestion: false,
    intentType: 'note',
  });
  assert.equal(ignored, false, 'Tapped command is not ignored');
});

// ── 5. Outside auto turns (a tap): filler-only phrases rejected as fragment ───
test('CARD T23: Outside auto turns, filler-only phrases are rejected to ask again', () => {
  const fillers = [
    'However,', 'I mean,', 'so', 'ok', 'okay', 'yes', 'no', 'hmm', 'uh', 'um', 'like',
    'ఆ', 'అవును', 'సరే', 'avunu', 'sare',
    'haan', 'accha', 'theek hai',
  ];

  for (const f of fillers) {
    const isFiller = isFillerOutsideAutoTurn({
      autoTurn: false,
      text: f,
      answersPendingQuestion: false,
    });
    assert.equal(isFiller, true, `Expected "${f}" to be recognized as filler-only outside auto turn`);
  }
});

// ── 6. Source-code structural contracts in route.js and aaria.jsx ─────────────
test('CARD T23: Source-code structural contracts in route.js and aaria.jsx', () => {
  const routeCode = readFileSync(new URL('../src/app/api/voice/capture/route.js', import.meta.url), 'utf8');
  const aariaCode = readFileSync(new URL('../src/lib/context/aaria.jsx', import.meta.url), 'utf8');

  // route.js contracts:
  assert.ok(routeCode.includes("ignored: 'auto_turn_noise'"), 'route.js returns ignored: auto_turn_noise');
  assert.ok(routeCode.includes("action: 'voice.auto_turn_ignored'"), 'route.js logs voice.auto_turn_ignored');
  assert.ok(routeCode.includes('details: { length: text.length }'), 'route.js logs heard text length, not text');
  assert.ok(routeCode.includes('autoTurn'), 'route.js respects autoTurn');
  assert.ok(routeCode.includes('isActionOrQueryIntent'), 'route.js checks isActionOrQueryIntent before saving keep');

  // aaria.jsx contracts:
  assert.ok(aariaCode.includes('auto_turn: true'), 'aaria.jsx sends auto_turn: true on auto turn');
  assert.ok(aariaCode.includes('json.ignored'), 'aaria.jsx handles json.ignored');
  assert.ok(aariaCode.includes('handleSilence()'), 'aaria.jsx calls handleSilence on ignored');
  assert.ok(aariaCode.includes('silentTurnsRef.current >= 2'), 'aaria.jsx exits after 2 silent turns');
});
