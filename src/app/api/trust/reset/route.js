// src/app/api/trust/reset/route.js
// Phase 7 — Reset a behavior pattern to neutral (for Trust Dashboard "Reset" button)
// POST { intent_type, contact_name? }
// Resets: decay_weight=1.0, accept_count=0, ignore_count=0, never_show=false

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function bearerClient(req) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

export async function POST(request) {
  try {
    const anon = bearerClient(request);
    if (!anon) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: { user } } = await anon.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    let body;
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const { intent_type, contact_name = null } = body;
    if (!intent_type) return NextResponse.json({ error: 'intent_type required' }, { status: 400 });

    const svc = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const patternType = contact_name ? 'contact' : 'action';
    const locationKey = contact_name ? contact_name.toLowerCase().trim() : intent_type;

    // Fetch current row to preserve non-feedback metadata (label, intent_type, etc.)
    const { data: existing } = await svc
      .from('behavior_patterns')
      .select('id, metadata')
      .eq('user_id', user.id)
      .eq('pattern_type', patternType)
      .ilike('location_name', locationKey)
      .limit(1)
      .maybeSingle();

    if (!existing) return NextResponse.json({ ok: true, reset: false, reason: 'pattern_not_found' });

    // Reset feedback signals only — preserve descriptive metadata
    const resetMeta = {
      ...(existing.metadata || {}),
      decay_weight:  1.0,
      accept_count:  0,
      ignore_count:  0,
      never_show:    false,
      last_feedback: null,
    };

    const { error } = await svc
      .from('behavior_patterns')
      .update({ metadata: resetMeta, updated_at: new Date().toISOString() })
      .eq('id', existing.id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, reset: true, intent_type });

  } catch (e) {
    console.error('[TRUST/RESET] error:', e.message);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
