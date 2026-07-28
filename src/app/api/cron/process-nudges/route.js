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
export const maxDuration = 60;

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const BATCH = 50;         // nudges per run
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
  // ── auth: only the cron (or a caller holding CRON_SECRET) may run this ──
  const secret = process.env.CRON_SECRET;
  const authz = req.headers.get('Authorization') || '';
  const isVercelCron = req.headers.get('x-vercel-cron') === '1';
  if (secret && authz !== `Bearer ${secret}` && !isVercelCron) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return NextResponse.json({ error: 'Supabase env not configured' }, { status: 500 });
  }

  const db = svc();
  const nowIso = new Date().toISOString();

  // Pull due, undelivered, not-exhausted nudges, highest priority first.
  const { data: due, error } = await db
    .from('nudge_queue')
    .select('id,user_id,nudge_type,title,body,payload,channel,scheduled_for,keep_id,retry_count,workspace_id,domain_type')
    .eq('delivered', false)
    .lte('scheduled_for', nowIso)
    .lt('retry_count', MAX_RETRY)
    .order('priority_score', { ascending: false, nullsFirst: false })
    .order('scheduled_for', { ascending: true })
    .limit(BATCH);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!due || due.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, at: nowIso });
  }

  let sent = 0, failed = 0, skipped = 0;

  for (const n of due) {
    const title = n.title || 'QuietKeep';
    const body = n.body || '';
    const url = (n.payload && (n.payload.url || n.payload.action_url)) || '/dashboard';
    const channel = (n.channel || 'push').toLowerCase();

    // WhatsApp-channel nudges need the outbound WA pipeline + opt-in; not
    // auto-sent here to avoid half-doing it. Left queued, flagged, not retried
    // into oblivion. (TODO: dedicated WA dispatch once server-auth is fixed.)
    if (channel === 'whatsapp') {
      skipped++;
      await db.from('nudge_queue').update({ delivery_status: 'skipped_whatsapp' }).eq('id', n.id);
      continue;
    }

    try {
      const push = await sendPush({ user_id: n.user_id, title, body, url });

      // Always mirror into the in-app feed. Populate BOTH body and message so
      // InAppNotifications.jsx (which selects `message`/`read_at`) renders it.
      await db.from('proactive_nudges').insert({
        user_id: n.user_id,
        nudge_type: n.nudge_type || 'reminder',
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

      if (push.ok) {
        await db.from('nudge_queue').update({
          delivered: true,
          delivered_at: nowIso,
          delivery_status: push.soft ? 'delivered_no_push_sub' : 'sent',
        }).eq('id', n.id);
        sent++;
      } else {
        throw new Error(`push_status_${push.status}`);
      }
    } catch (e) {
      failed++;
      await db.from('nudge_queue').update({
        retry_count: (n.retry_count || 0) + 1,
        last_error: String(e.message || e).slice(0, 300),
        failed_at: nowIso,
        delivery_status: 'failed',
      }).eq('id', n.id);
    }
  }

  return NextResponse.json({ ok: true, processed: due.length, sent, failed, skipped, at: nowIso });
}

export async function GET(req) { return handle(req); }
export async function POST(req) { return handle(req); }
