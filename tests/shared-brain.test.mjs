// tests/shared-brain.test.mjs
// ─────────────────────────────────────────────────────────────────────────────
// AG-I3 Equivalence Test: Shared Brain v0 vs Existing Capture Route Pipeline
//
// Asserts that understand(text, ctx) and the existing capture route pipeline
// produce 100% IDENTICAL { intent, entities } across all 283 test sentences
// in tests/fixtures/understanding-cases.json using recorded/mocked model responses.
//
// 283/283 identical is the finish line.
// ─────────────────────────────────────────────────────────────────────────────

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { understand, decide, LEVEL, DECISION } from '../src/lib/brain/index.js';
import { parseIntent, stripWakePhrase } from '../src/lib/intent-parser.js';
import { collapseRepeats } from '../src/lib/transcript-clean.js';
import { computeReminderAt } from '../src/lib/intent-executor.js';
import { whyBrainRun } from '../src/lib/understanding-record.js';
import { NO_KEEP_INTENTS } from '../src/lib/brain-turn.js';
import { DRIVE_INTENTS } from '../src/lib/drive-voice.js';
import { BUSINESS_INTENTS } from '../src/lib/business-voice.js';

const here = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(readFileSync(join(here, 'fixtures', 'understanding-cases.json'), 'utf8'));
const measurements = JSON.parse(readFileSync(join(here, '..', 'measurements', 'understanding-latest.json'), 'utf8'));
const recordedRows = measurements.models[0].rows;

/**
 * Path 1: The existing capture route understanding pipeline from
 * src/app/api/voice/capture/route.js (lines 805-1150).
 */
function existingCapturePath(text, { language = 'en-IN', timezone = 'Asia/Kolkata', mockLlm } = {}) {
  const rawText = collapseRepeats(String(text || '').trim());
  const cleanText = stripWakePhrase(rawText) || rawText;

  if (!cleanText) {
    return {
      intent: 'unknown',
      entities: {},
      confidence: 0,
      source: 'empty',
    };
  }

  let parsed = parseIntent(cleanText);
  let reminderAt = computeReminderAt(parsed.entities, undefined, cleanText);

  const brainDecision = whyBrainRun({ parsed, text: cleanText, language, reminderAt });
  let llmAssist = null;

  if (brainDecision.run) {
    llmAssist = mockLlm;
  }

  if (llmAssist && llmAssist.confidence >= 0.55 && NO_KEEP_INTENTS.has(llmAssist.intent)) {
    return {
      intent: llmAssist.intent,
      entities: { ...(llmAssist.entities || {}) },
      confidence: llmAssist.confidence,
      source: 'llm',
    };
  }

  if (llmAssist && llmAssist.confidence >= 0.55 && DRIVE_INTENTS.has(llmAssist.intent)) {
    return {
      intent: llmAssist.intent,
      entities: { ...(llmAssist.entities || {}) },
      confidence: llmAssist.confidence,
      source: 'llm',
    };
  }

  if (llmAssist && llmAssist.confidence >= 0.55 && BUSINESS_INTENTS.has(llmAssist.intent)) {
    return {
      intent: llmAssist.intent,
      entities: { ...(llmAssist.entities || {}) },
      confidence: llmAssist.confidence,
      source: 'llm',
    };
  }

  if (llmAssist && llmAssist.confidence >= 0.55) {
    const INTENT_MAP = {
      ledger_credit: 'income',
      query: 'note',
    };
    const mappedType = INTENT_MAP[llmAssist.intent] || llmAssist.intent;
    const entities = {
      ...(parsed.entities || {}),
      names: llmAssist.entities?.person
        ? [llmAssist.entities.person]
        : (parsed.entities?.names || []),
      amount: llmAssist.entities?.amount ?? parsed.entities?.amount ?? null,
      direction: llmAssist.entities?.direction ?? null,
      item: llmAssist.entities?.item ?? null,
    };

    if (llmAssist.entities?.datetimeISO) {
      const dt = new Date(llmAssist.entities.datetimeISO);
      if (!isNaN(dt.getTime()) && dt.getTime() > Date.now() - 60000) {
        reminderAt = dt;
        const parts = Object.fromEntries(
          new Intl.DateTimeFormat('en-GB', {
            timeZone: timezone, hour12: false,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit',
          }).formatToParts(dt)
            .filter((x) => x.type !== 'literal')
            .map((x) => [x.type, x.value])
        );
        const hh = parts.hour === '24' ? 0 : Number(parts.hour);
        entities.dates = [`${parts.year}-${parts.month}-${parts.day}`];
        entities.times = [
          `${(hh % 12) || 12}:${parts.minute} ${hh < 12 ? 'am' : 'pm'}`
        ];
      }
    }

    return {
      intent: mappedType,
      entities,
      confidence: llmAssist.confidence,
      source: 'llm',
    };
  }

  return {
    intent: parsed.type,
    entities: parsed.entities,
    confidence: parsed.confidence,
    source: 'regex',
  };
}

test('equivalence on all 283 understanding-cases.json sentences: Path A === Path B', async () => {
  assert.equal(cases.length, 283, 'Expected exactly 283 test sentences');
  assert.equal(recordedRows.length, 283, 'Expected 283 recorded measurement rows');

  let identicalCount = 0;

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const row = recordedRows[i];

    // Mock response built strictly from recorded offline Sarvam measurements (no live API keys)
    const mockLlm = row.failure ? null : {
      intent: row.intent,
      confidence: row.confidence ?? 0.7,
      entities: {
        person: row.person || null,
        datetimeISO: row.time || null,
        amount: row.amount ?? null,
        direction: row.direction || null,
        status: row.status || null,
        quantity: row.quantity ?? null,
        stockOp: row.stock_op || null,
      },
      missing: row.missing || [],
    };

    const ctx = {
      language: c.language || 'en-IN',
      mockLlm,
      timezone: 'Asia/Kolkata',
    };

    const pathA = existingCapturePath(c.text, ctx);
    const pathB = await understand(c.text, ctx);

    // Assert identical intent
    assert.equal(pathB.intent, pathA.intent, `Case #${i} [${c.id}] intent mismatch: ${pathB.intent} !== ${pathA.intent}`);

    // Assert identical entities
    assert.deepEqual(pathB.entities, pathA.entities, `Case #${i} [${c.id}] entities mismatch: ${JSON.stringify(pathB.entities)} !== ${JSON.stringify(pathA.entities)}`);

    // Assert identical confidence and source
    assert.equal(pathB.confidence, pathA.confidence, `Case #${i} [${c.id}] confidence mismatch`);
    assert.equal(pathB.source, pathA.source, `Case #${i} [${c.id}] source mismatch`);

    identicalCount++;
  }

  assert.equal(identicalCount, 283, 'All 283/283 cases must be identical');
});

test('decide() maps levels and safety actions accurately', () => {
  // Read-back actions (reminders, notes, navigation)
  const rem = decide({ intent: 'reminder' });
  assert.equal(rem.level, LEVEL.READ_BACK);
  assert.equal(rem.action, DECISION.DO);

  const note = decide({ intent: 'note' });
  assert.equal(note.level, LEVEL.READ_BACK);
  assert.equal(note.action, DECISION.DO);

  // Spoken-yes actions (saved contact calls)
  const savedCallAsk = decide({ intent: 'contact', contactSaved: true }, { proof: { spokenYes: false } });
  assert.equal(savedCallAsk.level, LEVEL.SPOKEN_YES);
  assert.equal(savedCallAsk.action, DECISION.ASK_YES);

  const savedCallDo = decide({ intent: 'contact', contactSaved: true }, { proof: { spokenYes: true, unlocked: true } });
  assert.equal(savedCallDo.level, LEVEL.SPOKEN_YES);
  assert.equal(savedCallDo.action, DECISION.DO);

  // Locked phone asks unlock after spoken yes
  const savedCallLocked = decide({ intent: 'contact', contactSaved: true }, { proof: { spokenYes: true, unlocked: false } });
  assert.equal(savedCallLocked.level, LEVEL.SPOKEN_YES);
  assert.equal(savedCallLocked.action, DECISION.ASK_UNLOCK);

  // Unknown contact requires PIN
  const unknownCall = decide({ intent: 'contact', contactSaved: false }, { proof: {} });
  assert.equal(unknownCall.level, LEVEL.PIN);
  assert.equal(unknownCall.action, DECISION.ASK_PIN);

  // Money transfer / pay requires PIN
  const pay = decide({ intent: 'pay' }, { proof: {} });
  assert.equal(pay.level, LEVEL.PIN);
  assert.equal(pay.action, DECISION.ASK_PIN);

  // Speed gate: while moving (>=8 km/h), screen-requiring actions wait until stopped
  const movingPay = decide({ intent: 'pay' }, { proof: {}, context: { speedKmh: 25 } });
  assert.equal(movingPay.action, DECISION.REFUSE);
  assert.equal(movingPay.reason, 'wait_until_stopped');

  // Small talk / confirm has no action
  const none = decide({ intent: 'none' });
  assert.equal(none.level, LEVEL.NO_ACTION);
  assert.equal(none.action, DECISION.NOTHING);
});

test('feature flag NEXT_PUBLIC_SHARED_BRAIN defaults to OFF', () => {
  assert.notEqual(process.env.NEXT_PUBLIC_SHARED_BRAIN, '1', 'Flag NEXT_PUBLIC_SHARED_BRAIN must be OFF by default');
});

test('when switched on (NEXT_PUBLIC_SHARED_BRAIN=1), shared brain gives identical answers on all 283 sentences', async () => {
  const orig = process.env.NEXT_PUBLIC_SHARED_BRAIN;
  try {
    process.env.NEXT_PUBLIC_SHARED_BRAIN = '1';
    assert.equal(process.env.NEXT_PUBLIC_SHARED_BRAIN, '1');

    for (let i = 0; i < cases.length; i++) {
      const c = cases[i];
      const row = recordedRows[i];

      const mockLlm = row.failure ? null : {
        intent: row.intent,
        confidence: row.confidence ?? 0.7,
        entities: {
          person: row.person || null,
          datetimeISO: row.time || null,
          amount: row.amount ?? null,
          direction: row.direction || null,
          status: row.status || null,
          quantity: row.quantity ?? null,
          stockOp: row.stock_op || null,
        },
        missing: row.missing || [],
      };

      const ctx = {
        language: c.language || 'en-IN',
        mockLlm,
        timezone: 'Asia/Kolkata',
      };

      const pathA = existingCapturePath(c.text, ctx);
      const pathB = await understand(c.text, ctx);

      assert.equal(pathB.intent, pathA.intent, `Case #${i} [${c.id}] intent mismatch`);
      assert.deepEqual(pathB.entities, pathA.entities, `Case #${i} [${c.id}] entities mismatch`);
    }
  } finally {
    if (orig !== undefined) process.env.NEXT_PUBLIC_SHARED_BRAIN = orig;
    else delete process.env.NEXT_PUBLIC_SHARED_BRAIN;
  }
});
