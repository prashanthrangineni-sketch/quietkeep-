// src/app/api/settings/route.js
// SPRINT 1 FIX: Unified auth + service-role write pattern.
//
// BEFORE: anon+Bearer for user_settings.upsert() -> auth.uid()=NULL -> silent failure.
//         Settings appeared to save (auth check passed, 200 returned), but DB row
//         never written. Every session: settings reverted to DEFAULT_SETTINGS.
//
// AFTER: Identity via createBearerClient. Write via createWriteClient (service role).
//        GET remains anon Bearer — SELECT is safe.

export const dynamic = 'force-dynamic';

import { createBearerClient, createWriteClient, unauthorized } from '@/lib/supabase-bearer';
import { NextResponse } from 'next/server';

const DEFAULT_SETTINGS = {
  confidence_threshold:         0.5,
  auto_confirm_high_confidence: false,
  notifications_enabled:        true,
};

export async function GET(request) {
  const { supabase, user } = await createBearerClient(request);
  // Settings GET degrades gracefully — return defaults if not authenticated.
  if (!user) return NextResponse.json({ settings: DEFAULT_SETTINGS, voice_language: 'en-IN' });

  const { data } = await supabase
    .from('user_settings')
    .select('settings, voice_language')
    .eq('user_id', user.id)
    .maybeSingle();

  return NextResponse.json({
    settings:       data?.settings       || DEFAULT_SETTINGS,
    voice_language: data?.voice_language || 'en-IN',
  });
}

export async function POST(request) {
  const { supabase, user } = await createBearerClient(request);
  if (!user) return unauthorized();

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const db = createWriteClient();

  // Partial update: merge settings JSONB at top level.
  // Prevents toggleAutomationPause from wiping other settings keys.
  if (body.settings && !body.voice_language) {
    const { data: existing } = await supabase
      .from('user_settings')
      .select('settings')
      .eq('user_id', user.id)
      .maybeSingle();

    const merged = { ...(existing?.settings || {}), ...body.settings };
    if (body.settings.automation && existing?.settings?.automation) {
      merged.automation = { ...existing.settings.automation, ...body.settings.automation };
    }

    await db.from('user_settings')
      .upsert({ user_id: user.id, settings: merged }, { onConflict: 'user_id' });
  } else {
    await db.from('user_settings').upsert(
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
