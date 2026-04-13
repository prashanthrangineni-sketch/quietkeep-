// src/app/api/intents/[id]/review/route.js
// FIXED: cookies() → Bearer token auth
export const dynamic = 'force-dynamic';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { generateSuggestions } from '@/lib/suggestion-engine';

function createBearerClient(req) {
  const auth  = (req.headers.get('Authorization') || '').trim();
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : auth;
  if (!token) return null;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
}

export async function GET(request, context) {
  const { id } = await context.params;
  const supabase = createBearerClient(request);
  if (!supabase) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: keep, error } = await supabase
    .from('keeps').select('*').eq('id', id).eq('user_id', user.id).maybeSingle();

  if (error || !keep) return NextResponse.json({ error: 'Keep not found' }, { status: 404 });

  const normalised = { ...keep, subject: keep.content, raw_text: keep.voice_text || keep.content, action: keep.intent_type };
  const suggestions = generateSuggestions(normalised);

  await supabase.from('audit_log').insert({
    user_id: user.id, action: 'keep.reviewed', service: 'suggestion-engine',
    details: { keep_id: id, suggestion_count: suggestions.length },
  }).throwOnError().catch(() => {});

  return NextResponse.json({ intent: { ...normalised, suggestions } });
}
