// src/app/api/daily-brief-summary/route.js  v2
// FIXED: cookies() → Bearer token auth. Frontend must pass Authorization header.
// Also: AI prompt now responds in userLanguage so multilingual brief works.

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { checkAndIncrementAIUsage } from '@/lib/ai-rate-limit';

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

export async function POST(req) {
  const supabase = createBearerClient(req);
  if (!supabase) return NextResponse.json({ error: 'Unauthorized — session expired, please refresh.' }, { status: 401 });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized — session expired, please refresh.' }, { status: 401 });

  const rateCheck = await checkAndIncrementAIUsage(supabase, user.id);
  if (!rateCheck.allowed) {
    return NextResponse.json({
      error: rateCheck.reason || 'Daily AI limit reached. Upgrade at quietkeep.com/pricing.',
      tier: rateCheck.tier, limit: rateCheck.limit, upgrade: true,
    }, { status: 429 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'AI not configured — contact support.' }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  const { brief, userLanguage = 'en' } = body;

  const LANG_NAMES = { en: 'English', hi: 'Hindi (हिंदी)', te: 'Telugu (తెలుగు)' };
  const langName = LANG_NAMES[userLanguage] || 'English';

  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  const name = brief?.profile?.full_name?.split(' ')[0] || 'there';
  const lines = [];
  if (brief?.todayEvents?.length) lines.push(`Today: ${brief.todayEvents.map(e => e.event_name).join(', ')}`);
  if (brief?.nudges?.length)      lines.push(`Nudges: ${brief.nudges.map(n => n.title).join('; ')}`);
  if (brief?.keeps?.length)       lines.push(`Pending keeps (${brief.keeps.length}): ${brief.keeps.slice(0,5).map(k => k.content?.slice(0,55)).join(' | ')}`);
  if (brief?.reminders?.length)   lines.push(`Reminders: ${brief.reminders.map(r => `"${r.content?.slice(0,40)}" on ${r.reminder_at?.split('T')[0]}`).join('; ')}`);
  if (brief?.subs?.length)        lines.push(`Subscriptions renewing: ${brief.subs.map(s => `${s.name} on ${s.next_due}`).join(', ')}`);
  if (brief?.trips?.length)       lines.push(`Upcoming trips: ${brief.trips.map(t => `${t.destination} from ${t.start_date}`).join(', ')}`);
  if (!lines.length) lines.push('No significant items for today.');

  const prompt = `You are QuietKeep's AI assistant. Today is ${today}. Write a warm, natural 2–3 sentence morning brief for ${name}.\nIMPORTANT: Respond ONLY in ${langName}. Do not mix languages.\nContext:\n${lines.join('\n')}\nWrite only the brief text. Do not start with a greeting.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 300, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '{}');
      console.error('[daily-brief-summary] Anthropic HTTP', res.status, ':', errText.slice(0, 400));
      let userMsg = 'AI unavailable — try again shortly.';
      let httpStatus = 500;
      try {
        const parsed = JSON.parse(errText)?.error || {};
        if (parsed.type === 'authentication_error' || parsed.type === 'invalid_api_key') {
          userMsg = 'AI not configured — ANTHROPIC_API_KEY is invalid or missing. Contact support.';
        } else if (parsed.type === 'rate_limit_error') {
          userMsg = 'AI rate limit reached — try again in a minute.';
          httpStatus = 429;
        } else if (parsed.type === 'overloaded_error') {
          userMsg = 'AI is temporarily busy — try again shortly.';
        } else if (errText.includes('credit')) {
          userMsg = 'AI account credits exhausted — contact support.';
        }
      } catch {}
      return NextResponse.json({ error: userMsg }, { status: httpStatus });
    }
    const data = await res.json();
    return NextResponse.json({ summary: data.content?.[0]?.text?.trim() || 'Have a great day!' });
  } catch (err) {
    console.error('[daily-brief-summary]', err?.message);
    return NextResponse.json({ error: 'AI request failed — check your connection.' }, { status: 500 });
  }
}
