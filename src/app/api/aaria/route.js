// src/app/api/aaria/route.js
//
// Server-side proxy to Aaria (pranix-aaria), Pranix's shared voice/intent
// understanding service. This is a DISTINCT, additive integration — it does
// NOT touch or replace the existing /api/parse-intent pipeline or any
// existing voice capture/session routes. Those keep working exactly as
// before. This route exists purely so QuietKeep can also route free-text
// queries through Aaria's understanding contract (product: "QuietKeep"),
// which already allow-lists save_note / get_notes intents for this product.
export const dynamic = 'force-dynamic';

import { createClient } from '@supabase/supabase-js';

const AARIA_BASE_URL = 'https://pranix-aaria.onrender.com';

export async function POST(req) {
  try {
    const authHeader = req.headers.get('Authorization') || '';
    const accessToken = authHeader.replace('Bearer ', '').trim();
    if (!accessToken) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${accessToken}` } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { text, lang_hint } = await req.json().catch(() => ({}));
    if (!text || typeof text !== 'string' || !text.trim()) {
      return Response.json({ error: 'text required' }, { status: 400 });
    }

    const res = await fetch(`${AARIA_BASE_URL}/api/voice/understand`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: text.trim(),
        product: 'QuietKeep',
        lang_hint: lang_hint || 'en',
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return Response.json(
        { error: `Aaria understand failed: ${res.status}`, detail },
        { status: 502 }
      );
    }

    const data = await res.json();
    // Expected shape: { intent, entities, confidence, engine_used }

    // Best-effort visual-companion slice: ask Aaria's /api/voice/speak for a
    // short spoken confirmation and surface its visual_companion metadata
    // (expression + caption timing) if present. Never blocks or fails the
    // primary /understand response above.
    let visual_companion = null;
    try {
      const speakRes = await fetch(`${AARIA_BASE_URL}/api/voice/speak`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: data?.intent && data.intent !== 'unknown' ? `Got it: ${data.intent}` : 'One moment.',
          lang: lang_hint || 'en',
          product: 'QuietKeep',
          quality_tier: 'standard',
        }),
      });
      if (speakRes.ok) {
        const speakData = await speakRes.json().catch(() => null);
        visual_companion = speakData?.visual_companion ?? null;
      }
    } catch {
      // best-effort only
    }

    return Response.json({ ...data, visual_companion });
  } catch (err) {
    console.error('[api/aaria] unexpected error:', err?.message || String(err));
    return Response.json(
      { error: 'Aaria voice-control-plane unreachable' },
      { status: 502 }
    );
  }
}

// Health passthrough — useful for quick ops checks without needing to know
// Aaria's base URL from the client.
export async function GET() {
  try {
    const res = await fetch(`${AARIA_BASE_URL}/api/health`);
    const data = await res.json().catch(() => ({}));
    return Response.json(data, { status: res.status });
  } catch (err) {
    return Response.json(
      { status: 'error', service: 'aaria-proxy', detail: err?.message },
      { status: 503 }
    );
  }
}
