import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Rule-based intent parser — no LLM, fully offline-capable
function parseIntent(text) {
  const lower = text.toLowerCase().trim();

  // Intent type detection
  let intent_type = 'note';
  let reminder_at = null;
  let confidence = 0.6;

  // Reminder patterns
  if (/remind|reminder|alert|notify|don.?t forget/i.test(lower)) {
    intent_type = 'reminder';
    confidence = 0.9;
  } else if (/buy|purchase|order|get me|pick up|add to cart/i.test(lower)) {
    intent_type = 'purchase';
    confidence = 0.85;
  } else if (/call|phone|ring|contact|reach out/i.test(lower)) {
    intent_type = 'contact';
    confidence = 0.85;
  } else if (/pay|payment|transfer|send money|upi|bank/i.test(lower)) {
    intent_type = 'expense';
    confidence = 0.8;
  } else if (/travel|trip|flight|hotel|book|go to|visit/i.test(lower)) {
    intent_type = 'trip';
    confidence = 0.8;
  } else if (/scan|document|upload|passport|aadhaar|licence|insurance|warranty/i.test(lower)) {
    intent_type = 'document';
    confidence = 0.8;
  } else if (/draft|write|message|whatsapp|email|send/i.test(lower)) {
    intent_type = 'draft';
    confidence = 0.75;
  } else if (/note|write down|remember|save|keep/i.test(lower)) {
    intent_type = 'note';
    confidence = 0.7;
  }

  // Time extraction
  const now = new Date();
  if (/tomorrow/i.test(lower)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    reminder_at = d.toISOString();
  } else if (/tonight|this evening/i.test(lower)) {
    const d = new Date(now);
    d.setHours(20, 0, 0, 0);
    reminder_at = d.toISOString();
  } else if (/this morning/i.test(lower)) {
    const d = new Date(now);
    d.setHours(8, 0, 0, 0);
    reminder_at = d.toISOString();
  } else if (/next week/i.test(lower)) {
    const d = new Date(now);
    d.setDate(d.getDate() + 7);
    d.setHours(9, 0, 0, 0);
    reminder_at = d.toISOString();
  } else if (/in (\d+) (hour|hr)/i.test(lower)) {
    const match = lower.match(/in (\d+) (hour|hr)/i);
    const d = new Date(now.getTime() + parseInt(match[1]) * 60 * 60 * 1000);
    reminder_at = d.toISOString();
  } else if (/in (\d+) (minute|min)/i.test(lower)) {
    const match = lower.match(/in (\d+) (minute|min)/i);
    const d = new Date(now.getTime() + parseInt(match[1]) * 60 * 1000);
    reminder_at = d.toISOString();
  }

  // Smart suggestions based on intent type
  const suggestions = [];
  if (intent_type === 'purchase') {
    suggestions.push({ text: 'Search on Cart2Save', action: 'cart2save_search', tier: 1 });
  }
  if (intent_type === 'expense') {
    suggestions.push({ text: 'Log to Finance', action: 'log_expense', tier: 1 });
  }
  if (intent_type === 'document') {
    suggestions.push({ text: 'Scan with QuickScanZ', action: 'quickscanz_scan', tier: 1 });
  }
  if (intent_type === 'trip') {
    suggestions.push({ text: 'Plan trip with Cart2Save', action: 'cart2save_trip', tier: 1 });
  }
  if (intent_type === 'contact') {
    suggestions.push({ text: 'Open dialer', action: 'open_dialer', tier: 1 });
    suggestions.push({ text: 'Draft WhatsApp message', action: 'whatsapp_draft', tier: 1 });
  }
  if (intent_type === 'draft') {
    suggestions.push({ text: 'Open WhatsApp', action: 'whatsapp_draft', tier: 1 });
    suggestions.push({ text: 'Open Email', action: 'email_draft', tier: 1 });
  }

  return { intent_type, reminder_at, confidence, suggestions };
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { text } = body;

    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }

    // Parse intent server-side
    const parsed = parseIntent(text);

    // Get authenticated user
    const cookieStore = cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          getAll() { return cookieStore.getAll(); },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              );
            } catch {}
          },
        },
      }
    );

    const { data: { user } } = await supabase.auth.getUser();

    // Save keep to DB if user is authenticated
    let savedKeep = null;
    if (user) {
      const { data, error } = await supabase
        .from('keeps')
        .insert({
          user_id: user.id,
          content: text,
          intent_type: parsed.intent_type,
          reminder_at: parsed.reminder_at,
          status: 'open',
          confidence: parsed.confidence,
          parsing_method: 'rule_based',
          show_on_brief: true,
          is_pinned: false,
          color: '#6366f1',
        })
        .select()
        .single();

      if (!error) {
        savedKeep = data;

        // Write audit log
        await supabase.from('audit_log').insert({
          user_id: user.id,
          action: 'keep_created',
          intent_id: data.id,
          service: 'parse-intent',
          details: {
            intent_type: parsed.intent_type,
            confidence: parsed.confidence,
            has_reminder: !!parsed.reminder_at,
            text_length: text.length,
          },
        });
      }
    }

    return NextResponse.json({
      success: true,
      parsed,
      keep: savedKeep,
    });

  } catch (err) {
    console.error('[parse-intent] error:', err);
    return NextResponse.json({ error: 'Internal server error', detail: err.message }, { status: 500 });
  }
}
