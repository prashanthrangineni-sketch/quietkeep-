// src/lib/action-bridge.js
// Phase 8 — External Action Bridge
//
// All outbound actions (WhatsApp, future: payments, integrations) pass through
// this bridge. Every call is governed, logged with protocol-grade audit trail,
// and fails safely.
//
// GOVERNOR GATE: every bridge action must pass governAction() before execution.
// No external action fires without an explicit governance pass.
//
// Exports:
//   sendWhatsAppBridge(supabase, userId, params, decisionRecord)
//   triggerProactiveNudge(supabase, userId, params, decisionRecord)
//   bridgeAction(supabase, userId, actionType, params, record)

import { governAction, getRiskLevel } from '@/lib/governor-engine';
import { writeAuditRecord, executeWithProtocol, AGENTS } from '@/lib/decision-protocol';

const SERVER = process.env.NEXT_PUBLIC_SITE_URL || 'https://quietkeep.com';

// ── sendWhatsAppBridge ────────────────────────────────────────────────────────
/**
 * Sends a WhatsApp message via the existing /api/whatsapp/send route.
 * Requires: user has whatsapp_enabled + phone_number in user_settings.
 * GOVERNANCE: WhatsApp is MODERATE risk — requires score ≥ 0.85.
 *
 * @param {SupabaseClient} supabase   — service role
 * @param {string}         userId
 * @param {{ message, keep_id?, to? }} params
 * @param {DecisionRecord} record     — from createDecisionRecord()
 * @param {string}         accessToken — Bearer token for route call
 */
export async function sendWhatsAppBridge(supabase, userId, params, record, accessToken) {
  if (!userId || !params?.message) return { ok: false, error: 'missing_params' };

  // Governance gate
  const govResult = await governAction(userId, {
    intentType: 'contact', score: record.confidence,
  }, { frequency: 5, accept_count: 2, decay_weight: 1.0 })
  .catch(() => ({ allowed: false, tier: 'blocked', reason: 'gov_error' }));

  if (!govResult.allowed || govResult.tier === 'blocked') {
    record.evaluation_path = [...(record.evaluation_path || []), `blocked: ${govResult.reason}`];
    writeAuditRecord(supabase, { ...record, status: 'blocked', execution_status: 'blocked_by_governor' });
    return { ok: false, error: govResult.reason };
  }

  const result = await executeWithProtocol(record, async () => {
    const res = await fetch(`${SERVER}/api/whatsapp/send`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        message:  params.message,
        keep_id:  params.keep_id || null,
        to:       params.to || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  });

  writeAuditRecord(supabase, result.record);
  return result;
}

// ── triggerProactiveNudge ─────────────────────────────────────────────────────
/**
 * Inserts a proactive_nudge row for push notification delivery.
 * GOVERNANCE: nudges are SAFE risk — can fire at lower confidence.
 *
 * @param {SupabaseClient} supabase
 * @param {string}         userId
 * @param {{ title, body, nudge_type, scheduled_for?, action_url? }} params
 * @param {DecisionRecord} record
 */
export async function triggerProactiveNudge(supabase, userId, params, record) {
  if (!userId || !params?.title) return { ok: false, error: 'missing_params' };

  const result = await executeWithProtocol(record, async () => {
    const { error } = await supabase.from('proactive_nudges').insert({
      user_id:      userId,
      nudge_type:   params.nudge_type || 'behavior_suggestion',
      title:        params.title,
      body:         params.body || '',
      action_url:   params.action_url || null,
      scheduled_for: params.scheduled_for || new Date().toISOString(),
      is_read:      false,
      is_dismissed: false,
    });
    if (error) throw new Error(error.message);
    return { nudge_type: params.nudge_type };
  });

  writeAuditRecord(supabase, result.record);
  return result;
}

// ── bridgeAction ──────────────────────────────────────────────────────────────
/**
 * Generic bridge dispatcher. Routes to the correct bridge function by actionType.
 * All external actions must go through here.
 *
 * Supported actionTypes:
 *   'whatsapp'          → sendWhatsAppBridge
 *   'proactive_nudge'   → triggerProactiveNudge
 *
 * @param {SupabaseClient} supabase
 * @param {string}         userId
 * @param {string}         actionType
 * @param {object}         params
 * @param {DecisionRecord} record
 * @param {string?}        accessToken
 */
export async function bridgeAction(supabase, userId, actionType, params, record, accessToken) {
  record.evaluation_path = [...(record.evaluation_path || []), `bridge:${actionType}`];

  switch (actionType) {
    case 'whatsapp':
      return sendWhatsAppBridge(supabase, userId, params, record, accessToken);
    case 'proactive_nudge':
      return triggerProactiveNudge(supabase, userId, params, record);
    default:
      record.execution_status = 'unknown_action_type';
      writeAuditRecord(supabase, { ...record, status: 'failed' });
      return { ok: false, error: `unknown_action_type: ${actionType}` };
  }
}
