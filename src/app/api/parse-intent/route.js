import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function POST(req) {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { text } = body;
  if (!text?.trim()) return NextResponse.json({ error: 'No text provided' }, { status: 400 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // Fallback — save as plain note without AI
    const { data: keep } = await supabase.from('keeps').insert({
      user_id: user.id, content: text, intent_type: 'general',
      category: 'general', color: '#94a3b8', confidence: 0.5,
      parsing_method: 'fallback', status: 'pending', show_on_brief: true,
    }).select().single();
    return NextResponse.json({ success: true, keep, fallback: true });
  }

  // ── Pull user context ──────────────────────────────────────────────────────
  const today = new Date().toISOString().split('T')[0];
  const in7 = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

  const [
    { data: recentKeeps },
    { data: upcomingReminders },
    { data: activeSubs },
    { data: upcomingTrips },
    { data: profile },
  ] = await Promise.all([
    supabase.from('keeps').select('content, intent_type').eq('user_id', user.id).order('created_at', { ascending: false }).limit(8),
    supabase.from('keeps').select('content, reminder_at').eq('user_id', user.id).eq('status', 'pending').not('reminder_at', 'is', null).gte('reminder_at', today).lte('reminder_at', in7).order('reminder_at').limit(5),
    supabase.from('subscriptions').select('name, amount, currency, next_due, cycle').eq('user_id', user.id).eq('is_active', true).order('next_due').limit(10),
    supabase.from('trip_plans').select('destination, start_date, end_date').eq('user_id', user.id).gte('start_date', today).order('start_date').limit(3),
    supabase.from('profiles').select('full_name, persona_type, language_preference').eq('user_id', user.id).single(),
  ]);

  const ctx = [];
  if (recentKeeps?.length) ctx.push(`Recent keeps: ${recentKeeps.slice(0, 5).map(k => k.content?.slice(0, 60)).join(' | ')}`);
  if (upcomingReminders?.length) ctx.push(`Upcoming reminders: ${upcomingReminders.map(r => `"${r.content?.slice(0, 40)}" on ${r.reminder_at?.split('T')[0]}`).join(', ')}`);
  if (activeSubs?.length) ctx.push(`Active subscriptions: ${activeSubs.map(s => `${s.name} (${s.currency} ${s.amount}, next due ${s.next_due})`).join(', ')}`);
  if (upcomingTrips?.length) ctx.push(`Upcoming trips: ${upcomingTrips.map(t => `${t.destination} (${t.start_date} to ${t.end_date})`).join(', ')}`);

  const systemPrompt = `You are QuietKeep's intent parser for ${profile?.full_name || 'a user'} (persona: ${profile?.persona_type || 'professional'}).
Today: ${today}

USER CONTEXT:
${ctx.length ? ctx.join('\n') : 'No prior context.'}

Parse the user input and return ONLY a JSON object — no explanation, no markdown:
{
  "content": "cleaned version of the keep text",
  "intent_type": "task|reminder|note|expense|subscription|trip|mood|document|general",
  "category": "work|personal|finance|health|family|travel|home|general",
  "color": "#ef4444|#f59e0b|#22c55e|#6366f1|#94a3b8",
  "reminder_at": "ISO datetime string in UTC or null",
  "confidence": 0.0-1.0,
  "parsing_method": "claude-context-aware"
}
Color guide: red=urgent, amber=caution, green=done, indigo=info, gray=default.
For reminder_at: assume IST (UTC+5:30) for relative times. "tomorrow" = next day 9am IST.`;

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        system: systemPrompt,
        messages: [{ role: 'user', content: text }],
      }),
    });

    if (!aiRes.ok) throw new Error(`Claude API ${aiRes.status}`);
    const aiData = await aiRes.json();
    const raw = aiData.content?.[0]?.text?.trim() || '';
    const clean = raw.replace(/^```json|^```|```$/gm, '').trim();
    const parsed = JSON.parse(clean);

    const { data: keep, error: insertErr } = await supabase.from('keeps').insert({
      user_id: user.id,
      content: parsed.content || text,
      intent_type: parsed.intent_type || 'general',
      category: parsed.category || 'general',
      color: parsed.color || '#94a3b8',
      reminder_at: parsed.reminder_at || null,
      confidence: parsed.confidence || 0.8,
      parsing_method: 'claude-context-aware',
      status: 'pending',
      show_on_brief: true,
    }).select().single();

    if (insertErr) throw insertErr;
    return NextResponse.json({ success: true, keep, parsed });

  } catch (err) {
    console.error('parse-intent error:', err);
    // Graceful fallback — still save the keep
    const { data: keep } = await supabase.from('keeps').insert({
      user_id: user.id, content: text, intent_type: 'general',
      category: 'general', color: '#94a3b8', confidence: 0.5,
      parsing_method: 'fallback', status: 'pending', show_on_brief: true,
    }).select().single();
    return NextResponse.json({ success: true, keep, fallback: true });
  }
}
