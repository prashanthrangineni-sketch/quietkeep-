// src/app/api/keeps/route.js
// Keep create endpoint — SPRINT 2.
//
// Previously missing: no POST /api/keeps existed. Text/manual keep creation
// went client-direct via supabase.from('keeps').insert() with no retry,
// no idempotency, and no server-side audit trail.
//
// This route is the server-side counterpart to /api/voice/capture for
// text-only creates that don't need AI classification. The keeps store
// (src/lib/keeps/store.ts) routes text creates through /api/voice/capture
// which handles AI classification. This route is for direct creates where
// the caller already has a structured payload (e.g. future integrations,
// API access, import flows).
//
// AUTH: createBearerClient (identity) + createWriteClient (service role writes).
// IDEMPOTENCY: caller passes idempotency_key; 60s dedup window prevents doubles.

import { createBearerClient, createWriteClient, unauthorized } from '@/lib/supabase-bearer';
import { NextResponse } from 'next/server';

export async function POST(req) {
  const { supabase: authClient, user } = await createBearerClient(req);
  if (!user) return unauthorized();

  let body;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const {
    content,
    intent_type    = 'note',
    reminder_at    = null,
    location_name  = null,
    geo_trigger_enabled = false,
    workspace_id   = null,
    language       = 'en-IN',
    tags           = [],
    idempotency_key,
  } = body;

  if (!content?.trim()) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 });
  }

  // Idempotency check — 60s dedup window, same as voice/capture
  if (idempotency_key) {
    const { data: existing } = await authClient
      .from('keeps')
      .select('id,content,intent_type,status,created_at')
      .eq('user_id', user.id)
      .eq('idempotency_key', idempotency_key)
      .gt('created_at', new Date(Date.now() - 60_000).toISOString())
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ keep: existing, deduplicated: true });
    }
  }

  const db = createWriteClient();
  const { data: keep, error } = await db
    .from('keeps')
    .insert({
      user_id:             user.id,
      content:             content.trim(),
      intent_type,
      reminder_at:         reminder_at || null,
      location_name:       location_name || null,
      geo_trigger_enabled: geo_trigger_enabled || false,
      workspace_id:        workspace_id || null,
      language:            language || 'en-IN',
      tags:                tags || [],
      status:              'open',
      loop_state:          'open',
      source:              'text',
      idempotency_key:     idempotency_key || null,
    })
    .select('id,content,intent_type,status,loop_state,created_at,reminder_at,workspace_id')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Non-critical audit — fire-and-forget, log on failure
  db.from('audit_log').insert({
    user_id: user.id,
    action:  'keep_created',
    service: 'api_keeps',
    details: { intent_type, has_reminder: !!reminder_at, source: 'text' },
  }).catch((e) => console.error('[keeps/route] audit_log failed:', e.message));

  return NextResponse.json({ keep });
}

export async function GET(req) {
  const { supabase, user } = await createBearerClient(req);
  if (!user) return unauthorized();

  const { searchParams } = new URL(req.url);
  const status    = searchParams.get('status');
  const limit     = Math.min(parseInt(searchParams.get('limit') || '50'), 200);
  const workspace = searchParams.get('workspace_id');

  let query = supabase
    .from('keeps')
    .select('id,content,intent_type,status,loop_state,stale_at,created_at,reminder_at,tags,contact_name,workspace_id,is_prediction')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (status) query = query.eq('status', status);
  if (workspace) query = query.eq('workspace_id', workspace);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ keeps: data || [], count: (data || []).length });
}
