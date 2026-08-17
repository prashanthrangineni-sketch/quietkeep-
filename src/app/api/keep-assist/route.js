// src/app/api/keep-assist/route.js
export const dynamic = 'force-dynamic';
import { createClient } from '@supabase/supabase-js';
import { checkAndIncrementAIUsage } from '@/lib/ai-rate-limit';

export async function POST(req) {
  try {
    const authHeader = req.headers.get('Authorization') || '';
    const accessToken = authHeader.replace('Bearer ', '').trim();
    if (!accessToken) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${accessToken}` } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // AI rate limiting
    const rateCheck = await checkAndIncrementAIUsage(supabase, user.id);
    if (!rateCheck.allowed) {
      return Response.json(
        {
          error: rateCheck.reason || 'Daily AI limit reached',
          upgrade: true,
          tier: rateCheck.tier,
          limit: rateCheck.limit,
        },
        { status: 429 }
      );
    }

    const { keepId, content, intent_type, action, userLanguage = 'en' } = await req.json();
    const LANG_NAMES = { en: 'English', hi: 'Hindi (हिंदी)', te: 'Telugu (తెలుగు)' };
    const langName = LANG_NAMES[userLanguage] || 'English';
    const langNote = langName !== 'English' ? `\nIMPORTANT: Respond ONLY in ${langName}. Do not mix languages.` : '';
    if (!content) return Response.json({ error: 'content required' }, { status: 400 });

    if (!isConfigured()) return Response.json({ error: 'AI not configured' }, { status: 500 });

    const actionPrompts = {
      suggest: `You are a helpful personal assistant. The user has a keep/note: "${content}". Intent type: ${intent_type || 'general'}. Provide 3 concise, actionable suggestions to help them complete or follow through on this. Format as a JSON array of strings. Each suggestion max 80 chars. Respond ONLY with JSON array, no other text.`,
      breakdown: `The user has a task: "${content}". Break this into 3-5 specific sub-tasks. Format as JSON array of short task strings (max 60 chars each). Respond ONLY with JSON array.`,
      deadline: `The user has a task: "${content}". Suggest a realistic deadline and why. Format: {"deadline": "YYYY-MM-DD", "reason": "short reason"}. Respond ONLY with JSON.`,
      reminder: `The user has: "${content}". Suggest the best time to remind them about this (time of day, day type). Format: {"time": "HH:MM", "when": "description like tomorrow morning"}. Respond ONLY with JSON.`,
    };

    const basePrompt = actionPrompts[action] || actionPrompts.suggest;
    const prompt = basePrompt + langNote;

    const answer = await askModel(prompt, { maxTokens: 300, json: true });

    // The old branch here decoded Anthropic's error taxonomy to tell the user
    // which key was wrong. That distinction is gone: askModel already walked the
    // whole fallback chain, so reaching here means EVERY configured provider
    // failed. There is nothing actionable left to tell the user apart from that.
    if (!answer) {
      console.error('[keep-assist] every provider in the chain failed');
      return Response.json({
        error: isConfigured()
          ? 'AI is busy right now — please try again in a moment.'
          : 'AI not configured — contact support.',
      }, { status: isConfigured() ? 503 : 500 });
    }

    const raw = answer.text || '[]';

    let parsed;
    try {
      const clean = raw.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(clean);
    } catch {
      parsed = [raw];
    }

    // Log to audit
    await supabase.from('audit_log').insert({
      user_id: user.id,
      action: 'keep_ai_assist',
      service: 'anthropic',
      details: { keepId, action, intent_type },
    });

    return Response.json({ result: parsed });
  } catch (err) {
    console.error('[keep-assist] unexpected error:', err?.message || String(err));
    return Response.json({ error: 'AI request failed — check your connection.' }, { status: 500 });
  }
}
