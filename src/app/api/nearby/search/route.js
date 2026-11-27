// POST /api/nearby/search
// A signed-in person asks which shops near them have an item. QuietKeep asks Cart2Save's
// local-shops layer on their behalf and passes back public shop details only.
// Rules: see src/lib/nearby/search-core.js. This route stores nothing and logs nothing
// about the question.
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isNearbyEnabled, readAsk, buildCart2SaveCall, cleanShops, createRateLimiter } from '@/lib/nearby/search-core';

export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const NO_STORE = { 'Cache-Control': 'no-store' };
const allow = createRateLimiter();
const reply = (body, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

async function signedInUser(request) {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: { user } } = await supabase.auth.getUser();
  return user || null;
}

export async function POST(request) {
  if (!isNearbyEnabled()) return reply({ error: 'Not available yet.' }, 404);

  const user = await signedInUser(request);
  if (!user) return reply({ error: 'Please sign in.' }, 401);
  if (!allow(user.id)) return reply({ error: 'Too many searches. Please wait a minute.' }, 429);

  const key = process.env.QK_NEARBY_SEARCH_KEY || '';
  const baseUrl = process.env.CART2SAVE_BASE_URL || 'https://cart2save.com';
  if (key.length < 32) return reply({ error: 'Nearby search is not set up yet.' }, 503);

  let body;
  try { body = await request.json(); } catch { return reply({ error: 'Invalid request' }, 400); }
  const read = readAsk(body);
  if (!read.ok) return reply({ error: read.error }, read.status);

  const call = buildCart2SaveCall(read.ask, { key, baseUrl });
  try {
    const res = await fetch(call.url, {
      method: 'POST',
      headers: call.headers,
      body: call.payload,
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return reply({ error: 'Nearby shops are not available right now.' }, 502);
    return reply({ shops: cleanShops(await res.json()) });
  } catch {
    // No detail on purpose: an error message could carry the search words.
    return reply({ error: 'Nearby shops are not available right now.' }, 502);
  }
}
