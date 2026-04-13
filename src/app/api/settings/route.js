// src/app/api/settings/route.js
// FIXED v2: Replaced createSupabaseServerClient (cookies) with Bearer token auth.
// Both GET and POST now require Authorization: Bearer header.
// Fails gracefully — returns defaults on GET if no auth (settings page still renders).

export const dynamic = 'force-dynamic';

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const DEFAULT_SETTINGS = {
  confidence_threshold: 0.5,
  auto_confirm_high_confidence: false,
  notifications_enabled: true,
};

function createSupabaseClientFromBearer(req) {
  const auth = req.headers.get('Authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return { supabase: null };
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
  return { supabase };
}

export async function GET(request) {
  const { supabase } = createSupabaseClientFromBearer(request);
  if (!supabase) return NextResponse.json({ settings: DEFAULT_SETTINGS, voice_language: 'en-IN' });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ settings: DEFAULT_SETTINGS, voice_language: 'en-IN' });

  const { data } = await supabase
    .from('user_settings')
    .select('settings, voice_language')
    .eq('user_id', user.id)
    .maybeSingle();

  return NextResponse.json({
    settings: data?.settings || DEFAULT_SETTINGS,
    voice_language: data?.voice_language || 'en-IN',
  });
}

export async function POST(request) {
  const { supabase } = createSupabaseClientFromBearer(request);
  if (!supabase) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Phase 7: Merge settings instead of replacing — prevents toggleAutomationPause
  // from wiping other settings keys (automation.types, auto_threshold, etc.)
  if (body.settings && !body.voice_language) {
    // Partial update: merge settings JSONB at the top level
    const { data: existing } = await supabase
      .from('user_settings')
      .select('settings')
      .eq('user_id', user.id)
      .maybeSingle();
    const merged = { ...(existing?.settings || {}), ...body.settings };
    // Deep merge automation sub-object if present
    if (body.settings.automation && existing?.settings?.automation) {
      merged.automation = { ...existing.settings.automation, ...body.settings.automation };
    }
    await supabase.from('user_settings')
      .upsert({ user_id: user.id, settings: merged }, { onConflict: 'user_id' });
  } else {
    await supabase.from('user_settings').upsert(
      {
        user_id:        user.id,
        settings:       body.settings       || {},
        voice_language: body.voice_language || 'en-IN',
      },
      { onConflict: 'user_id' }
    );
  }

  return NextResponse.json({ success: true });
}
