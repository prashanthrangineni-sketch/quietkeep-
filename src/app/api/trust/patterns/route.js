// src/app/api/trust/patterns/route.js
// Phase 7 — Trust pattern scores for the Trust Dashboard
// GET → { patterns: [{ intent_type, trust_score, frequency, accepts, ignores, time_bucket, never_show }] }

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { computeTrustScore } from '@/lib/trust-engine';

function bearerClient(req) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

export async function GET(request) {
  try {
    const anon = bearerClient(request);
    if (!anon) return NextResponse.json({ patterns: [] }, { status: 401 });

    const { data: { user } } = await anon.auth.getUser();
    if (!user) return NextResponse.json({ patterns: [] }, { status: 401 });

    const svc = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data } = await svc
      .from('behavior_patterns')
      .select('pattern_type, location_name, time_bucket, frequency, metadata, last_seen_at')
      .eq('user_id', user.id)
      .in('pattern_type', ['action', 'contact'])
      .order('frequency', { ascending: false })
      .limit(20);

    if (!data?.length) return NextResponse.json({ patterns: [] });

    const patterns = data.map(p => ({
      intent_type:  p.metadata?.intent_type || p.metadata?.contact_name || p.location_name,
      pattern_type: p.pattern_type,
      time_bucket:  p.time_bucket,
      frequency:    p.frequency,
      accepts:      p.metadata?.accept_count  || 0,
      ignores:      p.metadata?.ignore_count  || 0,
      never_show:   p.metadata?.never_show    || false,
      decay_weight: p.metadata?.decay_weight  ?? 1.0,
      trust_score:  Math.min(computeTrustScore(p), 0.97),
      last_seen_at: p.last_seen_at,
    }));

    return NextResponse.json({ patterns });

  } catch (e) {
    console.error('[TRUST/PATTERNS] error:', e.message);
    return NextResponse.json({ patterns: [] });
  }
}
