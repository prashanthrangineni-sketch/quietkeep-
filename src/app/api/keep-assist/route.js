// File: src/app/api/keep-assist/route.js
// NEW FILE — Per-Keep AI Assistant API
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function POST(req) {
  try {
    const cookieStore = cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { cookies: { get: (n) => cookieStore.get(n)?.value } }
    );
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { keepId, content, intent_type, action } = await req.json();
    if (!content) return Response.json({ error: 'content required' }, { status: 400 });

    const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) return Response.json({ error: 'AI not configured' }, { status: 500 });

    const actionPrompts = {
      suggest: `You are a helpful personal assistant. The user has a keep/note: "${content}". Intent type: ${intent_type || 'general'}. Provide 3 concise, actionable suggestions to help them complete or follow through on this. Format as a JSON array of strings. Each suggestion max 80 chars. Respond ONLY with JSON array, no other text.`,
      breakdown: `The user has a task: "${content}". Break this into 3-5 specific sub-tasks. Format as JSON array of short task strings (max 60 chars each). Respond ONLY with JSON array.`,
      deadline: `The user has a task: "${content}". Suggest a realistic deadline and why. Format: {"deadline": "YYYY-MM-DD", "reason": "short reason"}. Respond ONLY with JSON.`,
      reminder: `The user has: "${content}". Suggest the best time to remind them about this (time of day, day type). Format: {"time": "HH:MM", "when": "description like tomorrow morning"}. Respond ONLY with JSON.`,
    };

    const prompt = actionPrompts[action] || actionPrompts.suggest;
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 300, messages: [{ role: 'user', content: prompt }] }),
    });

    const aiData = await response.json();
    const raw = aiData?.content?.[0]?.text || '[]';
    let parsed;
    try { parsed = JSON.parse(raw.replace(/```json|```/g, '').trim()); }
    catch { parsed = [raw]; }

    // If breakdown action — optionally create sub-keeps
    if (action === 'breakdown' && keepId && Array.isArray(parsed)) {
      const subKeeps = parsed.map(text => ({
        user_id: user.id, content: text, status: 'open',
        intent_type: 'task', parent_id: keepId,
      }));
      await supabase.from('keeps').insert(subKeeps);
    }

    return Response.json({ result: parsed, action });
  } catch (err) {
    console.error('[keep-assist]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
