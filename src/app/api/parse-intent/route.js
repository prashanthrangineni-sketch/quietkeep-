// src/app/api/parse-intent/route.js
// FIXED: Replaced cookies()-based auth with Bearer token auth.
// Dashboard already sends Authorization: Bearer — route now reads it correctly.

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { checkAndIncrementAIUsage } from '@/lib/ai-rate-limit';

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

export async function POST(req) {
  try {
    const { supabase } = createSupabaseClientFromBearer(req);
    if (!supabase) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const rateCheck = await checkAndIncrementAIUsage(supabase, user.id);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: rateCheck.reason || 'Daily AI limit reached', upgrade: true, tier: rateCheck.tier },
        { status: 429 }
      );
    }

    const { text, context } = await req.json();
    if (!text) return NextResponse.json({ error: 'text required' }, { status: 400 });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ error: 'AI not configured' }, { status: 500 });

    const ctxStr = context
      ? Object.entries(context).map(([k, v]) => `${k}:${v}`).join('|')
      : '';
    const now     = new Date();
    const dateStr = now.toLocaleDateString('en-IN', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });

    const prompt = `Date:${dateStr}\nInput:"${text.slice(0, 200)}"\n${ctxStr ? `Ctx:${ctxStr}` : ''}\nJSON only:\n{"intent_type":"note|reminder|contact|task|purchase|expense|trip|document|invoice|compliance","title":"max 80 chars","reminder_at":"ISO8601 or null","tags":["1-3 tags"],"confidence":0.0-1.0}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) return NextResponse.json({ error: 'Intent parsing failed' }, { status: 500 });

    const data  = await response.json();
    const raw   = data.content?.[0]?.text?.trim() || '{}';
    let parsed;
    try {
      parsed = JSON.parse(raw.replace(/```json|```/g, '').trim());
    } catch {
      parsed = { intent_type: 'note', title: text.slice(0, 80), reminder_at: null, tags: [], confidence: 0.5 };
    }

    return NextResponse.json({ intent: parsed });
  } catch (err) {
    console.error('[parse-intent]', err);
    return NextResponse.json({ error: 'Request failed' }, { status: 500 });
  }
}
