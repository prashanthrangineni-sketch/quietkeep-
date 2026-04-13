// src/lib/decision-protocol.js
// Phase 8 — Universal Decision Protocol
//
// Standardizes the signal → decision → execution → audit pipeline
// across ALL QuietKeep agents (Voice, Geo, Behavior, Finance).
//
// Every action in the system goes through this sequence:
//   1. INPUT     — raw signal (voice transcript, geo event, behavior pattern, etc.)
//   2. SIGNALS   — computed scores (confidence, risk, trust, context)
//   3. DECISION  — governor evaluation → tier (auto/suggest/blocked)
//   4. EXECUTION — launchAutoExec / suggestion surface / silent drop
//   5. AUDIT     — decision_logs write with full provenance
//
// AGENT REGISTRY:
//   voice_agent    — captures via voice/capture
//   geo_agent      — triggers via geo/check
//   behavior_agent — predicts via autonomous/evaluate
//   finance_agent  — monitors business invoices/ledger
//
// Exports:
//   AGENTS                                     — agent registry
//   createDecisionRecord(agentId, userId, data) → DecisionRecord
//   executeWithProtocol(record, executeFn)      → ProtocolResult
//   writeAuditRecord(supabase, record)          → void
//   canReverse(record)                          → boolean
//   buildReplayInput(record)                    → replayable input

import { createClient } from '@supabase/supabase-js';
import { RISK_LEVELS, getRiskLevel } from '@/lib/governor-engine';

// ── Agent registry ────────────────────────────────────────────────────────────
export const AGENTS = {
  voice_agent:    { id: 'voice_agent',    label: 'Voice Agent',    version: 1 },
  geo_agent:      { id: 'geo_agent',      label: 'Geo Agent',      version: 1 },
  behavior_agent: { id: 'behavior_agent', label: 'Behavior Agent', version: 1 },
  finance_agent:  { id: 'finance_agent',  label: 'Finance Agent',  version: 1 },
  system:         { id: 'system',         label: 'System',         version: 1 },
};

// ── Protocol version ──────────────────────────────────────────────────────────
export const PROTOCOL_VERSION = 8;

// ── createDecisionRecord ──────────────────────────────────────────────────────
/**
 * Creates a typed decision record before execution.
 * This is the canonical input to all governed actions.
 *
 * @param {string} agentId        — from AGENTS registry
 * @param {string} userId
 * @param {{
 *   intentType:    string,
 *   action:        string,      — human-readable action description
 *   confidence:    number,      — 0–1
 *   risk_level?:   string,      — auto-computed if omitted
 *   inputs:        object,      — raw signal data
 *   keep_id?:      string,
 *   correlation_id?: string,    — links related decisions
 * }} data
 * @returns {DecisionRecord}
 */
export function createDecisionRecord(agentId, userId, data) {
  const agent      = AGENTS[agentId] || AGENTS.system;
  const risk_level = data.risk_level || getRiskLevel(data.intentType);
  const reversible = risk_level === RISK_LEVELS.SAFE; // only safe actions are reversible

  return {
    id:               crypto.randomUUID(),
    agent_id:         agent.id,
    agent_label:      agent.label,
    user_id:          userId,
    intent_type:      data.intentType,
    action:           data.action,
    confidence:       data.confidence,
    risk_level,
    risk_score:       riskLevelToScore(risk_level),
    reversal_possible: reversible,
    inputs:           data.inputs || {},
    keep_id:          data.keep_id || null,
    correlation_id:   data.correlation_id || crypto.randomUUID(),
    protocol_version: PROTOCOL_VERSION,
    status:           'pending',   // pending → executing → completed | failed | cancelled
    created_at:       new Date().toISOString(),
    execution_status: null,
    user_override:    false,
    evaluation_path:  [],
  };
}

// ── executeWithProtocol ───────────────────────────────────────────────────────
/**
 * Wraps any execution function with protocol-grade logging and error handling.
 * Adds execution_status, timing, and updates the record on success/failure.
 *
 * @param {DecisionRecord} record
 * @param {() => Promise<any>} executeFn
 * @returns {Promise<{ ok: boolean, result?: any, error?: string, record: DecisionRecord }>}
 */
export async function executeWithProtocol(record, executeFn) {
  const startMs = Date.now();
  record.status = 'executing';
  record.evaluation_path = [...(record.evaluation_path || []), 'execute_start'];

  try {
    const result = await executeFn();
    const durationMs = Date.now() - startMs;

    record.status           = 'completed';
    record.execution_status = 'success';
    record.evaluation_path  = [...record.evaluation_path, `completed_${durationMs}ms`];

    return { ok: true, result, record };
  } catch (err) {
    record.status           = 'failed';
    record.execution_status = 'error';
    record.evaluation_path  = [...record.evaluation_path, `failed: ${err.message?.slice(0,50)}`];
    console.error(`[PROTOCOL] ${record.agent_id} execution failed:`, err.message);
    return { ok: false, error: err.message, record };
  }
}

// ── writeAuditRecord ──────────────────────────────────────────────────────────
/**
 * Writes a protocol-grade audit record to decision_logs.
 * Non-blocking, fail-safe. Uses all Phase 8 columns.
 *
 * @param {SupabaseClient} supabase — service role client
 * @param {DecisionRecord} record
 */
export function writeAuditRecord(supabase, record) {
  if (!supabase || !record?.user_id) return;
  try {
    supabase.from('decision_logs').insert({
      user_id:          record.user_id,
      keep_id:          record.keep_id,
      decision:         record.status === 'completed' ? `${record.agent_id}_executed`
                      : record.status === 'failed'    ? `${record.agent_id}_failed`
                      : `${record.agent_id}_${record.status}`,
      reason:           record.action,
      mode:             'autonomous',
      inputs:           record.inputs,
      context_snapshot: { intent_type: record.intent_type, confidence: record.confidence },
      priority_score:   record.confidence,
      signal_weights:   record.inputs?.signal_weights || null,
      execution_status: record.execution_status,
      reversal_possible:record.reversal_possible,
      risk_score:       record.risk_score,
      user_override:    record.user_override,
      agent_id:         record.agent_id,
      protocol_version: record.protocol_version,
      correlation_id:   record.correlation_id,
      evaluation_path:  record.evaluation_path,
      replayable_input: record.inputs,
    }).then(() => {}).catch(() => {});
  } catch { /* fail-safe */ }
}

// ── canReverse ────────────────────────────────────────────────────────────────
/**
 * Returns true when an executed action can be undone.
 * Only SAFE risk-level actions are reversible.
 * Sensitive/financial actions can never be reversed by the system.
 */
export function canReverse(record) {
  return record?.reversal_possible === true
    && record?.execution_status === 'success'
    && record?.risk_level === RISK_LEVELS.SAFE;
}

// ── buildReplayInput ──────────────────────────────────────────────────────────
/**
 * Returns a snapshot that can replay the decision deterministically.
 * Compliant with Section 65B audit requirements.
 */
export function buildReplayInput(record) {
  return {
    protocol_version: record.protocol_version,
    agent_id:         record.agent_id,
    user_id:          record.user_id,
    intent_type:      record.intent_type,
    confidence:       record.confidence,
    risk_level:       record.risk_level,
    inputs:           record.inputs,
    created_at:       record.created_at,
    correlation_id:   record.correlation_id,
    // Strip execution state — replay starts fresh
    status:           'pending',
    execution_status: null,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function riskLevelToScore(level) {
  return level === RISK_LEVELS.SAFE      ? 0.20
       : level === RISK_LEVELS.MODERATE  ? 0.55
       : level === RISK_LEVELS.SENSITIVE ? 0.90
       : 0.55;
}
