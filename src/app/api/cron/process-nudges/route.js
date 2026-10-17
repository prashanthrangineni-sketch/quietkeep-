// src/app/api/cron/process-nudges/route.js
// ─────────────────────────────────────────────────────────────────────────────
// PROACTIVITY SCHEDULER — the missing worker that makes QuietKeep proactive.
//
// The intelligence stack already QUEUES nudges (nudge_queue: 399+ rows) but,
// per the forensic audit, NOTHING drained them on a schedule — so the phone
// never spoke up on its own. This route is that drainer. Wire it to a Vercel
// cron (every minute) in vercel.json:
//
//   { "crons": [
//       { "path": "/api/system/cleanup",   "schedule": "0 3 * * *" },
//       { "path": "/api/cron/process-nudges", "schedule": "* * * * *" }
//   ]}
//
// Auth: Vercel cron sends `Authorization: Bearer <CRON_SECRET>`. We reject
// anything else so the endpoint can't be triggered by the public.
//
// For each due nudge it: (1) fires a Web Push via the existing
// send-push-notification edge function, and (2) writes an in-app row into
// proactive_nudges (populating BOTH `body` and `message` to fix the schema
// drift the audit found in InAppNotifications.jsx). Failures increment
// retry_count with backoff instead of silently vanishing.
// ─────────────────────────────────────────────────────────────────────────────

export const dynamic = 'force-dynamic';

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { inAppType, planNudge, queueUpdate } from '@/lib/nudge-delivery';

const BATCH = 25;         // nudges per run (kept small to stay under plan limits)
const MAX_RETRY = 5;      // give up after this many failures
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function svc() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

// Fire a Web Push through the already-deployed edge function.
async function sendPush({ user_id, title, body, url }) {
  const fnUrl = `${SUPABASE_URL}/functions/v1/send-push-notification`;
  const res = await fetch(fnUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify({ user_id, title, body, url }),
  });
  // 404 = user has no push subscription yet; treat as a soft-miss (delivered,
  // the in-app row still shows). Any 5xx / network error is a hard failure.
  if (res.status === 404) return { ok: true, soft: true, status: 404 };
  if (!res.ok) return { ok: false, status: res.status };
  return { ok: true, status: res.status };
}

async function handle(req) {
  // ── auth: the bearer secret, and ONLY the bearer secret ───────────────────
  //
  // This previously also accepted the vercel cron header as proof of a cron
  // invocation. Vercel does not strip that header from inbound public requests,
  // so anyone could set it and skip CRON_SECRET completely -- the endpoint was
  // effectively unauthenticated, and it sends notifications to real users.
  //
  // The header bypass is removed rather than repaired: this job is scheduled
  // from pg_cron inside Supabase (see supabase/migrations/), which sends the
  // bearer token, so nothing legitimate depended on it.
  //
  // A missing CRON_SECRET now fails closed. The old `secret &&` guard meant an
  // unset variable disabled the whole check -- exactly backwards for a secret.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[cron/process-nudges] CRON_SECRET is not set; refusing to run');
    return NextResponse.json({ error: 'Not configured' }, { status: 503 });
  }
  const authz = req.headers.get('Authorization') || '';
  if (authz !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return NextResponse.json({ error: 'Supabase env not configured' }, { status: 500 });
  }

  const db = svc();
  const nowIso = new Date().toISOString();
  const nowMs = Date.parse(nowIso);

  // Pull due, undelivered, not-exhausted nudges, highest priority first.
  // WhatsApp-channel nudges are left for a future WhatsApp sender and are not
  // picked up here, so they cannot loop.
  const { data: due, error } = await db
    .from('nudge_queue')
    .select('id,user_id,nudge_type,title,body,payload,channel,scheduled_for,keep_id,retry_count,workspace_id,domain_type')
    .eq('delivered', false)
    .lte('scheduled_for', nowIso)
    .lt('retry_count', MAX_RETRY)
    .or('channel.is.null,channel.neq.whatsapp')
    .order('priority_score', { ascending: false, nullsFirst: false })
    .order('scheduled_for', { ascending: true })
    .limit(BATCH);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!due || due.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, at: nowIso });
  }

  let sent = 0, failed = 0, skipped = 0, expired = 0, writeErrors = 0;

  // Every write is checked. Before 17 Oct 2026 the database refused these
  // writes silently and the same nudges were re-sent every 5 minutes.
  async function closeOut(n, outcome) {
    const { error: upErr } = await db.from('nudge_queue').update(queueUpdate(outcome, nowIso)).eq('id', n.id);
    if (upErr) {
      writeErrors++;
      console.error('[cron/process-nudges] queue update refused', n.id, upErr.message);
    }
  }

  for (const n of due) {
    const plan = planNudge(n, nowMs);

    if (plan.action === 'expire') {
      expired++;
      await closeOut(n, { kind: 'expired', reason: plan.reason });
      continue;
    }
    if (plan.action === 'skip_whatsapp') {
      skipped++;
      await closeOut(n, { kind: 'skipped_whatsapp' });
      continue;
    }

    const title = n.title || 'QuietKeep';
    const body = n.body || '';
    const url = (n.payload && (n.payload.url || n.payload.action_url)) || '/dashboard';

    try {
      const push = await sendPush({ user_id: n.user_id, title, body, url });
      if (!push.ok) throw new Error(`push_status_${push.status}`);

      // Mirror into the in-app feed. Populate BOTH body and message so
      // InAppNotifications.jsx (which selects `message`/`read_at`) renders it.
      const { error: insErr } = await db.from('proactive_nudges').insert({
        user_id: n.user_id,
        nudge_type: inAppType(n.nudge_type),
        title,
        body,
        message: body || title,
        action_url: url,
        resource_id: n.keep_id || null,
        is_read: false,
        is_dismissed: false,
        scheduled_for: n.scheduled_for,
        sent_at: nowIso,
      });
      if (insErr) throw new Error(`in_app_insert_${insErr.code || 'error'}: ${insErr.message}`);

      await closeOut(n, { kind: 'sent', noPushSubscription: !!push.soft });
      sent++;
    } catch (e) {
      failed++;
      await closeOut(n, { kind: 'failed', retryCount: n.retry_count, error: e.message || e });
    }
  }

  return NextResponse.json({ ok: true, processed: due.length, sent, failed, skipped, expired, writeErrors, at: nowIso });
}

export async function GET(req) { return handle(req); }
export async function POST(req) { return handle(req); }
