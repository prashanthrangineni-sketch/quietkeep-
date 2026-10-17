// src/lib/nudge-delivery.js
//
// Pure decisions for /api/cron/process-nudges, kept out of the route so they
// can be tested without a database.
//
// 17 Oct 2026: the drainer was re-sending the same 25 nudges every 5 minutes.
// Two database rules silently rejected its writes:
//   - proactive_nudges.nudge_type only allows a fixed list, and the queue holds
//     'reminder' and 'geo_trigger', so the in-app copy was never saved;
//   - nudge_queue.delivery_status only allows pending/sent/failed/skipped/
//     retrying, so 'delivered_no_push_sub' and 'skipped_whatsapp' were refused
//     and the nudge stayed "undelivered" forever.
// Nothing checked the write errors, so the loop was invisible and burned the
// Vercel Hobby CPU allowance. These helpers only produce values the database
// accepts; the route now checks every write.

// Must match the CHECK constraint proactive_nudges_nudge_type_check.
export const IN_APP_TYPES = new Set([
  'subscription_renewal',
  'document_expiry',
  'mood_gap',
  'trip_upcoming',
  'budget_alert',
  'reminder_due',
  'keep_followup',
  'general',
])

// Must match the CHECK constraint nudge_queue_delivery_status_check.
export const QUEUE_STATUSES = new Set(['pending', 'sent', 'failed', 'skipped', 'retrying'])

const TYPE_MAP = {
  reminder: 'reminder_due',
  reminder_due: 'reminder_due',
  geo_trigger: 'general',
  keep: 'keep_followup',
  followup: 'keep_followup',
  budget: 'budget_alert',
  subscription: 'subscription_renewal',
  document: 'document_expiry',
  trip: 'trip_upcoming',
}

/** Map a queue nudge_type to one the in-app table accepts. */
export function inAppType(queueType) {
  const t = String(queueType || '').toLowerCase().trim()
  if (IN_APP_TYPES.has(t)) return t
  return TYPE_MAP[t] || 'general'
}

// A nudge more than this late is no longer useful: a reminder for last week
// arriving now is noise. It is closed as skipped instead of being shown.
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000

/**
 * Decide what to do with one due nudge.
 * Returns { action: 'expire' | 'skip_whatsapp' | 'deliver', reason? }.
 */
export function planNudge(n, nowMs) {
  const due = Date.parse(n && n.scheduled_for)
  if (Number.isFinite(due) && nowMs - due > STALE_AFTER_MS) {
    return { action: 'expire', reason: 'expired_over_24h' }
  }
  const channel = String((n && n.channel) || 'push').toLowerCase()
  if (channel === 'whatsapp') return { action: 'skip_whatsapp', reason: 'whatsapp_not_sent_by_cron' }
  return { action: 'deliver' }
}

/** The nudge_queue update for a finished nudge. Always a valid status. */
export function queueUpdate(outcome, nowIso) {
  switch (outcome.kind) {
    case 'expired':
      return { delivered: true, delivered_at: nowIso, delivery_status: 'skipped', failure_reason: outcome.reason || 'expired' }
    case 'skipped_whatsapp':
      // Left undelivered for a future WhatsApp sender. The drainer's query
      // excludes the whatsapp channel, so it is not picked up again.
      return { delivery_status: 'skipped', failure_reason: 'whatsapp_not_sent_by_cron' }
    case 'sent':
      return {
        delivered: true,
        delivered_at: nowIso,
        delivery_status: 'sent',
        failure_reason: outcome.noPushSubscription ? 'in_app_only_no_push_subscription' : null,
      }
    case 'failed':
    default:
      return {
        retry_count: (outcome.retryCount || 0) + 1,
        last_error: String(outcome.error || 'unknown').slice(0, 300),
        failed_at: nowIso,
        delivery_status: 'failed',
      }
  }
}
