// src/lib/usage-meter.js
// Phase 11 — Usage Tracking (non-blocking)
//
// Records every protocol API call to usage_logs and increments api_keys.requests_used.
// Never blocks the caller — all writes fire-and-forget via .then().catch().
//
// COST UNITS (v1):
//   decide:  3 units  (runs all agents + governor)
//   execute: 2 units  (governor + queue)
//   replay:  1 unit   (read + recompute)
//   voice:   1 unit   (per capture)

import { createClient } from '@supabase/supabase-js';

const COST_TABLE = {
  decide:        3,
  execute:       2,
  replay:        1,
  reverse:       1,
  voice_capture: 1,
  queue_process: 1,
};

function svcClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

/**
 * Record a usage event. Non-blocking — never awaited by caller.
 *
 * @param {{
 *   userId:          string,
 *   action:          string,   — key from COST_TABLE
 *   keyId?:          string,
 *   workspaceId?:    string,
 *   latencyMs?:      number,
 *   status?:         'success'|'error'|'blocked',
 *   protocolVersion?: number,
 *   metadata?:       object,
 * }} params
 */
export function recordUsage({ userId, action, keyId = null, workspaceId = null,
  latencyMs = null, status = 'success', protocolVersion = 10, metadata = {} }) {
  if (!userId || !action) return;
  const costUnits = COST_TABLE[action] ?? 1;
  const db = svcClient();

  // Write usage log
  db.from('usage_logs').insert({
    user_id:          userId,
    api_key_id:       keyId,
    workspace_id:     workspaceId,
    action,
    cost_units:       costUnits,
    protocol_version: protocolVersion,
    latency_ms:       latencyMs,
    status,
    metadata,
  }).then(() => {}).catch(() => {});

  // Increment api_keys.requests_used
  if (keyId) {
    db.rpc('increment_api_key_usage', { p_key_id: keyId, p_units: costUnits })
      .then(() => {})
      .catch(() => {
        // RPC may not exist yet — fallback to direct update
        db.from('api_keys')
          .update({ requests_used: db.raw('requests_used + ' + costUnits) })
          .eq('id', keyId)
          .then(() => {}).catch(() => {});
      });
  }
}

/**
 * Get aggregated usage for a user (for billing dashboard).
 * @param {string} userId
 * @param {number} days — lookback window (default 30)
 */
export async function getUsageSummary(userId, days = 30) {
  if (!userId) return null;
  try {
    const db     = svcClient();
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();

    const { data } = await db
      .from('usage_logs')
      .select('action, cost_units, status, created_at')
      .eq('user_id', userId)
      .gte('created_at', cutoff);

    if (!data) return null;

    const summary = data.reduce((acc, row) => {
      acc.total_units = (acc.total_units || 0) + (row.cost_units || 0);
      acc.by_action   = acc.by_action || {};
      acc.by_action[row.action] = (acc.by_action[row.action] || 0) + (row.cost_units || 0);
      if (row.status === 'error') acc.errors = (acc.errors || 0) + 1;
      return acc;
    }, { total_units: 0, by_action: {}, errors: 0, rows: data.length });

    return summary;
  } catch { return null; }
}
