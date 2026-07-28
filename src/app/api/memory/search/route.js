// src/app/api/memory/search/route.js
// Semantic recall over the user's personal memory ("what did I say about the plumber?").
//
// WHY THIS EXISTS
// embed-keeps has been embedding every keep for a while (MiniLM-L6-v2, 384-dim,
// HNSW index) — 153/154 keeps carry vectors. But nothing ever READ them back, so
// the memory was effectively write-only and "learns you" wasn't true yet.
//
// HOW
// The query must be embedded with the SAME model that built the stored vectors,
// or the comparison is meaningless. That happens in the `search-memory` edge
// function, which lives in Supabase because HUGGINGFACE_API_KEY is a Supabase
// secret (already proven by embed-keeps' daily runs). This route authenticates
// the user, then asks that function for matches on their behalf — the user_id is
// taken from the verified session, never from the request body.
//
//   POST { query, match_count?, threshold? }
//     → { mode: 'semantic' | 'keyword', matches: [...] }
//
// Falls back to keyword search rather than failing, so recall degrades but works.
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function bearer(req) {
  const a = (req.headers.get('Authorization') || '').trim();
  const t = a.startsWith('Bearer ') ? a.slice(7).trim() : a;
  if (!t) return null;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${t}` } } }
  );
}

export async function POST(req) {
  const sb = bearer(req);
  if (!sb) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const query = (body.query || '').toString().trim().slice(0, 400);
  if (!query) return NextResponse.json({ error: 'query required' }, { status: 400 });

  const matchCount = Math.min(Math.max(Number(body.match_count) || 8, 1), 50);
  const threshold  = typeof body.threshold === 'number' ? body.threshold : 0.25;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // ── 1. semantic recall ──
  if (url && svcKey) {
    try {
      const res = await fetch(`${url}/functions/v1/search-memory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${svcKey}` },
        body: JSON.stringify({
          query,
          user_id: user.id,      // from the verified session, never the request body
          match_count: matchCount,
          threshold,
        }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data?.ok && Array.isArray(data.matches) && data.matches.length) {
          return NextResponse.json({ mode: 'semantic', count: data.matches.length, matches: data.matches });
        }
        // ok:true with 0 matches is a genuine "nothing relevant" — report it as
        // semantic so the UI doesn't imply a degraded search.
        if (data?.ok) return NextResponse.json({ mode: 'semantic', count: 0, matches: [] });
      }
    } catch (_) { /* fall through to keyword */ }
  }

  // ── 2. keyword fallback (RLS-scoped to this user by their own client) ──
  const safe = query.replace(/[%_,]/g, ' ').trim();
  const { data: kw, error } = await sb
    .from('keeps')
    .select('id,content,status,intent_type,created_at')
    .ilike('content', `%${safe}%`)
    .order('created_at', { ascending: false })
    .limit(matchCount);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ mode: 'keyword', count: kw?.length || 0, matches: kw || [] });
}
