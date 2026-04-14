/**
 * src/lib/voiceContext.ts
 *
 * Phase 8B — Lightweight Voice Context Memory
 *
 * Stores the last intent + entities IN MEMORY ONLY (no DB, no localStorage).
 * Enables basic conversational continuation:
 *
 *   User: "pending bills"      → intent: query_bills, entities: {}
 *   User: "what about tomorrow" → continuation detected → refines prev intent
 *
 * ── DESIGN CONSTRAINTS ────────────────────────────────────────────────────
 *
 *   - In-memory only: resets on page reload (intentional — no stale context)
 *   - No DB: zero latency, zero auth dependency
 *   - Max history: 5 turns (prevents unbounded memory growth)
 *   - TTL: context expires after CONTEXT_TTL_MS (3 minutes) of silence
 *   - Pure module: no React, no imports from other QK modules
 *
 * ── CONTINUATION DETECTION ────────────────────────────────────────────────
 *
 * A command is a "continuation" if:
 *   1. There is a recent (< 3 min) prior intent
 *   2. The current command contains ONLY relational/temporal words
 *      ("and", "also", "what about", "tomorrow", "next week", etc.)
 *      with no primary intent keywords of its own.
 *
 * When continuation is detected, the engine:
 *   1. Merges new entities into the prior intent's entities
 *   2. Returns the original intentType so the query engine re-runs it
 *   3. Adds the new entities as refinements (e.g. date: "tomorrow")
 *
 * ── USAGE ─────────────────────────────────────────────────────────────────
 *
 *   import { recordIntent, getContext, tryResolveContinuation } from '@/lib/voiceContext';
 *
 *   // After parseVoiceIntent:
 *   recordIntent(intent.intentType, intent.entities, commandText);
 *
 *   // Before parseVoiceIntent — check if it's a continuation:
 *   const continuation = tryResolveContinuation(commandText);
 *   if (continuation.isContinuation) {
 *     // Re-run the previous query with merged entities
 *     speak(`Refining ${getModeLabel(continuation.intentType)}.`);
 *     resolveVoiceCommand(continuation.command, ctx);
 *     return;
 *   }
 */

import type { IntentType, IntentEntities } from './voiceIntentEngine';

// ── Constants ──────────────────────────────────────────────────────────────

const CONTEXT_TTL_MS = 3 * 60 * 1000;  // 3 minutes
const MAX_HISTORY    = 5;

// ── Types ──────────────────────────────────────────────────────────────────

export interface ContextEntry {
  intentType:   IntentType;
  entities:     IntentEntities;
  rawText:      string;
  timestamp:    number;
}

export interface ContinuationResult {
  isContinuation: boolean;
  /** The prior intent to re-run (undefined if not a continuation) */
  intentType?:    IntentType;
  /** Merged entities (prior + new temporal/relational entities) */
  mergedEntities?: IntentEntities;
  /** Reconstructed command string for resolveVoiceCommand */
  command?:       string;
}

// ── In-memory store ────────────────────────────────────────────────────────

const _history: ContextEntry[] = [];

// ── Relational/temporal words that signal continuation ────────────────────

const CONTINUATION_PATTERNS = [
  /^and\b/i,
  /^also\b/i,
  /^what about\b/i,
  /^how about\b/i,
  /^and what about\b/i,
  /^add\b/i,      // "add tomorrow" after a reminder query
  /^for\b/i,
];

// Words that by themselves indicate a temporal refinement without intent
const TEMPORAL_ONLY = /^(today|tomorrow|yesterday|this week|next week|this month|monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|evening|night)\b/i;

const RELATIONAL_FILLERS = /^(the|a|an|my|its|their|these|those|that|this)\b/i;

// ── API ────────────────────────────────────────────────────────────────────

/**
 * recordIntent(intentType, entities, rawText)
 *
 * Call after every successfully parsed intent to update context memory.
 * Only records intents that are meaningful for continuation (not control/cancel).
 */
export function recordIntent(
  intentType: IntentType,
  entities:   IntentEntities,
  rawText:    string
): void {
  // Don't record ephemeral control intents — they have no useful continuation
  if (
    intentType === 'control_cancel' ||
    intentType === 'control_stop'   ||
    intentType === 'unknown'
  ) return;

  _history.unshift({ intentType, entities, rawText, timestamp: Date.now() });
  if (_history.length > MAX_HISTORY) _history.pop();
}

/**
 * getLastIntent() — returns the most recent non-expired context entry, or null.
 */
export function getLastIntent(): ContextEntry | null {
  const now = Date.now();
  for (const entry of _history) {
    if (now - entry.timestamp < CONTEXT_TTL_MS) return entry;
  }
  return null;
}

/**
 * getContext() — returns full history (newest first) filtered to non-expired entries.
 */
export function getContext(): ContextEntry[] {
  const now = Date.now();
  return _history.filter(e => now - e.timestamp < CONTEXT_TTL_MS);
}

/**
 * clearContext() — wipe all history. Call on logout or explicit "cancel".
 */
export function clearContext(): void {
  _history.length = 0;
}

/**
 * tryResolveContinuation(rawText)
 *
 * Checks if the current input is a continuation of the previous intent.
 * Returns { isContinuation: false } if no prior context or no match.
 * Returns { isContinuation: true, intentType, mergedEntities, command }
 * when the input looks like a refinement/continuation.
 */
export function tryResolveContinuation(rawText: string): ContinuationResult {
  const prior = getLastIntent();
  if (!prior) return { isContinuation: false };

  const norm = rawText.toLowerCase().trim();

  // Continuation signal: input starts with a relational phrase
  const startsWithContinuation = CONTINUATION_PATTERNS.some(p => p.test(norm));

  // Temporal-only signal: input is JUST a date/time word (e.g. "tomorrow")
  const isTemporalOnly = TEMPORAL_ONLY.test(norm) && norm.split(' ').length <= 3;

  // Relational-only: small filler words only ("the bills", "my reminders")
  // Only if the noun matches the prior intent
  const isRelationalOnly = RELATIONAL_FILLERS.test(norm) && norm.split(' ').length <= 3;

  if (!startsWithContinuation && !isTemporalOnly && !isRelationalOnly) {
    return { isContinuation: false };
  }

  // Extract new entities from the continuation input
  const newEntities: IntentEntities = {};

  // Date entity
  const dateMatch = norm.match(
    /\b(today|tomorrow|yesterday|this week|next week|this month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i
  );
  if (dateMatch) newEntities.date = dateMatch[1].toLowerCase();

  // Time entity
  const timeMatch = norm.match(/\bat\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
  if (timeMatch) newEntities.time = timeMatch[1];

  // Merge new entities into prior entities (new values take precedence)
  const mergedEntities: IntentEntities = { ...prior.entities, ...newEntities };

  // Build a reconstructed command:
  // Start from prior raw text but replace/add the new temporal refinement.
  let command = prior.rawText;
  if (newEntities.date) {
    // Append the temporal refinement if not already in the prior command
    if (!prior.rawText.toLowerCase().includes(newEntities.date)) {
      command = `${prior.rawText} ${newEntities.date}`;
    }
  }

  return {
    isContinuation: true,
    intentType:     prior.intentType,
    mergedEntities,
    command,
  };
}

/**
 * getContextSummary() — one-line summary for debugging / voice response.
 * e.g. "Last: pending bills (12s ago)"
 */
export function getContextSummary(): string {
  const last = getLastIntent();
  if (!last) return 'No recent context.';
  const ago = Math.round((Date.now() - last.timestamp) / 1000);
  return `Last: ${last.intentType.replace('_', ' ')} (${ago}s ago)`;
}
