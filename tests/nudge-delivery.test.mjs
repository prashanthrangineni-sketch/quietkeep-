// tests/nudge-delivery.test.mjs
//
// 17 Oct 2026: /api/cron/process-nudges re-sent the same 25 nudges every 5
// minutes because the database refused its writes ('reminder' is not an
// allowed in-app nudge_type; 'delivered_no_push_sub' is not an allowed
// delivery_status) and nobody checked the errors. These cases pin the values
// the drainer may write to what the live CHECK constraints accept.
//
// Run: node tests/nudge-delivery.test.mjs

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  IN_APP_TYPES, QUEUE_STATUSES, STALE_AFTER_MS,
  inAppType, planNudge, queueUpdate,
} from '../src/lib/nudge-delivery.js'

const now = Date.parse('2026-10-17T10:00:00.000Z')
const nowIso = new Date(now).toISOString()

test('queue types seen live map to allowed in-app types', () => {
  assert.equal(inAppType('reminder'), 'reminder_due')
  assert.equal(inAppType('geo_trigger'), 'general')
  assert.equal(inAppType('budget_alert'), 'budget_alert')
  assert.equal(inAppType(undefined), 'general')
  assert.equal(inAppType('something_new'), 'general')
  for (const t of ['reminder', 'geo_trigger', 'keep', 'trip', 'x', '', null]) {
    assert.ok(IN_APP_TYPES.has(inAppType(t)), `type ${t} -> ${inAppType(t)}`)
  }
})

test('every queue update uses a status the database allows', () => {
  const outcomes = [
    { kind: 'expired', reason: 'expired_over_24h' },
    { kind: 'skipped_whatsapp' },
    { kind: 'sent', noPushSubscription: true },
    { kind: 'sent', noPushSubscription: false },
    { kind: 'failed', retryCount: 2, error: 'push_status_500' },
  ]
  for (const o of outcomes) {
    const u = queueUpdate(o, nowIso)
    assert.ok(QUEUE_STATUSES.has(u.delivery_status), `${o.kind} -> ${u.delivery_status}`)
  }
})

test('a sent nudge without a push subscription is closed, not retried', () => {
  const u = queueUpdate({ kind: 'sent', noPushSubscription: true }, nowIso)
  assert.equal(u.delivered, true)
  assert.equal(u.delivery_status, 'sent')
  assert.equal(u.failure_reason, 'in_app_only_no_push_subscription')
})

test('a failure counts a retry', () => {
  const u = queueUpdate({ kind: 'failed', retryCount: 4, error: 'x'.repeat(500) }, nowIso)
  assert.equal(u.retry_count, 5)
  assert.equal(u.delivery_status, 'failed')
  assert.equal(u.last_error.length, 300)
  assert.equal(u.delivered, undefined)
})

test('whatsapp nudges stay undelivered for a future sender', () => {
  const u = queueUpdate({ kind: 'skipped_whatsapp' }, nowIso)
  assert.equal(u.delivered, undefined)
  assert.equal(u.delivery_status, 'skipped')
})

test('nudges more than a day late are expired, not shown', () => {
  const old = { scheduled_for: new Date(now - STALE_AFTER_MS - 1000).toISOString(), channel: 'app' }
  assert.equal(planNudge(old, now).action, 'expire')
  const u = queueUpdate({ kind: 'expired', reason: 'expired_over_24h' }, nowIso)
  assert.equal(u.delivered, true)
  assert.equal(u.delivery_status, 'skipped')
})

test('fresh nudges are delivered; whatsapp ones are skipped', () => {
  const fresh = { scheduled_for: new Date(now - 60_000).toISOString(), channel: 'app' }
  assert.equal(planNudge(fresh, now).action, 'deliver')
  assert.equal(planNudge({ ...fresh, channel: 'push' }, now).action, 'deliver')
  assert.equal(planNudge({ ...fresh, channel: null }, now).action, 'deliver')
  assert.equal(planNudge({ ...fresh, channel: 'WhatsApp' }, now).action, 'skip_whatsapp')
})

test('the route checks its writes and uses the helpers', async () => {
  const { readFile } = await import('node:fs/promises')
  const src = await readFile(new URL('../src/app/api/cron/process-nudges/route.js', import.meta.url), 'utf8')
  assert.match(src, /inAppType\(n\.nudge_type\)/)
  assert.match(src, /error: insErr/)
  assert.match(src, /error: upErr/)
  assert.doesNotMatch(src, /delivered_no_push_sub/)
  assert.doesNotMatch(src, /skipped_whatsapp'\s*}\)\.eq/)
})
