// src/app/api/founder/codes/route.js
// Company free-period codes, approved by the founder on his own dashboard.
//
// Called only by the founder dashboard (pranixailabs.com/founder), server to
// server, with a signed request (see src/lib/founder-signature.js). Not for
// browsers: there is no sign-in here and no cross-site access.
//
//   GET  /api/founder/codes               every request, pending first, with use counts
//   GET  /api/founder/codes?batch=<id>    the codes of one approved batch
//   POST { action: 'request', requested_by, app, plan_tier, days, code_count, uses_each?, purpose?, codes_expire_at? }
//   POST { action: 'approve', batch, by }        makes the codes and returns them
//   POST { action: 'decline', batch, by, reason? }
//   POST { action: 'cancel',  batch, by }        switches off every code in an approved batch
//
// Codes exist only after 'approve'. Nothing else in QuietKeep can make company codes.
import { createClient } from '@supabase/supabase-js';
import { verifyFounderRequest } from '@/lib/founder-signature';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function svc() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function check(request, payload) {
  return verifyFounderRequest({
    key: process.env.FOUNDER_DASHBOARD_KEY,
    timestamp: request.headers.get('x-founder-timestamp'),
    signature: request.headers.get('x-founder-signature'),
    method: request.method,
    payload,
  });
}

function refuse(result) {
  return Response.json({ error: result.error }, { status: result.status });
}

export async function GET(request) {
  const url = new URL(request.url);
  const batch = url.searchParams.get('batch') || '';
  const auth = check(request, batch);
  if (!auth.ok) return refuse(auth);

  const db = svc();
  if (batch) {
    if (!UUID.test(batch)) return Response.json({ error: 'Bad batch id' }, { status: 400 });
    const { data, error } = await db.rpc('code_batch_codes', { p_batch: batch });
    if (error) return Response.json({ error: 'Could not read the codes' }, { status: 500 });
    return Response.json({ batch, codes: data || [] });
  }
  const { data, error } = await db.rpc('code_batches_overview');
  if (error) return Response.json({ error: 'Could not read the requests' }, { status: 500 });
  return Response.json({ batches: data || [] });
}

export async function POST(request) {
  const raw = await request.text();
  const auth = check(request, raw);
  if (!auth.ok) return refuse(auth);

  let body;
  try { body = JSON.parse(raw); } catch { return Response.json({ error: 'Bad request' }, { status: 400 }); }
  const db = svc();
  const by = String(body.by || body.requested_by || '').trim().slice(0, 80);
  if (!by) return Response.json({ error: 'Say who is asking (by).' }, { status: 400 });

  if (body.action === 'request') {
    const app = body.app === 'business' ? 'business' : 'personal';
    const days = Number(body.days), count = Number(body.code_count), uses = Number(body.uses_each || 1);
    if (!Number.isInteger(days) || days < 1 || days > 365) return Response.json({ error: 'Days must be 1 to 365.' }, { status: 400 });
    if (!Number.isInteger(count) || count < 1 || count > 1000) return Response.json({ error: 'Number of codes must be 1 to 1000.' }, { status: 400 });
    if (!Number.isInteger(uses) || uses < 1 || uses > 1000) return Response.json({ error: 'Uses per code must be 1 to 1000.' }, { status: 400 });
    const { data, error } = await db.rpc('request_code_batch', {
      p_requested_by: by, p_app: app, p_plan_tier: body.plan_tier || null, p_days: days, p_code_count: count,
      p_uses_each: uses, p_purpose: body.purpose ? String(body.purpose).slice(0, 300) : null,
      p_codes_expire_at: body.codes_expire_at || null,
    });
    if (error) return Response.json({ error: error.message || 'Could not save the request' }, { status: 400 });
    return Response.json({ success: true, batch: data, status: 'pending' });
  }

  const batch = String(body.batch || '');
  if (!UUID.test(batch)) return Response.json({ error: 'Bad batch id' }, { status: 400 });

  if (body.action === 'approve') {
    const { data, error } = await db.rpc('approve_code_batch', { p_batch: batch, p_by: by });
    if (error) return Response.json({ error: error.message || 'Could not approve' }, { status: 409 });
    return Response.json({ success: true, batch, status: 'approved', codes: data || [] });
  }
  if (body.action === 'decline') {
    const { data, error } = await db.rpc('decline_code_batch', { p_batch: batch, p_by: by, p_reason: body.reason ? String(body.reason).slice(0, 300) : null });
    if (error) return Response.json({ error: 'Could not decline' }, { status: 500 });
    if (!data) return Response.json({ error: 'That request is no longer waiting.' }, { status: 409 });
    return Response.json({ success: true, batch, status: 'declined' });
  }
  if (body.action === 'cancel') {
    const { data, error } = await db.rpc('cancel_code_batch', { p_batch: batch, p_by: by });
    if (error) return Response.json({ error: 'Could not cancel' }, { status: 500 });
    if (data === -1) return Response.json({ error: 'Only an approved batch can be cancelled.' }, { status: 409 });
    return Response.json({ success: true, batch, status: 'cancelled', codes_switched_off: data });
  }
  return Response.json({ error: 'Unknown action' }, { status: 400 });
}
