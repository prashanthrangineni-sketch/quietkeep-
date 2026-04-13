// src/app/api/auth/api-key/route.js
// Phase 11 — API Key Management
//
// GET  → list user's API keys (no raw key returned)
// POST { label?, workspace_id?, expires_in_days? } → generate new key (raw key returned once only)
// DELETE { key_id } → revoke a key

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const KEY_PREFIX = 'qk_live_';

function bearerClient(req) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } });
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

function generateKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return KEY_PREFIX + Array.from(bytes).map(b => b.toString(16).padStart(2,'0')).join('');
}

export async function GET(request) {
  const anon = bearerClient(request);
  if (!anon) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: { user } } = await anon.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data } = await svc.from('api_keys')
    .select('id, key_prefix, label, is_active, requests_limit, requests_used, last_used_at, expires_at, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  return NextResponse.json({ keys: data || [] });
}

export async function POST(request) {
  const anon = bearerClient(request);
  if (!anon) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: { user } } = await anon.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body = {};
  try { body = await request.json(); } catch {}
  const { label = 'Default', workspace_id = null, expires_in_days = null } = body;

  const rawKey  = generateKey();
  const hash    = await sha256(rawKey);
  const prefix  = rawKey.slice(0, 16) + '...';
  const expiresAt = expires_in_days
    ? new Date(Date.now() + expires_in_days * 86_400_000).toISOString()
    : null;

  const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await svc.from('api_keys').insert({
    user_id: user.id, workspace_id, key_hash: hash,
    key_prefix: prefix, label, expires_at: expiresAt,
  }).select('id, key_prefix, label, expires_at, created_at').single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ...data,
    key: rawKey,           // ONLY time raw key is returned — store it immediately
    warning: 'Store this key securely. It will not be shown again.',
  }, { status: 201 });
}

export async function DELETE(request) {
  const anon = bearerClient(request);
  if (!anon) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: { user } } = await anon.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { key_id } = body;
  if (!key_id) return NextResponse.json({ error: 'key_id required' }, { status: 400 });

  const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { error } = await svc.from('api_keys')
    .update({ is_active: false, revoked_at: new Date().toISOString() })
    .eq('id', key_id).eq('user_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, revoked: key_id });
}
