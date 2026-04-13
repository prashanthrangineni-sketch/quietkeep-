// src/app/api/geo/locations/route.js
// FIX: This file was missing from the repo — causing all /api/geo/locations calls to 404.
// ROOT CAUSE of "Save location not working" bug.
// GET  — list saved locations for authenticated user
// POST — upsert (insert or update) a location by name
// DELETE — remove a location by id (?id=<uuid>)
//
// Auth: anon client validates identity via auth.getUser().
// Writes: service role client bypasses RLS (consistent with voice/capture pattern).
export const dynamic = 'force-dynamic';
import { createClient } from '@supabase/supabase-js';
import { NextResponse }  from 'next/server';

function anonClient(req) {
  const auth  = (req.headers.get('Authorization') || '').trim();
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : auth;
  if (!token) return null;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

async function getUser(req) {
  const anon = anonClient(req);
  if (!anon) return null;
  const { data: { user } } = await anon.auth.getUser();
  return user || null;
}

// GET /api/geo/locations
export async function GET(request) {
  const user = await getUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await serviceClient()
    .from('user_locations')
    .select('id, name, latitude, longitude, radius_meters, visit_count, last_visited_at, created_at')
    .eq('user_id', user.id)
    .order('name');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ locations: data || [] });
}

// POST /api/geo/locations
// Body: { name, latitude, longitude, radius_meters? }
// Upserts by name (case-insensitive) — safe to call repeatedly.
export async function POST(request) {
  const user = await getUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { name, latitude, longitude, radius_meters = 200 } = body;
  if (!name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return NextResponse.json({ error: 'latitude and longitude must be numbers' }, { status: 400 });
  }

  const db = serviceClient();
  const { data: existing } = await db
    .from('user_locations')
    .select('id')
    .eq('user_id', user.id)
    .ilike('name', name.trim())
    .maybeSingle();

  let result, error;
  if (existing) {
    ({ data: result, error } = await db
      .from('user_locations')
      .update({ latitude, longitude, radius_meters, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
      .select()
      .single());
  } else {
    ({ data: result, error } = await db
      .from('user_locations')
      .insert({ user_id: user.id, name: name.trim().toLowerCase(), latitude, longitude, radius_meters })
      .select()
      .single());
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ location: result });
}

// DELETE /api/geo/locations?id=<uuid>
export async function DELETE(request) {
  const user = await getUser(request);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const { error } = await serviceClient()
    .from('user_locations')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
