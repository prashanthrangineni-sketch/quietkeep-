import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const RULES = [
  { pattern: /\b(call|ring|phone|contact|talk to|speak to)\b/i, type: 'contact', assist: 'contact', confidence: 0.9 },
  { pattern: /\b(remind|reminder|don't forget|remember to|alert me|notify)\b/i, type: 'reminder', assist: 'reminder', confidence: 0.9 },
  { pattern: /\b(buy|order|purchase|get|pick up|shop|groceries|vegetables|milk|bread)\b/i, type: 'task', assist: 'note', confidence: 0.85 },
  { pattern: /\b(meet|meeting|appointment|doctor|dentist|interview|visit|attend)\b/i, type: 'reminder', assist: 'reminder', confidence: 0.88 },
  { pattern: /\b(trip|travel|goa|flight|hotel|train|holiday|vacation|book)\b/i, type: 'trip', assist: 'note', confidence: 0.87 },
  { pattern: /\b(pay|payment|bill|due|emi|rent|electricity|recharge)\b/i, type: 'reminder', assist: 'reminder', confidence: 0.88 },
  { pattern: /\b(email|send|reply|message|whatsapp|text)\b/i, type: 'contact', assist: 'contact', confidence: 0.82 },
  { pattern: /\b(spent|paid|expense|cost|bought|charged|₹|rs\.|rupees)\b/i, type: 'expense', assist: 'note', confidence: 0.9 },
  { pattern: /\b(idea|think|consider|maybe|what if|explore|research)\b/i, type: 'note', assist: 'note', confidence: 0.75 },
  { pattern: /\b(medicine|tablet|pill|dose|health|symptoms|doctor|hospital)\b/i, type: 'health', assist: 'reminder', confidence: 0.88 },
];

function extractRemindAt(text) {
  const now = new Date();
  const t = text.toLowerCase();
  if (/\btomorrow\b/.test(t)) {
    const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
    return d.toISOString();
  }
  if (/\btonight\b/.test(t)) {
    const d = new Date(now); d.setHours(20, 0, 0, 0);
    return d.toISOString();
  }
  if (/\bmorning\b/.test(t)) {
    const d = new Date(now); d.setHours(8, 0, 0, 0);
    if (d < now) d.setDate(d.getDate() + 1);
    return d.toISOString();
  }
  if (/\bevening\b/.test(t)) {
    const d = new Date(now); d.setHours(18, 0, 0, 0);
    if (d < now) d.setDate(d.getDate() + 1);
    return d.toISOString();
  }
  const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  for (let i = 0; i < days.length; i++) {
    if (t.includes(days[i])) {
      const d = new Date(now);
      const diff = (i - d.getDay() + 7) % 7 || 7;
      d.setDate(d.getDate() + diff); d.setHours(9, 0, 0, 0);
      return d.toISOString();
    }
  }
  return null;
}

function extractAmount(text) {
  const match = text.match(/[₹rs\.\s]*(\d+(?:\.\d{1,2})?)/i);
  return match ? parseFloat(match[1]) : null;
}

function parseIntent(text) {
  let bestMatch = { type: 'note', assist: 'note', confidence: 0.5 };
  for (const rule of RULES) {
    if (rule.pattern.test(text) && rule.confidence > bestMatch.confidence) {
      bestMatch = rule;
    }
  }
  const suggestions = [];
  if (bestMatch.type === 'contact') suggestions.push({ icon: '⏰', text: 'Add a follow-up reminder', action: 'reminder' });
  if (bestMatch.type === 'reminder' || extractRemindAt(text)) suggestions.push({ icon: '⏰', text: 'Set time for this reminder', action: 'reminder' });
  if (/\b(buy|shop|order)\b/i.test(text)) suggestions.push({ icon: '🛒', text: 'Search on Cart2Save', action: 'cart2save' });
  if (bestMatch.type === 'expense') suggestions.push({ icon: '💰', text: 'Log as expense', action: 'expense' });
  if (bestMatch.type === 'trip') suggestions.push({ icon: '✈️', text: 'Start trip planner', action: 'trip' });

  return {
    intent_type: bestMatch.type,
    assist_mode: bestMatch.assist,
    confidence: bestMatch.confidence,
    parsing_method: 'rule',
    remind_at: extractRemindAt(text),
    extracted_amount: extractAmount(text),
    suggestions: suggestions.slice(0, 2),
  };
}

export async function POST(req) {
  try {
    const { text, user_id } = await req.json();
    if (!text || !user_id) return NextResponse.json({ error: 'Missing text or user_id' }, { status: 400 });

    const parsed = parseIntent(text);

    // Log to audit_log
    await supabase.from('audit_log').insert([{
      user_id,
      action: 'intent_parsed',
      service: 'rule_parser',
      details: { text: text.substring(0, 200), ...parsed },
    }]);

    return NextResponse.json(parsed);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
      }
