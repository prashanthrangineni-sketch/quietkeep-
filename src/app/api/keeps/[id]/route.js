// src/app/api/keeps/[id]/route.js
//
// PATCH — Update keep fields with service-role write.
//
// WHY THIS ROUTE EXISTS:
//   keepsStore.update() previously flushed via client-direct supabase.from('keeps').update()
//   using the anon key. PostgREST binds Bearer JWT but auth.uid() evaluates to NULL in
//   RLS context for INSERT/UPDATE. This caused the same Sprint 1 vulnerability that was
//   fixed for other routes in PRs #4/#5.
//
//   This route closes the gap: update operations now use createWriteClient() (service role)
//   with user_id verified from the JWT — identical to the transition and create routes.
//
// IDEMPOTENCY:
//   The Idempotency-Key header is accepted for logging/tracing. For updates, last-write-wins
//   is semantically correct — replaying an update twice applies the same fields twice,
//   which is harmless.
//
// SECURITY:
//   - JWT identity verified via createBearerClient()
//   - Keep ownership verified: .eq('user_id', user.id) before write
//   - Field whitelist prevents user_id / workspace_id overwrite
//   - createWriteClient() never called without prior identity check
//
// USAGE (keepsStore.ts flush):
//   result = await _apiWrite('PATCH', `/api/keeps/${row.keepId}`, row.payload, row.id);

import { createBearerClient, createWriteClient, unauthorized } from '@/lib/supabase-bearer';
import { NextResponse } from 'next/server';

// Only these fields can be updated via this route.
// user_id, workspace_id, created_at are immutable after creation.
const ALLOWED_FIELDS = new Set([
  'content',
  'reminder_at',
  'intent_type',
  'location_name',
  'geo_trigger_enabled',
  'tags',
  'status',
  'loop_state',
  'color',
  'is_pinned',
  'show_on_brief',
  'contact_name',
  'contact_phone',
  'ai_summary',
  'space_type',
]);

export async function PATCH(request, { params }) {
  const { user } = await createBearerClient(request);
  if (!user) return unauthorized();

  const { id } = params;
  if (!id) return NextResponse.json({ error: 'Keep ID required' }, { status: 400 });

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Whitelist: only allow known-safe fields through
  const safe = Object.fromEntries(
    Object.entries(body).filter(([k]) => ALLOWED_FIELDS.has(k))
  );

  if (Object.keys(safe).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const db = createWriteClient();

  // Ownership check: service role client can bypass RLS, so we enforce ownership explicitly.
  // This prevents a user from updating another user's keep even with a valid JWT.
  const { data: existing, error: fetchErr } = await db
    .from('keeps')
    .select('id, user_id')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (fetchErr) {
    console.error('[PATCH /api/keeps/[id]] ownership check failed:', fetchErr.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: 'Keep not found' }, { status: 404 });
  }

  const { data, error } = await db
    .from('keeps')
    .update({
      ...safe,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id, content, intent_type, status, loop_state, reminder_at, updated_at')
    .single();

  if (error) {
    console.error('[PATCH /api/keeps/[id]] update failed:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Non-critical audit log — fire-and-forget, never blocks response
  db.from('audit_log').insert({
    user_id:   user.id,
    action:    'keep_updated',
    intent_id: id,
    service:   'api_keeps_patch',
    details:   { updated_fields: Object.keys(safe) },
  }).catch((e) => console.error('[PATCH /api/keeps/[id]] audit_log failed:', e.message));

  return NextResponse.json({ keep: data, success: true });
}

// GET — fetch single keep
// Used by components that need a single keep without loading all.
export async function GET(request, { params }) {
  const { supabase, user } = await createBearerClient(request);
  if (!user) return unauthorized();

  const { id } = params;
  if (!id) return NextResponse.json({ error: 'Keep ID required' }, { status: 400 });

  // READ uses anon+Bearer supabase — RLS SELECT policies work correctly with Bearer.
  const { data, error } = await supabase
    .from('keeps')
    .select('id,content,intent_type,status,loop_state,stale_at,created_at,updated_at,reminder_at,tags,contact_name,contact_phone,workspace_id,is_prediction,location_name,geo_trigger_enabled')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data)  return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ keep: data });
}
