// src/app/api/ai/summary/route.js
// FIXED: cookies() → Bearer token auth
export const dynamic = 'force-dynamic';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const MODEL = 'claude-haiku-4-5-20251001';

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

export async function POST(request) {
  const supabase = createBearerClient(request);
  if (!supabase) return NextResponse.json({ error: 'Unauthorized — session expired, please refresh.' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized — session expired, please refresh.' }, { status: 401 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'AI not configured — contact support.' }, { status: 503 });

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { keep_id, intent_id, content, mode = 'keep' } = body;
  const target_id = keep_id || intent_id;

  let text = content || '';
  let intent_type = 'note';

  if (target_id && !text) {
    const { data: k } = await supabase.from('keeps').select('content,intent_type').eq('id', target_id).eq('user_id', user.id).maybeSingle();
    if (k) { text = k.content; intent_type = k.intent_type; }
    else {
      const { data: i } = await supabase.from('intents').select('raw_text,subject,intent_type').eq('id', target_id).eq('user_id', user.id).maybeSingle();
      if (i) { text = i.raw_text || i.subject; intent_type = i.intent_type; }
    }
  }
  if (!text) return NextResponse.json({ summary: 'No content to summarize.' });

  const prompt = `Summarize this single intent in 1 concise sentence (max 100 chars). Intent type: ${intent_type}. Text: "${text.slice(0,200)}"\nJSON only: {"summary":"...","action":"next step in 10 words"}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 200, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) return NextResponse.json({ error: `AI unavailable (${res.status}) — try again shortly.` }, { status: 500 });
    const data  = await res.json();
    const raw   = data.content?.[0]?.text?.trim() || '{}';
    let result;
    try { result = JSON.parse(raw.replace(/```json|```/g, '').trim()); } catch { result = { summary: raw.slice(0, 200) }; }

    if (target_id && result.summary) {
      await supabase.from('keeps').update({ ai_summary: result.summary }).eq('id', target_id).eq('user_id', user.id);
    }

    await supabase.from('audit_log').insert({ user_id: user.id, action: 'ai_summary', service: 'anthropic', details: { mode, target_id } }).throwOnError().catch(() => {});
    return NextResponse.json({ summary: result, model: MODEL });
  } catch (e) {
    return NextResponse.json({ error: 'AI request failed — check your connection.' }, { status: 500 });
  }
}
