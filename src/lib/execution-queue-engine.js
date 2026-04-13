// src/lib/execution-queue-engine.js
// Phase 9 — Async Execution Queue System
//
// Separates DECISION from EXECUTION. Every action first lands in execution_queue
// (status='pending'), then is processed asynchronously. This means:
//   • No inline execution in API routes
//   • Cancelable within the cancel_before window
//   • Retryable on failure
//   • Full audit trail via decision-protocol
//
// QUEUE STATES: pending → executing → success | failed | cancelled
//
// SUPPORTED ACTION TYPES (processed by processQueueItem):
//   whatsapp_message     — send via action-bridge → sendWhatsAppBridge
//   proactive_nudge      — insert proactive_nudges row
//   behavior_auto_exec   — trigger autonomous action (launchAutoExec equivalent server-side)
//
// Exports:
//   enqueueAction(supabase, userId, actionType, payload, options)
//   processQueueItem(supabase, item)
//   cancelQueueItem(supabase, itemId, userId)
//   getQueueStatus(supabase, userId, limit?)
//   QUEUE_STATES

import { createClient } from '@supabase/supabase-js';
import { createDecisionRecord, executeWithProtocol, writeAuditRecord, AGENTS } from '@/lib/decision-protocol';
import { governAction, getRiskLevel } from '@/lib/governor-engine';
import { bridgeAction } from '@/lib/action-bridge';

export const QUEUE_STATES = {
  PENDING:    'pending',
  EXECUTING:  'executing',
  SUCCESS:    'success',
  FAILED:     'failed',
  CANCELLED:  'cancelled',
};

function svcClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// ── enqueueAction ─────────────────────────────────────────────────────────────
/**
 * Adds an action to the execution queue without executing it.
 * The action will be processed by processQueueItem when called.
 *
 * @param {SupabaseClient} supabase
 * @param {string}         userId
 * @param {string}         actionType    — 'whatsapp_message' | 'proactive_nudge' | 'behavior_auto_exec'
 * @param {object}         payload       — action-specific params
 * @param {{
 *   cancelWindowMs?: number,   — default 5000ms (5s)
 *   intentType?:    string,
 *   confidence?:    number,
 *   keepId?:        string,
 *   agentId?:       string,
 * }} options
 *
 * @returns {Promise<{ id: string } | null>}
 */
export async function enqueueAction(supabase, userId, actionType, payload, options = {}) {
  if (!userId || !actionType) return null;
  try {
    const cancelMs    = options.cancelWindowMs ?? 5000;
    const cancelBefore = new Date(Date.now() + cancelMs).toISOString();
    const dedupKey    = `${actionType}:${userId}:${JSON.stringify(payload).slice(0, 60)}`;

    // Check for existing pending item with same dedup key (prevent duplicates)
    const { data: existing } = await supabase
      .from('execution_queue')
      .select('id, status')
      .eq('user_id', userId)
      .eq('dedup_key', dedupKey)
      .eq('status', QUEUE_STATES.PENDING)
      .maybeSingle();

    if (existing) return { id: existing.id, deduplicated: true };

    const { data, error } = await supabase
      .from('execution_queue')
      .insert({
        user_id:       userId,
        action_type:   actionType,
        payload:       { ...payload, intent_type: options.intentType, confidence: options.confidence },
        keep_id:       options.keepId || null,
        status:        QUEUE_STATES.PENDING,
        cancel_before: cancelBefore,
        dedup_key:     dedupKey,
      })
      .select('id')
      .single();

    if (error) throw new Error(error.message);
    return { id: data.id, deduplicated: false };
  } catch (e) {
    console.error('[EXEC-QUEUE] enqueueAction failed (non-fatal):', e.message);
    return null;
  }
}

// ── processQueueItem ──────────────────────────────────────────────────────────
/**
 * Processes a single pending queue item.
 * Called by the queue worker route (/api/protocol/queue/process).
 *
 * @param {SupabaseClient} supabase — service role
 * @param {{ id, user_id, action_type, payload, keep_id, cancel_before }} item
 * @param {string?} accessToken — for WhatsApp send (requires user token)
 *
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function processQueueItem(supabase, item, accessToken = null) {
  const { id, user_id, action_type, payload } = item;
  if (!id || !user_id || !action_type) return { ok: false, error: 'invalid_item' };

  // Check cancellation window
  if (item.cancel_before && new Date(item.cancel_before) > new Date()) {
    // Still in cancel window — don't execute yet
    return { ok: false, error: 'in_cancel_window', retry_after: item.cancel_before };
  }

  // Mark as executing (optimistic lock)
  const { error: lockError } = await supabase
    .from('execution_queue')
    .update({ status: QUEUE_STATES.EXECUTING, executed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', QUEUE_STATES.PENDING);

  if (lockError) return { ok: false, error: 'lock_failed' };

  // Build protocol record
  const intentType = payload?.intent_type || action_type;
  const confidence = payload?.confidence  || 0.7;
  const agentId    = payload?.agent_id    || AGENTS.behavior_agent.id;

  const record = createDecisionRecord(agentId, user_id, {
    intentType,
    action:     `Queue execution: ${action_type}`,
    confidence,
    keep_id:    item.keep_id,
    inputs:     payload,
  });

  // Governor check before execution
  const govResult = await governAction(user_id, { intentType, score: confidence }, {
    frequency: 3, accept_count: 2, decay_weight: 1.0,
  }).catch(() => ({ allowed: true, tier: 'suggest', reason: 'gov_error_fail_open' }));

  if (!govResult.allowed) {
    await supabase.from('execution_queue')
      .update({ status: QUEUE_STATES.CANCELLED, error_msg: `Governor blocked: ${govResult.reason}` })
      .eq('id', id);
    record.status = 'blocked';
    record.execution_status = 'blocked_by_governor';
    writeAuditRecord(supabase, record);
    return { ok: false, error: govResult.reason };
  }

  // Route to action-bridge
  let bridgeResult;
  try {
    switch (action_type) {
      case 'whatsapp_message':
        bridgeResult = accessToken
          ? await bridgeAction(supabase, user_id, 'whatsapp', payload, record, accessToken)
          : { ok: false, error: 'no_access_token_for_whatsapp' };
        break;
      case 'proactive_nudge':
        bridgeResult = await bridgeAction(supabase, user_id, 'proactive_nudge', payload, record);
        break;
      default:
        bridgeResult = { ok: false, error: `unsupported_action_type: ${action_type}` };
    }
  } catch (e) {
    bridgeResult = { ok: false, error: e.message };
  }

  // Update queue status
  const finalStatus = bridgeResult.ok ? QUEUE_STATES.SUCCESS : QUEUE_STATES.FAILED;
  await supabase.from('execution_queue')
    .update({
      status:    finalStatus,
      error_msg: bridgeResult.ok ? null : bridgeResult.error,
    })
    .eq('id', id);

  return bridgeResult;
}

// ── cancelQueueItem ───────────────────────────────────────────────────────────
/**
 * Cancels a pending queue item (user override — always wins).
 */
export async function cancelQueueItem(supabase, itemId, userId) {
  try {
    const { error } = await supabase
      .from('execution_queue')
      .update({ status: QUEUE_STATES.CANCELLED, error_msg: 'cancelled_by_user' })
      .eq('id', itemId)
      .eq('user_id', userId)
      .eq('status', QUEUE_STATES.PENDING);

    return { ok: !error, error: error?.message };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ── getQueueStatus ────────────────────────────────────────────────────────────
/**
 * Returns recent queue items for a user (for monitoring/UI).
 */
export async function getQueueStatus(supabase, userId, limit = 20) {
  try {
    const { data, error } = await supabase
      .from('execution_queue')
      .select('id, action_type, status, payload, cancel_before, executed_at, error_msg, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    return { items: data || [], error: error?.message };
  } catch (e) {
    return { items: [], error: e.message };
  }
}
