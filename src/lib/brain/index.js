// src/lib/brain/index.js
// ─────────────────────────────────────────────────────────────────────────────
// Shared brain v0 for QuietKeep (AG-I3).
//
// Exposes:
//   understand(text, ctx) → { intent, entities, confidence, source }
//   decide(result, ctx)   → { level, action }
//
// CALLS EXISTING PIECES:
//   - aaria-llm.js: aariaUnderstandLLM + parseBrainResponse (multilingual NLU)
//   - intent-parser.js: parseIntent + stripWakePhrase (deterministic regex)
//   - transcript-clean.js: collapseRepeats (unstutter)
//   - intent-executor.js: computeReminderAt (time parsing)
//   - understanding-record.js: whyBrainRun, describeUnderstanding
//   - action-levels.js: decide (level table safety check)
//
// Zero prompt changes, zero new models, zero new providers.
// ─────────────────────────────────────────────────────────────────────────────

import { aariaUnderstandLLM, parseBrainResponse, INTENTS } from '../aaria-llm.js';
import { parseIntent, stripWakePhrase } from '../intent-parser.js';
import { collapseRepeats } from '../transcript-clean.js';
import { computeReminderAt } from '../intent-executor.js';
import { whyBrainRun, describeUnderstanding } from '../understanding-record.js';
import { NO_KEEP_INTENTS } from '../brain-turn.js';
import { DRIVE_INTENTS } from '../drive-voice.js';
import { BUSINESS_INTENTS } from '../business-voice.js';
import { decide as decideAction, levelFor, LEVEL, DECISION } from '../action-levels.js';

export { parseBrainResponse, aariaUnderstandLLM, INTENTS, LEVEL, DECISION };

export const INTENT_MAP = Object.freeze({
  ledger_credit: 'income',
  query: 'note',
});

/**
 * Understand an utterance, returning intent, entities, confidence, and source ('llm' | 'regex').
 * Reproduces the exact order and fallback hierarchy from the voice capture pipeline.
 *
 * @param {string} text - User utterance or transcript
 * @param {object} [ctx={}] - Context options (language, nowISO, timezone, workspaceMode, mockLlm, etc.)
 * @returns {Promise<{ intent: string, entities: object, confidence: number, source: string, raw?: object }>}
 */
export async function understand(text, ctx = {}) {
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

  // 1. Initial regex parse
  let parsed = parseIntent(cleanText);
  let reminderAt = computeReminderAt(parsed.entities, undefined, cleanText);

  // 2. Decide whether the LLM brain should read this
  const language = ctx.language || 'en-IN';
  const brainDecision = whyBrainRun({ parsed, text: cleanText, language, reminderAt });
  let llmAssist = null;

  if (brainDecision.run) {
    if (ctx.mockLlm || ctx.llmAssist) {
      llmAssist = ctx.mockLlm || ctx.llmAssist;
    } else if (ctx.rawResponse) {
      const res = parseBrainResponse(ctx.rawResponse, {
        clean: cleanText,
        nowISO: ctx.nowISO,
        language,
        model: 'sarvam-105b-conversations',
      });
      llmAssist = res.failure ? null : res.result;
    } else {
      llmAssist = await aariaUnderstandLLM(cleanText, {
        language,
        nowISO: ctx.nowISO || new Date().toISOString(),
        timezone: ctx.timezone || 'Asia/Kolkata',
        workspaceMode: ctx.workspaceMode || (ctx.workspaceId ? 'business' : 'personal'),
        pageLabel: ctx.pageLabel || null,
        onFailure: ctx.onFailure,
      }).catch(() => null);
    }
  }

  // 3. Special intent categories (NO_KEEP, DRIVE, BUSINESS)
  if (llmAssist && llmAssist.confidence >= 0.55 && NO_KEEP_INTENTS.has(llmAssist.intent)) {
    return {
      intent: llmAssist.intent,
      entities: { ...(llmAssist.entities || {}) },
      confidence: llmAssist.confidence,
      source: 'llm',
      raw: llmAssist,
    };
  }

  if (llmAssist && llmAssist.confidence >= 0.55 && DRIVE_INTENTS.has(llmAssist.intent)) {
    return {
      intent: llmAssist.intent,
      entities: { ...(llmAssist.entities || {}) },
      confidence: llmAssist.confidence,
      source: 'llm',
      raw: llmAssist,
    };
  }

  if (llmAssist && llmAssist.confidence >= 0.55 && BUSINESS_INTENTS.has(llmAssist.intent)) {
    return {
      intent: llmAssist.intent,
      entities: { ...(llmAssist.entities || {}) },
      confidence: llmAssist.confidence,
      source: 'llm',
      raw: llmAssist,
    };
  }

  // 4. Standard / Keep intents upgraded by LLM
  if (llmAssist && llmAssist.confidence >= 0.55) {
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
            timeZone: ctx.timezone || 'Asia/Kolkata', hour12: false,
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
      raw: llmAssist,
    };
  }

  // 5. Deterministic regex fallback
  return {
    intent: parsed.type,
    entities: parsed.entities,
    confidence: parsed.confidence,
    source: 'regex',
    raw: parsed,
  };
}

const ACTION_TYPE_MAP = Object.freeze({
  delete: 'delete_note',
  pay: 'money_transfer',
  save_last_60s: 'drive_save_record',
  share_record: 'drive_share_record',
  read_health: 'drive_read_health',
  read_faults: 'drive_read_faults',
  hazard_ahead: 'drive_hazard_ahead',
  stay_awake: 'drive_stay_awake',
  attendance: 'attendance',
  stock: 'stock',
  payroll: 'payroll',
});

/**
 * Decide whether an action can be performed given proof and context.
 * Gated by src/lib/action-levels.js.
 *
 * @param {object} result - Output of understand() { intent, entities, ... }
 * @param {object} [ctx={}] - Decision context (proof, speedKmh, settings, etc.)
 * @returns {{ level: string, action: string, decision: string, reason: string, needs: string[] }}
 */
export function decide(result, ctx = {}) {
  const intent = result?.intent || result?.type || 'note';
  const entities = result?.entities || {};
  const actionType = ctx?.type || ACTION_TYPE_MAP[intent] || intent;

  const action = {
    type: actionType,
    contactSaved: ctx?.contactSaved !== undefined
      ? ctx.contactSaved
      : (result?.contactSaved !== undefined
        ? result.contactSaved
        : (entities?.contact_phone || (entities?.names?.length > 0 && ctx?.contacts?.some?.((c) => c.name === entities.names[0])) ? true : null)),
    movesMoney: ctx?.movesMoney !== undefined ? ctx.movesMoney : (result?.movesMoney || false),
  };

  const proof = ctx?.proof || {
    spokenYes: ctx?.spokenYes === true,
    unlocked: ctx?.unlocked === true,
    pin: ctx?.pin === true || ctx?.biometric === true,
    ownerVoice: ctx?.ownerVoice !== undefined ? ctx.ownerVoice : null,
  };

  const context = {
    doneThisHour: ctx?.doneThisHour !== undefined
      ? ctx.doneThisHour
      : (ctx?.context?.doneThisHour !== undefined ? ctx.context.doneThisHour : 0),
    speedKmh: ctx?.speedKmh !== undefined ? ctx.speedKmh : (ctx?.context?.speedKmh ?? null),
    settings: ctx?.settings || ctx?.context?.settings || {},
    language: ctx?.language || ctx?.context?.language || 'en-IN',
  };

  const d = decideAction(action, proof, context);

  return {
    level: d.level,
    action: d.decision,
    decision: d.decision,
    reason: d.reason,
    needs: d.needs || [],
  };
}

export default {
  understand,
  decide,
  parseBrainResponse,
  aariaUnderstandLLM,
  INTENTS,
  INTENT_MAP,
  LEVEL,
  DECISION,
};
