export const dynamic = 'force-dynamic';

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const RULES = [
  { pattern: /call|ring|phone|whatsapp|contact/i, type: 'contact' },
  { pattern: /buy|order|get|purchase|pick up|shop/i, type: 'task' },
  { pattern: /remind|tomorrow|tonight|morning|evening|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week/i, type: 'reminder' },
  { pattern: /meet|meeting|appointment|doctor|dentist|interview/i, type: 'reminder' },
];

function parseRules(text) {
  for (const rule of RULES) {
    if (rule.pattern.test(text)) return rule.type;
  }
  return 'note';
}

function extractDateTime(text) {
  const t = text.toLowerCase();
  const now = new Date();
  let date = null;
  if (/\btoday\b/.test(t)) date = new Date(now);
  else if (/\btomorrow\b/.test(t)) { date = new Date(now); date.setDate(date.getDate() + 1); }
  else if (/\bnext week\b/.test(t)) { date = new Date(now); date.setDate(date.getDate() + 7); }
  else {
    const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
    for (let i = 0; i < days.length; i++) {
      if (new RegExp(`\\b${days[i]}\\b`).test(t)) {
        date = new Date(now);
        const diff = (i - now.getDay() + 7) % 7 || 7;
        date.setDate(date.getDate() + diff);
        break;
      }
    }
  }
  if (!date) return null;
  let h = 9, m = 0;
  const timeMatch = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  if (timeMatch) {
    h = parseInt(timeMatch[1]);
    m = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
    if (timeMatch[3] === 'pm' && h < 12) h += 12;
    if (timeMatch[3] === 'am' && h === 12) h = 0;
  } else if (/\bmorning\b/.test(t)) h = 9;
  else if (/\bafternoon\b/.test(t)) h = 14;
  else if (/\bevening\b/.test(t)) h = 18;
  else if (/\bnight\b/.test(t)) h = 20;
  else if (/\bnoon\b/.test(t)) h = 12;
  date.setHours(h, m, 0, 0);
  return date.toISOString();
}

export async function POST(request) {
  try {
    const { text, user_id } = await request.json();
    if (!text || !user_id) return Response.json({ error: 'Missing text or user_id' }, { status: 400 });

    const intent_type = parseRules(text);
    const remind_at = extractDateTime(text);

    await supabase.from('audit_log').insert([{
      user_id,
      action: 'intent_parsed',
      service: 'parse-intent',
      details: { text: text.substring(0, 100), detected_type: intent_type, detected_datetime: remind_at },
    }]);

    return Response.json({ intent_type, remind_at, method: 'rule_parser' });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
