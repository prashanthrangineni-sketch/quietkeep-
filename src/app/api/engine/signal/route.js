// src/app/api/engine/signal/route.js
// External signal ingestion endpoint — multi-domain
// Accepts signals from Cart2Save (price drops), QuickScanZ (warranty alerts), etc.
// Calls ingest_external_signal() DB function which creates a keep + behaviour_signal
// No AI, no extra tables. Fully backward compatible.
//
// POST body:
// {
//   domain: 'commerce' | 'warranty' | 'education' | 'health' | 'finance',
//   source_domain: 'cart2save' | 'quickscanz' | 'schoolos',
//   signal_type: 'price_drop' | 'warranty_expiring' | 'grade_alert' | ...,
//   content: string,        // human-readable description
//   payload: object,        // domain-specific metadata
//   priority?: float,       // 0.0–1.0, defaults to 0.7
//   user_id?: string        // if absent, uses authenticated user
// }

export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

const VALID_DOMAINS = ['personal', 'commerce', 'warranty', 'education', 'health', 'finance'];
const VALID_SOURCES = ['quietkeep', 'cart2save', 'quickscanz', 'schoolos', 'external'];

export async function POST(request) {
  // Support both user-authed calls and service-key calls (X-Service-Key header)
  const serviceKey = request.headers.get('X-Service-Key');
  const isServiceCall = serviceKey === process.env.PRANIX_SERVICE_KEY;

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    // Use service role for cross-product signals, anon for user-authed
    isServiceCall
      ? process.env.SUPABASE_SERVICE_ROLE_KEY
      : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  );

  let userId;
  if (isServiceCall) {
    // Service calls must provide user_id in body
    const body = await request.clone().json().catch(() => ({}));
    userId = body.user_id;
    if (!userId) return NextResponse.json({ error: 'user_id required for service calls' }, { status: 400 });
  } else {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    userId = user.id;
  }

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const {
    domain       = 'personal',
    source_domain = 'external',
    signal_type,
    content,
    payload      = {},
    priority     = 0.7,
  } = body;

  if (!signal_type) return NextResponse.json({ error: 'signal_type required' }, { status: 400 });
  if (!content)     return NextResponse.json({ error: 'content required' }, { status: 400 });
  if (!VALID_DOMAINS.includes(domain)) {
    return NextResponse.json({ error: `Invalid domain. Must be: ${VALID_DOMAINS.join(', ')}` }, { status: 400 });
  }

  const { data, error } = await supabase.rpc('ingest_external_signal', {
    p_user_id:      userId,
    p_domain:       domain,
    p_source_domain: source_domain,
    p_signal_type:  signal_type,
    p_content:      content,
    p_payload:      payload,
    p_priority:     Math.min(1.0, Math.max(0.0, priority)),
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // ── PHASE 2: Non-blocking event-driven signal correlation ───────────────
  // Immediately fires signal-correlator after ingestion — reduces correlation
  // latency from ~23 hours (nightly cron) to seconds.
  //
  // DESIGN:
  //   - fetch() is fire-and-forget (.catch(()=>{}) swallows all errors)
  //   - Response is returned BEFORE this call completes (no latency impact)
  //   - Payload passes everything correlator needs: no extra DB lookup required
  //   - If correlator fails or times out: nightly behaviour-engine is fallback
  //     (it processes all behaviour_signals WHERE processed=false)
  //
  // SAFETY: correlation failure never affects the caller's response.
  if (data?.keep_id) {
    fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/signal-correlator`,
      {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          keep_id:       data.keep_id,
          user_id:       userId,
          signal_type,
          content,
          domain,
          source_domain,
        }),
      }
    ).catch(() => {}); // fire-and-forget — never blocks the response
  }
  // ─────────────────────────────────────────────────────────────────────────

  return NextResponse.json({
    success:     true,
    keep_id:     data.keep_id,
    intent_type: data.intent_type,
    domain,
    source_domain,
    signal_type,
  }, { status: 201 });
}
