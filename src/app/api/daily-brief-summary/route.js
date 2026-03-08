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

  const { brief } = await req.json();
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'API key not configured' }, { status: 500 });

  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const name = brief?.profile?.full_name?.split(' ')[0] || 'there';

  const lines = [];
  if (brief?.todayEvents?.length) lines.push(`Today is: ${brief.todayEvents.map(e => e.event_name).join(', ')}`);
  if (brief?.nudges?.length) lines.push(`Nudges: ${brief.nudges.map(n => n.title).join('; ')}`);
  if (brief?.keeps?.length) lines.push(`Pending keeps (${brief.keeps.length}): ${brief.keeps.slice(0, 5).map(k => k.content?.slice(0, 55)).join(' | ')}`);
  if (brief?.reminders?.length) lines.push(`Reminders this week: ${brief.reminders.map(r => `"${r.content?.slice(0, 40)}" on ${r.reminder_at?.split('T')[0]}`).join('; ')}`);
  if (brief?.subs?.length) lines.push(`Subscriptions renewing: ${brief.subs.map(s => `${s.name} on ${s.next_due}`).join(', ')}`);
  if (brief?.trips?.length) lines.push(`Upcoming trips: ${brief.trips.map(t => `${t.destination} from ${t.start_date}`).join(', ')}`);
  if (!lines.length) lines.push('No significant items for today.');

  const prompt = `Today is ${today}. Here is the daily brief data for ${name}:\n\n${lines.join('\n')}\n\nWrite a warm, natural 3-5 sentence daily brief for ${name}. Sound like a thoughtful personal assistant. Highlight the 2-3 most important things. If there is a holiday or special event, mention it warmly. End with a short encouraging note. Under 120 words. No bullet points, no markdown, flowing prose only.`;

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!aiRes.ok) throw new Error(`Claude API ${aiRes.status}`);
    const data = await aiRes.json();
    const summary = data.content?.[0]?.text?.trim() || '';
    return NextResponse.json({ summary });
  } catch (err) {
    console.error('brief-summary error:', err);
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 });
  }
}
